import { z } from "zod";
import ts from "typescript";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
const root = process.cwd();
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const paths = parsed.fileNames.filter(file => !/\.(test|spec)\./.test(file));
const graph = new Map<string, Set<string>>();
const imports = new Map<string, Set<string>>();
const operations = new Map<string, { reads: string[]; writes: string[] }>();
const normalize = (file: string) => relative(root, file).replaceAll("\\", "/");
for (const file of paths) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const key = normalize(file);
  const edges = new Set<string>();
  const reads = new Set<string>();
  const writes = new Set<string>();
  function visit(node: ts.Node) {
    let spec: string | undefined;
    if (
      ts.isImportDeclaration(node) &&
      !node.importClause?.isTypeOnly &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      spec = node.moduleSpecifier.text;
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      spec = node.moduleSpecifier.text;
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      spec = node.arguments[0].text;
    if (spec) {
      const target = ts.resolveModuleName(spec, file, parsed.options, ts.sys)
        .resolvedModule?.resolvedFileName;
      if (target && !target.includes("node_modules")) {
        const dependency = normalize(target);
        edges.add(dependency);
        const incoming = imports.get(dependency) ?? new Set<string>();
        incoming.add(key);
        imports.set(dependency, incoming);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.arguments[0]
    ) {
      const action = node.expression.name.text;
      const table = node.arguments[0].getText(source);
      if (/^[\w.]+$/.test(table)) {
        if (["from", "innerJoin", "leftJoin"].includes(action))
          reads.add(table);
        if (["insert", "update", "delete"].includes(action)) writes.add(table);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  graph.set(key, edges);
  operations.set(key, { reads: [...reads].sort(), writes: [...writes].sort() });
}
const reachable = new Set<string>();
function reach(key: string) {
  if (reachable.has(key)) return;
  reachable.add(key);
  for (const edge of graph.get(key) ?? []) reach(edge);
}
for (const entry of ["server/_core/index.ts", "server/worker.ts"]) reach(entry);
const lifecycle = JSON.parse(
  readFileSync("docs/architecture/service-lifecycle.json", "utf8")
);
const ownership = z
  .object({
    schemaVersion: z.literal(1),
    repositoryFallback: z.string(),
    fallbackDomain: z.string(),
    domains: z.array(
      z.object({
        id: z.string(),
        match: z.string(),
        accountableOwner: z.string().min(1).nullable(),
        onCall: z.string().min(1).nullable(),
        acceptanceEvidence: z.string().min(1).nullable(),
      })
    ),
  })
  .parse(
    JSON.parse(readFileSync("docs/architecture/service-ownership.json", "utf8"))
  );
function ownershipFor(file: string) {
  const domain =
    ownership.domains.find(d => new RegExp(d.match).test(file)) ??
    ownership.domains.find(d => d.id === ownership.fallbackDomain);
  if (!domain) throw new Error(`No ownership domain for ${file}`);
  return {
    domain: domain.id,
    accountableOwner: domain.accountableOwner,
    onCall: domain.onCall,
    ownershipAcceptance: domain.acceptanceEvidence,
    ownershipStatus:
      domain.accountableOwner && domain.onCall && domain.acceptanceEvidence
        ? "assigned"
        : "unassigned",
  };
}
const services = [...graph.keys()]
  .filter(key => key.startsWith("server/services/"))
  .sort()
  .map(file => ({
    file,
    lifecycle: lifecycle.retired[file]
      ? "retired"
      : /(^|[/.])types\.ts$/.test(file)
        ? "type-only"
        : reachable.has(file)
          ? "active"
          : "unwired",
    technicalOwner: file,
    ...ownershipFor(file),
    consumers: [...(imports.get(file) ?? [])].sort(),
    dependencies: [...(graph.get(file) ?? [])].sort(),
    tableExpressions: operations.get(file),
    replacement: lifecycle.retired[file] ?? null,
  }));
for (const service of services.filter(
  service => service.lifecycle === "retired"
)) {
  const activeConsumers = service.consumers.filter(consumer =>
    reachable.has(consumer)
  );
  if (activeConsumers.length)
    throw new Error(
      `Retired service imported by runtime: ${service.file}: ${activeConsumers.join(", ")}`
    );
}
const output =
  JSON.stringify(
    {
      schemaVersion: 2,
      method:
        "Static TypeScript import graph from API and worker; table expressions require domain review; deployment reachability is not certification",
      services,
    },
    null,
    2
  ) + "\n";
const destination = resolve("docs/architecture/service-catalog.json");
if (process.argv.includes("--check")) {
  if (
    !existsSync(destination) ||
    JSON.stringify(JSON.parse(readFileSync(destination, "utf8"))) !==
      JSON.stringify(JSON.parse(output))
  )
    throw new Error(
      "Service catalog changed; regenerate and review producers, consumers and ownership"
    );
} else writeFileSync(destination, output);
console.info(
  JSON.stringify({
    services: services.length,
    states: services.reduce(
      (counts, service) => ({
        ...counts,
        [service.lifecycle]: (counts[service.lifecycle] ?? 0) + 1,
      }),
      {} as Record<string, number>
    ),
  })
);
