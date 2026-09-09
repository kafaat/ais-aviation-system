"""Emit a backup Job bound to an existing durable PVC and credential Secret."""
import json
import os

pvc = os.environ.get("BACKUP_PVC")
credential_secret = os.environ.get("BACKUP_CREDENTIAL_SECRET")
if not pvc or not credential_secret:
    raise SystemExit("BACKUP_PVC and BACKUP_CREDENTIAL_SECRET are required")
name = "db-backup-" + os.environ["BACKUP_RUN_ID"]
command = '''umask 077
test -d /backup
mysqldump --single-transaction --routines --triggers -h "$MYSQL_HOST" -u "$MYSQL_USER" "$MYSQL_DATABASE" > "/backup/$BACKUP_NAME.sql.partial"
test -s "/backup/$BACKUP_NAME.sql.partial"
mv "/backup/$BACKUP_NAME.sql.partial" "/backup/$BACKUP_NAME.sql"
cd /backup
sha256sum "$BACKUP_NAME.sql" > "$BACKUP_NAME.sql.sha256"
sync
echo "Backup persisted with checksum: $BACKUP_NAME"
'''
print(json.dumps({
    "apiVersion": "batch/v1", "kind": "Job",
    "metadata": {"name": name, "namespace": "ais-production"},
    "spec": {"backoffLimit": 0, "ttlSecondsAfterFinished": 86400,
             "template": {"spec": {"restartPolicy": "Never", "containers": [{
                 "name": "backup", "image": "mysql:8.0",
                 "command": ["sh", "-ec", command],
                 "envFrom": [{"secretRef": {"name": credential_secret}}],
                 "env": [{"name": "BACKUP_NAME", "value": name}],
                 "volumeMounts": [{"name": "backup", "mountPath": "/backup"}],
             }], "volumes": [{"name": "backup", "persistentVolumeClaim": {"claimName": pvc}}]}}}
}))
