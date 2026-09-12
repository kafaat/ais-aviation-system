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


# The mysql image runs as uid/gid 999. The job is pinned to that identity rather
# than the image default so the dump is never written by root, and fsGroup gives
# the same identity write access to the mounted PVC.
MYSQL_UID = 999
DEFAULT_IMAGE = "mysql:8.0"
# Deliberately permissive on the reference form and strict on nothing else: a
# digest-pinned reference is what production should use, but an unverified digest
# hard-coded here would break every backup, so the choice stays with the operator.
IMAGE = re.compile(r"[a-z0-9][a-z0-9._\-/]*(?::[\w.\-]+)?(?:@sha256:[a-f0-9]{64})?")
# 540s silently killed any dump that ran longer, with backoffLimit 0 leaving no
# retry. The window is now the operator's to size against a measured dump.
DEFAULT_DEADLINE_SECONDS = 3600
MIN_DEADLINE_SECONDS = 300
MAX_DEADLINE_SECONDS = 43200


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
    image = env.get("BACKUP_IMAGE") or DEFAULT_IMAGE
    if not IMAGE.fullmatch(image) or len(image) > 512:
        raise ValueError("BACKUP_IMAGE must be a valid image reference")
    deadline = env.get("BACKUP_DEADLINE_SECONDS") or str(DEFAULT_DEADLINE_SECONDS)
    if not re.fullmatch(r"[0-9]{1,5}", deadline) or not (
            MIN_DEADLINE_SECONDS <= int(deadline) <= MAX_DEADLINE_SECONDS):
        raise ValueError(
            f"BACKUP_DEADLINE_SECONDS must be an integer between "
            f"{MIN_DEADLINE_SECONDS} and {MAX_DEADLINE_SECONDS}")
    return {
        "apiVersion": "batch/v1", "kind": "Job",
        "metadata": {"name": name, "namespace": "ais-production"},
        "spec": {
            "backoffLimit": 0, "activeDeadlineSeconds": int(deadline),
            "ttlSecondsAfterFinished": 86400,
            "template": {"spec": {
                "restartPolicy": "Never",
                "securityContext": {
                    "runAsNonRoot": True, "runAsUser": MYSQL_UID,
                    "runAsGroup": MYSQL_UID, "fsGroup": MYSQL_UID,
                    "seccompProfile": {"type": "RuntimeDefault"},
                },
                "containers": [{
                    "name": "backup", "image": image,
                    "command": ["sh", "-ec", BACKUP_COMMAND],
                    "envFrom": [{"secretRef": {"name": credential_secret}}],
                    "env": [{"name": "BACKUP_NAME", "value": name}],
                    "securityContext": {
                        "allowPrivilegeEscalation": False,
                        "readOnlyRootFilesystem": True,
                        "capabilities": {"drop": ["ALL"]},
                    },
                    "resources": {
                        "requests": {"cpu": "100m", "memory": "256Mi"},
                        "limits": {"cpu": "1", "memory": "1Gi"},
                    },
                    "volumeMounts": [
                        {"name": "backup", "mountPath": "/backup"},
                        # The dump goes to the PVC; this only satisfies the client's
                        # scratch writes under a read-only root filesystem.
                        {"name": "tmp", "mountPath": "/tmp"},
                    ],
                }],
                "volumes": [
                    {"name": "backup", "persistentVolumeClaim": {"claimName": pvc}},
                    {"name": "tmp", "emptyDir": {}},
                ],
            }},
        },
    }


if __name__ == "__main__":
    print(json.dumps(build_job(os.environ)))
