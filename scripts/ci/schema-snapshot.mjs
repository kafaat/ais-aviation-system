import fs from "node:fs";
import path from "node:path";
export function latestSchemaSnapshot(root) {
  const meta = path.join(root, "drizzle/meta");
  const journal = JSON.parse(
    fs.readFileSync(path.join(meta, "_journal.json"), "utf8")
  );
  const entry = journal.entries.at(-1);
  if (!entry || !Number.isSafeInteger(entry.idx))
    throw new Error("Missing migration journal head");
  const name = `${String(entry.idx).padStart(4, "0")}_snapshot.json`;
  return {
    journal,
    name,
    snapshot: JSON.parse(fs.readFileSync(path.join(meta, name), "utf8")),
  };
}
