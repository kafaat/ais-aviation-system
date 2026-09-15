# Deployment credential transport

The Kubernetes staging and production steps use `scripts/deploy/kubernetes_secrets.py`. All 32 existing settings remain bound through step environment variables. Values are read by Python, encoded into a Secret `data` map and passed directly to kubectl stdin as JSON. This preserves empty strings, quotes, Unicode, embedded newlines and trailing newlines without shell or YAML interpolation.

The helper never prints the manifest or secret values and removes the bound values from kubectl's child environment. Kubectl stdout/stderr are suppressed because provider diagnostics may echo the submitted object. A nonzero exit, missing environment binding, timeout or serialization error fails the workflow with a fixed diagnostic. Review connectivity, RBAC and field ownership through authorized cluster tooling rather than enabling verbose payload logging.

Server-side apply uses the `ais-secrets` field manager and does not force ownership conflicts. It does not create a client-side last-applied annotation. Existing annotations from earlier deployments are not automatically removed; an operator must audit and reconcile legacy metadata and field ownership before enabling this deployment path. Secret data remains accessible to authorized Kubernetes readers; base64 is not encryption. No live cluster or operator acceptance is claimed here.

## Kubeconfig lifecycle

Kubeconfig enters the configure helper through an environment binding, rather than interpolation into shell source. It is decoded and written with mode 0600 before any credential bytes are written. Existing file symlinks are rejected. Each deployment job removes its runner kubeconfig in an `always()` cleanup step. Cancellation, host failure or SIGKILL can prevent cleanup; runner isolation and disposal remain required.

No application-secret manifest is written to a temporary file. Kubeconfig is an explicit exception needed by subsequent deployment tools. File removal is not a claim of physical erasure, and overwriting with shred would not guarantee removal from SSD, copy-on-write storage, snapshots or backups.

## Executable evidence

Run `python3 -m unittest discover -s scripts/deploy -p 'test_*.py' -v`. The same command runs in CI's lint job.

The seven tests use synthetic values and a fake kubectl executable. They check exact decoded value hashes, the actual child's `/proc/self/cmdline`, supplied parent invocation arguments, child environment scrubbing, failure-output suppression, the synthetic report, kubeconfig bytes/permissions/symlink handling, and complete key bindings in both workflow environments. The fake client deliberately echoes the entire manifest on failure; those bytes must not reach the captured workflow output. Only a boolean verification report is written.

This is a bounded local/CI harness. It is not a scan of historical production logs or artifacts and does not protect secrets from a compromised runner, privileged process, memory reader, unauthorized kubeconfig plugin or Kubernetes administrator. GitHub secret masking remains a secondary control; this helper does not rely on emitting raw masking commands. Docker Compose still uses its existing environment contract and is not claimed to hide credentials from authorized container inspection. No External Secrets Operator, secret store or operator credentials are invented.

Local verification passed all seven tests. In an isolated temporary copy, removing stdout/stderr suppression made the deliberate-output leakage test fail. This mutation was discarded after verification. Cluster acceptance remains pending.
