"""Restore the deployment backup on an isolated MySQL server, using CI fixtures.

Requires the populated database left by verify-transaction-boundaries.ts. Never
accepts a DATABASE_URL, publishes a database dump, or contacts an external server.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid


ROOT = Path(__file__).resolve().parents[2]


def run(args, *, env=None, data=None, check=True, timeout=120):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, env=env, timeout=timeout)
    if check and result.returncode:
        # Do not print command arguments/environment (they can contain credentials).
        raise RuntimeError(result.stderr.decode(errors="replace")[-3000:])
    return result


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    source = os.environ.get("MYSQL_SERVICE_CONTAINER", "")
    database = os.environ.get("MYSQL_DATABASE", "")
    password = os.environ.get("MYSQL_PWD", "")
    require(os.environ.get("AIS_DISPOSABLE_DATABASE") == "true"
            and os.environ.get("NODE_ENV") == "test"
            and re.fullmatch(r"[a-z0-9_]+_test", database)
            and re.fullmatch(r"[a-f0-9]{12,64}", source) and password,
            "Requires an explicit test environment, disposable *_test database and service container ID")
    require(len(sys.argv) == 2, "Usage: backup-restore-smoke.py evidence.json")
    evidence = Path(sys.argv[1])
    evidence.parent.mkdir(parents=True, exist_ok=True)
    info = json.loads(run(["docker", "inspect", source]).stdout)[0]
    require("AIS_DISPOSABLE_DATABASE=true" in info["Config"]["Env"],
            "Source container must be explicitly marked disposable")
    require(info["Config"]["Image"] == "mysql:8.0", "Expected CI MySQL 8.0 service")
    suffix = uuid.uuid4().hex[:16]
    volume = "ais-restore-" + suffix
    target = "ais-restore-" + suffix
    backup_name = "db-backup-" + suffix
    report = {
        "sourceSha": run(["git", "-C", str(ROOT), "rev-parse", "HEAD"]).stdout.decode().strip(),
        "passed": False, "checks": [], "providerCalls": 0,
        "scope": "CI logical restore on a separate MySQL server and Docker volume; not production PVC/RPO/RTO certification",
    }

    def check(name):
        report["checks"].append(name)
        print("PASS " + name, flush=True)

    # Credentials are inherited by docker exec/run, never embedded in command args.
    env = dict(os.environ, MYSQL_ROOT_PASSWORD=password, MYSQL_PWD=password,
               MYSQL_DATABASE=database)

    def execute(container, args, **kwargs):
        return run(["docker", "exec", "-i", "-e", "MYSQL_PWD", container, *args],
                   env=env, **kwargs)

    def sql(container, statement):
        return execute(container, ["mysql", "-uroot", "--batch", "--skip-column-names",
                                   "--default-character-set=utf8mb4", database],
                       data=statement.encode()).stdout.decode().strip()

    def snapshot(container):
        return execute(container, ["mysqldump", "-uroot", "--single-transaction",
                                   "--skip-comments", "--skip-dump-date", "--hex-blob",
                                   "--order-by-primary", "--skip-extended-insert",
                                   "--no-tablespaces", "--set-gtid-purged=OFF",
                                   "--routines", "--triggers", "--events", database]).stdout

    job = json.loads(run([sys.executable, str(ROOT / "scripts/k8s-backup-job.py")],
                         env=dict(env, BACKUP_PVC="ci-volume", BACKUP_CREDENTIAL_SECRET="ci-secret",
                                  BACKUP_RUN_ID=suffix)).stdout)
    spec = job["spec"]["template"]["spec"]["containers"][0]
    report["backupCommandSha256"] = hashlib.sha256(spec["command"][-1].encode()).hexdigest()

    def backup(name, db_name=database):
        return run(["docker", "run", "--rm", "--network", "container:" + source,
                    "--mount", f"type=volume,source={volume},target=/backup",
                    "-e", "MYSQL_PWD", "-e", "MYSQL_HOST=127.0.0.1", "-e", "MYSQL_USER=root",
                    "-e", "MYSQL_DATABASE=" + db_name, "-e", "BACKUP_NAME=" + name,
                    "--entrypoint", spec["command"][0], spec["image"], *spec["command"][1:]],
                   env=env, check=False)

    def volume_command(command):
        return run(["docker", "run", "--rm", "--network", "none",
                    "--mount", f"type=volume,source={volume},target=/backup",
                    "--entrypoint", "sh", spec["image"], "-ec", command])

    def restore(name):
        # A failed checksum must be rejected before any database writes. The mount
        # is read-only and this server has no network or production credentials.
        return execute(target, ["sh", "-ec", '''
cd /backup
sha256sum -c "$1.sql.sha256" >/dev/null
count=$(mysql -uroot -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$MYSQL_DATABASE'")
test "$count" = 0 || { echo 'Restore target is not empty' >&2; exit 1; }
mysql -uroot "$MYSQL_DATABASE" < "$1.sql"
''', "restore", name], check=False)

    started = time.monotonic()
    try:
        counts = {}
        for table in ["bookings", "flights", "payment_receipts", "financial_ledger",
                      "outbox", "wallets", "refresh_tokens", "user_preferences", "__drizzle_migrations"]:
            counts[table] = int(sql(source, f"SELECT COUNT(*) FROM `{table}`"))
            require(counts[table] > 0, f"Required nonempty acceptance fixture: {table}")
        report["fixtureRows"] = counts
        # Non-table objects expose missing --routines/--triggers/--events flags.
        sql(source, "CREATE PROCEDURE ais_restore_probe() SELECT 42; "
            "CREATE TRIGGER ais_restore_probe BEFORE UPDATE ON users FOR EACH ROW SET NEW.name = NEW.name; "
            "CREATE EVENT ais_restore_probe ON SCHEDULE EVERY 1 DAY STARTS '2030-01-01 00:00:00' DISABLE DO SELECT 42; "
            "UPDATE users SET name = 'استعادة اختبار ✈', email = NULL WHERE id = 984001;")
        before = snapshot(source)
        report["databaseSnapshotSha256"] = hashlib.sha256(before).hexdigest()
        run(["docker", "volume", "create", volume])
        dumped = backup(backup_name)
        require(dumped.returncode == 0, dumped.stderr.decode(errors="replace"))
        check("generated deployment backup persists after its writer exits")
        duplicate = backup(backup_name)
        require(duplicate.returncode != 0, "Existing backup was overwritten")
        volume_command(f"cd /backup; sha256sum -c {backup_name}.sql.sha256")
        check("existing backup cannot be overwritten")
        failed_name = backup_name + "-failed"
        require(backup(failed_name, "missing_restore_test").returncode != 0, "Failed dump reported success")
        volume_command(f"test ! -e /backup/{failed_name}.sql; test ! -e /backup/{failed_name}.sql.sha256; "
                       f"test ! -e /backup/{failed_name}.sql.partial; test ! -e /backup/{failed_name}.lock")
        check("dump failure leaves no completed backup or partial file")
        run(["docker", "run", "-d", "--name", target, "--network", "none",
             "--tmpfs", "/var/lib/mysql:rw", "--mount", f"type=volume,source={volume},target=/backup,readonly",
             "-e", "MYSQL_ROOT_PASSWORD", "-e", "MYSQL_DATABASE", info["Image"]], env=env)
        for _ in range(90):
            ready = execute(target, ["mysql", "-h127.0.0.1", "-uroot", database, "-Nse", "SELECT 1"], check=False)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Isolated restore server did not become ready")
        corrupt_name = backup_name + "-corrupt"
        volume_command(f"cd /backup; cp {backup_name}.sql {corrupt_name}.sql; "
                       f"sha256sum {corrupt_name}.sql > {corrupt_name}.sql.sha256; "
                       f"printf '\\n-- corrupted\\n' >> {corrupt_name}.sql")
        corrupt = restore(corrupt_name)
        require(corrupt.returncode != 0 and b"checksum" in corrupt.stderr.lower(),
                "Corrupt backup was not rejected by checksum")
        require(sql(target, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == "0",
                "Checksum rejection changed the target database")
        check("corrupt backup is rejected before writing any target tables")
        restored = restore(backup_name)
        require(restored.returncode == 0, restored.stderr.decode(errors="replace"))
        after = snapshot(target)
        require(before == after, "Restored schema/data/routines/triggers/events differ from source snapshot")
        report["restoredSnapshotSha256"] = hashlib.sha256(after).hexdigest()
        report["restoredTables"] = int(sql(target, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()"))
        require(sql(target, "CALL ais_restore_probe()") == "42", "Restored routine is not executable")
        check("all table definitions and rows, routines, triggers and events survive restoration")
        blocked = restore(backup_name)
        require(blocked.returncode != 0 and b"not empty" in blocked.stderr,
                "Nonempty restore target was accepted")
        require(snapshot(target) == after, "Rejected restore changed existing records")
        check("nonempty target is rejected without changing restored records")
        report["passed"] = True
    finally:
        report["elapsedSeconds"] = round(time.monotonic() - started, 3)
        evidence.write_text(json.dumps(report, indent=2) + "\n")
        # Delete only the resources generated by this invocation; never the source.
        run(["docker", "rm", "-f", target], check=False)
        run(["docker", "volume", "rm", volume], check=False)
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
