import { readFileSync, writeFileSync } from "node:fs";
import { format, resolveConfig } from "prettier";
import { z } from "zod";
import { resolve } from "node:path";
import {
  assertProducerContracts,
  readEventProducers,
} from "./event-producer-inventory";
import {
  cloudEventMetadata,
  eventPayloadContracts,
  domainSchemaId,
} from "../server/contracts/domain-events";

const metadata = z.toJSONSchema(cloudEventMetadata, { target: "draft-7" });
const producers = readEventProducers(resolve(import.meta.dirname, ".."));
assertProducerContracts(producers, eventPayloadContracts);
const messages: Record<string, unknown> = {};
for (const [name, payload] of [
  ...Object.entries(eventPayloadContracts),
  ["legacy", null] as const,
]) {
  const key = name.replaceAll(".", "_") + "_v1";
  const data: Record<string, unknown> = payload
    ? z.toJSONSchema(payload, { target: "draft-7" })
    : { type: "object", additionalProperties: true };
  const { $schema: _metaDialect, ...metaSchema } = metadata;
  const { $schema: _payloadDialect, ...dataSchema } = data;
  messages[key] = {
    name: name === "legacy" ? "Legacy domain event v1" : `${name} v1`,
    title: name,
    contentType: "application/cloudevents+json",
    summary: payload
      ? "Version 1 payload and CloudEvents envelope"
      : "Historical replay only; new writes require a registered payload contract",
    "x-ais-producers": [
      ...new Set(
        producers.filter(p => p.eventTypes.includes(name)).map(p => p.file)
      ),
    ].sort(),
    payload: {
      ...metaSchema,
      required: [...(metadata.required ?? []), "data"],
      properties: {
        ...metadata.properties,
        ...(payload
          ? {
              type: { const: `org.ais.${name}.v1` },
              dataschema: { const: domainSchemaId(name) },
            }
          : {
              type: {
                ...(typeof metadata.properties?.type === "object"
                  ? metadata.properties.type
                  : {}),
                not: {
                  enum: Object.keys(eventPayloadContracts).map(
                    type => `org.ais.${type}.v1`
                  ),
                },
              },
            }),
        data: dataSchema,
      },
    },
  };
}
const channelMessages = Object.fromEntries(
  Object.keys(messages).map(key => [
    key,
    { $ref: `#/components/messages/${key}` },
  ])
);
const document = {
  asyncapi: "3.0.0",
  id: "urn:ais:aviation:events",
  info: {
    title: "AIS transactional domain events",
    version: "1.0.0",
    description:
      "At-least-once authenticated HTTP delivery. Deduplicate source/id, retain tenant scope and schema version. New writes require registered payload contracts; unlisted historical payloads remain readable for replay. Producer names are checked against this registry. No broker or production server is implied.",
  },
  "x-ais-producer-coverage": {
    callSites: producers.length,
    eventTypes: new Set(producers.flatMap(p => p.eventTypes)).size,
    unregistered: [],
  },
  defaultContentType: "application/cloudevents+json",
  channels: {
    domainEvents: { address: "/events/inbox", messages: channelMessages },
  },
  operations: {
    publishDomainEvent: {
      action: "send",
      channel: { $ref: "#/channels/domainEvents" },
    },
  },
  components: { messages },
};
const path = "docs/architecture/domain-events.asyncapi.json";
if (process.argv.includes("--check")) {
  if (
    JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !==
    JSON.stringify(document)
  )
    throw new Error(
      "Event contracts changed; regenerate and review producer/consumer compatibility"
    );
} else {
  writeFileSync(
    path,
    await format(JSON.stringify(document), {
      ...(await resolveConfig(path)),
      filepath: path,
    })
  );
}
