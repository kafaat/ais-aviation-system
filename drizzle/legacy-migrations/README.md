# Legacy migration archive

These SQL files are retained for forensic and historical reference only. They are **not** an executable Drizzle migration history and must not be copied back into `drizzle/` or configured as the Drizzle `out` directory.

The only production-authoritative migration history is:

- SQL migrations: `drizzle/NNNN_*.sql`
- Journal and snapshots: `drizzle/meta/`
- Configuration: `drizzle.config.ts` with `out: "./drizzle"`

Create new migrations through Drizzle Kit so the SQL file, snapshot, and `meta/_journal.json` advance together. CI enforces exact parity between executable SQL filenames and journal tags.

The archived files below predate that authoritative history and include hand-written multi-statement SQL. They are intentionally excluded from `drizzle-kit migrate`.
