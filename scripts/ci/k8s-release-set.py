"""Snapshot and restore a namespaced release set; no database rollback implied."""
import json
import os
from pathlib import Path
import subprocess
import sys


def kubectl(*args, data=None):
    result = subprocess.run(['kubectl', *args], input=data, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout


def clean(obj):
    obj = json.loads(json.dumps(obj))
    obj.pop('status', None)
    for key in ('uid', 'resourceVersion', 'generation', 'creationTimestamp', 'managedFields'):
        obj['metadata'].pop(key, None)
    obj['metadata'].get('annotations', {}).pop('kubectl.kubernetes.io/last-applied-configuration', None)
    return obj


def apply_set(namespace, state_path, files):
    resources = []
    # Validate the entire release before its first mutation.
    for file in files:
        kubectl('apply', '--dry-run=server', '-n', namespace, '-f', file)
        parsed = json.loads(kubectl('create', '--dry-run=client', '-n', namespace, '-f', file, '-o', 'json'))
        resources.extend(parsed.get('items', [parsed]))
    records = []
    for obj in resources:
        meta = obj['metadata']
        if meta.get('namespace', namespace) != namespace:
            raise ValueError('Release resource namespace mismatch')
        if obj['kind'] not in ('Deployment', 'ConfigMap', 'Service', 'Ingress'):
            raise ValueError('Unsupported release resource kind')
        target = obj['kind'].lower() + '/' + meta['name']
        prior = kubectl('get', target, '-n', namespace, '--ignore-not-found', '-o', 'json').strip()
        records.append({'target': target, 'prior': clean(json.loads(prior)) if prior else None})
    path = Path(state_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'namespace': namespace, 'resources': records}))
    path.chmod(0o600)
    output = os.environ.get('GITHUB_OUTPUT')
    if output:
        with open(output, 'a') as f:
            f.write('mutated=true\n')  # Before the first possibly partial apply.
    for file in files:
        kubectl('apply', '-n', namespace, '-f', file)
    for item in records:
        if item['target'].startswith('deployment/'):
            kubectl('rollout', 'status', item['target'], '-n', namespace, '--timeout=300s')


def restore(state_path):
    state = json.loads(Path(state_path).read_text())
    errors = []
    for item in state['resources']:
        try:
            if item['prior'] is None:
                kubectl('delete', item['target'], '-n', state['namespace'], '--ignore-not-found')
            else:
                kubectl('apply', '-n', state['namespace'], '-f', '-', data=json.dumps(item['prior']))
        except RuntimeError as exc:
            errors.append(str(exc))
    for item in state['resources']:
        if item['prior'] and item['target'].startswith('deployment/'):
            try:
                kubectl('rollout', 'status', item['target'], '-n', state['namespace'], '--timeout=180s')
            except RuntimeError as exc:
                errors.append(str(exc))
    if errors:
        raise RuntimeError('Release set restore incomplete: ' + '\n'.join(errors))


if __name__ == '__main__':
    if sys.argv[1] == 'apply':
        apply_set(sys.argv[2], sys.argv[3], sys.argv[4:])
    elif sys.argv[1] == 'restore':
        restore(sys.argv[2])
    else:
        raise SystemExit('Expected apply or restore')
