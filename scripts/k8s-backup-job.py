"""Emit a backup Job bound to an existing durable PVC and credential Secret."""
import json
import os
import re


# The restore acceptance runner executes this exact generated container command.
BACKUP_COMMAND = '''umask 077
: "${MYSQL_HOST:?MYSQL_HOST is required}"
: "${MYSQL_USER:?MYSQL_USER is required}"
: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"
: "${MYSQL_PWD:?MYSQL_PWD is required}"
case "$BACKUP_NAME" in ''|*[!a-zA-Z0-9_-]*) echo "Invalid backup name" >&2; exit 1;; esac
cd "${BACKUP_DIR:-/backup}"
mkdir "$BACKUP_NAME.lock"
trap 'rm -f "$BACKUP_NAME.sql.partial" "$BACKUP_NAME.sql.sha256.partial"; rmdir "$BACKUP_NAME.lock"' EXIT
test ! -e "$BACKUP_NAME.sql"
test ! -e "$BACKUP_NAME.sql.sha256"
mysqldump --single-transaction --routines --triggers --events --hex-blob --no-tablespaces --set-gtid-purged=OFF -h "$MYSQL_HOST" -u "$MYSQL_USER" "$MYSQL_DATABASE" > "$BACKUP_NAME.sql.partial"
test -s "$BACKUP_NAME.sql.partial"
digest=$(sha256sum "$BACKUP_NAME.sql.partial")
printf '%s  %s\\n' "${digest%% *}" "$BACKUP_NAME.sql" > "$BACKUP_NAME.sql.sha256.partial"
sync
mv "$BACKUP_NAME.sql.partial" "$BACKUP_NAME.sql"
mv "$BACKUP_NAME.sql.sha256.partial" "$BACKUP_NAME.sql.sha256"
sync
echo "Backup persisted with checksum: $BACKUP_NAME"
'''


def build_job(env):
    pvc = env.get("BACKUP_PVC", "")
    credential_secret = env.get("BACKUP_CREDENTIAL_SECRET", "")
    name = "db-backup-" + env.get("BACKUP_RUN_ID", "")
    dns_name = r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?"
    if not all(re.fullmatch(dns_name, value) and len(value) <= 253
               for value in (pvc, credential_secret)):
        raise ValueError("Valid BACKUP_PVC and BACKUP_CREDENTIAL_SECRET are required")
    if not re.fullmatch(r"db-backup-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", name) or len(name) > 63:
        raise ValueError("BACKUP_RUN_ID must produce a valid Job name of at most 63 characters")
    return {
        "apiVersion": "batch/v1", "kind": "Job",
        "metadata": {"name": name, "namespace": "ais-production"},
        "spec": {
            "backoffLimit": 0, "activeDeadlineSeconds": 540,
            "ttlSecondsAfterFinished": 86400,
            "template": {"spec": {
                "restartPolicy": "Never",
                "containers": [{
                    "name": "backup", "image": "mysql:8.0",
                    "command": ["sh", "-ec", BACKUP_COMMAND],
                    "envFrom": [{"secretRef": {"name": credential_secret}}],
                    "env": [{"name": "BACKUP_NAME", "value": name}],
                    "volumeMounts": [{"name": "backup", "mountPath": "/backup"}],
                }],
                "volumes": [{"name": "backup", "persistentVolumeClaim": {"claimName": pvc}}],
            }},
        },
    }


if __name__ == "__main__":
    print(json.dumps(build_job(os.environ)))
