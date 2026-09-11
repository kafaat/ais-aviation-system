# Backup and restore acceptance

The `Production Gates` workflow runs `scripts/ci/backup-restore-smoke.py` after
the live MySQL/Redis transaction checks have populated the disposable database.
The runner executes the exact command emitted by `scripts/k8s-backup-job.py`,
retains its dump on a Docker volume after the writer exits, and restores it into
a separate MySQL 8.0 server with no network and a fresh temporary data directory.

The gate fails unless all of these hold:

- Payment receipts, financial ledger, bookings, inventory, wallets, outbox,
  revocable sessions, preferences and the migration journal are nonempty.
- Every table definition and every row matches a deterministic source dump after
  restoration, including Unicode and NULL values. Binary columns use hexadecimal dump encoding. Stored routines,
  triggers and disabled events are also preserved; a restored routine executes.
- A checksum mismatch is rejected before any target tables are created.
- A failed dump produces no completed artifact; an existing backup cannot be
  overwritten; a nonempty restore target is refused without changing its data.

The artifact `live-transaction-acceptance/backup-restore.json` records the tested
commit, command digest, before/after database digests, fixture counts and elapsed
time. Raw SQL, session tokens and credentials are not uploaded. The runner deletes
only its own target container and volume; GitHub owns the source service lifecycle.

## Reproduction

Use the checked-in `Production Gates` job for the complete migration, live fixture
and restore sequence. To invoke the runner on the same prepared disposable Docker
service locally:

```bash
export NODE_ENV=test AIS_DISPOSABLE_DATABASE=true
export MYSQL_SERVICE_CONTAINER=<full-disposable-mysql-container-id>
export MYSQL_DATABASE=ais_migration_test
export MYSQL_PWD=<disposable-database-password>
python3 scripts/ci/backup-restore-smoke.py /tmp/backup-restore.json
```

The source container must use `mysql:8.0`, carry
`AIS_DISPOSABLE_DATABASE=true`, and contain the successful live acceptance fixture.
The runner refuses missing configuration and production environments before
calling Docker. It accepts no connection URL or external database hostname.

Shell boundary checks also run without Docker:

```bash
python3 -m unittest discover -s scripts/ci -p 'test_backup_job.py' -v
```

## Deployment prerequisites and limits

The deployment job requires an existing `PRODUCTION_BACKUP_PVC` and
`PRODUCTION_BACKUP_CREDENTIAL_SECRET` when `ENABLE_DB_BACKUP=true`. The referenced
Secret must provide `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_DATABASE` and `MYSQL_PWD`.
Each run gets a unique filename; completed backups are never overwritten. A dump
is complete only when both its `.sql` and matching `.sql.sha256` file are present.
Failed or interrupted attempts require investigation before operators remove any
remaining lock or incomplete file. Neither is evidence of a valid backup.

The Job runs as uid/gid 999 with `runAsNonRoot`, a read-only root filesystem, all
capabilities dropped, no privilege escalation, the default seccomp profile and
declared CPU/memory requests and limits. `fsGroup` is set to the same id, so the
PVC must be group-writable by it; a volume whose contents were written by root
under an earlier revision needs its ownership corrected before the first non-root
run. Only `/backup` and an ephemeral `/tmp` are writable.

Two optional repository variables size the Job. `PRODUCTION_BACKUP_DEADLINE_SECONDS`
sets `activeDeadlineSeconds` (default 3600, accepted range 300–43200); with
`backoffLimit: 0` there is no retry, so measure a real dump and leave margin
rather than discovering the limit during an incident. The deployment step derives
its own `kubectl wait` timeout from whatever this produces. `PRODUCTION_BACKUP_IMAGE`
overrides the `mysql:8.0` default and should carry a `@sha256:` digest in
production, since the default tag is mutable; obtain one with
`docker buildx imagetools inspect mysql:8.0`. Both variables fall back to the
default when unset or empty.

This is a logical database backup, with GTID restoration deliberately disabled.
`--single-transaction` provides an InnoDB snapshot; concurrent schema changes must
be stopped during capture. Routine, trigger and event privileges must be granted
to the backup account. See the [MySQL mysqldump reference](https://dev.mysql.com/doc/refman/8.0/en/mysqldump.html).

CI proves the backup/restore mechanism on disposable data. Production PVC
retention, offsite copies, encryption, storage failure recovery, point-in-time
recovery and measured production RPO/RTO still require deployment-specific
exercises. The isolated CI restore procedure is not an in-place production restore
command. Payment fixtures make no provider HTTP calls.
