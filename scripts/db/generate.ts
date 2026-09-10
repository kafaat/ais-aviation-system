import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import * as schema from "../../drizzle/schema";
import { readHistory } from "./schema-contract";
import { assertMigrationScope } from "./snapshot-check";

const args = new Map(
  process.argv.slice(2).map(arg => {
    const separator = arg.indexOf("=");
    return [arg.slice(0, separator), arg.slice(separator + 1)];
  })
);
const name = args.get("--name");
const scope = args.get("--tables")?.split(",").sort();
if (
  !name ||
  !/^[a-z0-9_]+$/.test(name) ||
  !scope?.length ||
  scope.some(t => !/^[A-Za-z0-9_]+$/.test(t)) ||
  args.size !== 2
) {
  throw new Error(
    "Usage: pnpm db:generate --name=change_name --tables=table_a,table_b (exact reviewed scope)"
  );
}
const { generateMySQLDrizzleJson } = createRequire(import.meta.url)(
  "drizzle-kit/api"
) as typeof import("drizzle-kit/api");
const before = readHistory().at(-1)?.snapshot;
if (!before) throw new Error("Missing previous snapshot");
const after = await generateMySQLDrizzleJson(schema);
assertMigrationScope(before, after, scope);
const generated = spawnSync(
  process.execPath,
  ["node_modules/drizzle-kit/bin.cjs", "generate", `--name=${name}`],
  { stdio: "inherit", env: process.env }
);
if (generated.error) throw generated.error;
process.exitCode = generated.status ?? 1;
