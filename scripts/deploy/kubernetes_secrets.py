"""Send deployment secrets as JSON on stdin, never as command arguments."""
import argparse
import base64
import json
import os
from pathlib import Path
import subprocess
import sys

KEYS = (
    "SELF_SERVICE_CAPABILITY_SECRET", "QUEUE_REDIS_URL", "SMS_PROVIDER",
    "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER",
    "HOTELBEDS_MODE", "HOTELBEDS_API_KEY", "HOTELBEDS_SECRET",
    "HOTELBEDS_ACCEPTANCE_REFERENCE", "AVIATION_WEATHER_MODE",
    "AVIATION_WEATHER_BASE_URL", "AVIATION_WEATHER_SOURCE_REFERENCE",
    "ONCALL_MODE", "ONCALL_BASE_URL", "ONCALL_TOKEN", "ONCALL_ACCEPTANCE_REFERENCE",
    "AIS_OTEL_ENABLED", "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    "OTEL_EXPORTER_OTLP_HEADERS", "OTEL_TRACES_SAMPLER_ARG", "DATABASE_URL",
    "JWT_SECRET", "CSRF_SECRET", "AUTH_SERVICE_URL", "RESEND_API_KEY", "EMAIL_FROM",
    "OUTBOX_PUBLISH_URL", "OUTBOX_PUBLISH_TOKEN", "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET", "REDIS_URL",
)


def manifest(namespace, environment):
    # Empty optional settings retain their existing meaning. Missing bindings
    # fail instead of silently dropping a credential from the deployment.
    data = {key: base64.b64encode(environment[key].encode("utf-8")).decode("ascii")
            for key in KEYS}
    return json.dumps({"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
                       "metadata": {"name": "ais-secrets", "namespace": namespace},
                       "data": data}).encode("utf-8")


def apply(namespace):
    payload = manifest(namespace, os.environ)
    environment = {key: value for key, value in os.environ.items()
                   if key not in KEYS and key != "AIS_KUBECONFIG_BASE64"}
    # Server-side apply does not add a last-applied manifest annotation. Do not
    # force ownership conflicts: an operator must reconcile those explicitly.
    result = subprocess.run(
        ["kubectl", "apply", "--server-side", "--field-manager=ais-secrets",
         "--request-timeout=30s", "-f", "-"], input=payload, env=environment,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45,
        check=False,
    )
    if result.returncode:
        raise RuntimeError("Secret apply failed")
    print("Deployment secret applied")


def configure():
    value = os.environ.get("AIS_KUBECONFIG_BASE64", "")
    if value:
        content = base64.b64decode("".join(value.split()), validate=True)
        directory = Path.home() / ".kube"
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        # O_NOFOLLOW refuses an existing symlink. Permissions are restricted
        # before truncation/write, including when checkout reused a file.
        fd = os.open(directory / "config", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as target:
            os.fchmod(target.fileno(), 0o600)
            target.truncate(0)
            target.write(content)
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"configured={'true' if value else 'false'}\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("apply", "configure", "cleanup"))
    parser.add_argument("--namespace", choices=("ais-staging", "ais-production"))
    args = parser.parse_args()
    try:
        if args.operation == "cleanup":
            (Path.home() / ".kube" / "config").unlink(missing_ok=True)
        elif args.operation == "configure":
            configure()
        else:
            if not args.namespace:
                raise ValueError("Namespace required")
            apply(args.namespace)
    except Exception:
        # kubectl and Python errors can contain submitted data. Keep both
        # channels private; report failure without serializing the exception.
        print("Deployment credential operation failed; inspect access and field ownership securely", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
