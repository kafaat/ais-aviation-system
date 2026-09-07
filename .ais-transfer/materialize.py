"""One-shot data transfer: create Git objects only; never move a remote ref."""
import base64
import hashlib
import json
import lzma
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.request

REPO = 'kafaat/ais-aviation-system'
BASE = 'be922c7c7aa489c831210ef6789fd30c63dbcc75'
MAIN = '5788af7ce9e946a0318171f8849d7f2b5edb44bd'
MAIN_TREE = 'c1ffe68b5b78d6fcb442eec67c3959d27e5ecb8b'
CANDIDATE = 'cd8272503316fae6b2e3e926218ea64da090b6d1'
PATCH_SHA256 = '92715dba14cf2c0ab170144987dc158f0f2aaabe3ecffd09f236f2a057436e66'
EXPECTED_UPSTREAM = {'.github/workflows/ci-cd.yml', '.github/workflows/pr-checks.yml', '.github/workflows/release.yml', '.gitignore', 'CHANGELOG.md', 'auth-service/requirements.txt', 'docs/PROJECT_GAP_AUDIT_2026-09.md', 'package.json', 'pnpm-lock.yaml', 'server/services/report-export.service.test.ts', 'server/services/report-export.service.ts'}
OVERLAP = {'.github/workflows/ci-cd.yml', '.gitignore', 'package.json'}
HERE = Path(__file__).resolve().parent


def git(*args, data=None):
    return subprocess.check_output(['git', '-c', 'core.hooksPath=/dev/null', *args], input=data)


def api(path, data=None):
    req = urllib.request.Request('https://api.github.com/repos/' + REPO + '/' + path,
        data=None if data is None else json.dumps(data, ensure_ascii=False).encode(),
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'ais-authorized-source-transfer'})
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.load(response)


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Unexpected merge context: ' + old[:90])
    return text.replace(old, new, 1)


def snapshot(ref):
    entries = {}
    for row in git('ls-tree', '-rz', ref).split(b'\0'):
        if row:
            metadata, name = row.split(b'\t', 1)
            mode, kind, sha = metadata.decode().split()
            if kind != 'blob' or mode not in {'100644', '100755'}:
                raise RuntimeError('Non-regular source entry')
            entries[name.decode()] = {'mode': mode, 'sha': sha, 'type': kind}
    return entries


def main():
    if os.environ.get('GITHUB_REPOSITORY') != REPO:
        raise RuntimeError('Wrong repository')
    if api('git/ref/heads/main')['object']['sha'] != MAIN:
        raise RuntimeError('main moved; re-evaluate before transfer')
    if git('rev-parse', 'HEAD').decode().strip() != MAIN:
        raise RuntimeError('Wrong checkout')
    if git('rev-parse', MAIN + '^{tree}').decode().strip() != MAIN_TREE:
        raise RuntimeError('Wrong main tree')
    original = snapshot(BASE)
    upstream = snapshot(MAIN)
    parts = sorted(HERE.glob('payload-*.part'))
    if len(parts) != 7:
        raise RuntimeError('Incomplete payload')
    patch = lzma.decompress(b''.join(p.read_bytes() for p in parts), memlimit=256 * 1024 * 1024)
    if hashlib.sha256(patch).hexdigest() != PATCH_SHA256:
        raise RuntimeError('Payload checksum mismatch')
    git('checkout', '--detach', BASE)
    git('apply', '--check', '-', data=patch)
    git('apply', '--index', '-', data=patch)
    if git('write-tree').decode().strip() != CANDIDATE:
        raise RuntimeError('Candidate does not match delivered archive tree')
    candidate = snapshot(CANDIDATE)
    changed_upstream = {p for p in original.keys() | upstream.keys() if original.get(p) != upstream.get(p)}
    if changed_upstream != EXPECTED_UPSTREAM:
        raise RuntimeError('Unexpected upstream delta')
    actual_overlap = {p for p in changed_upstream if original.get(p) != candidate.get(p)}
    if actual_overlap != OVERLAP:
        raise RuntimeError('Unexpected overlap')
    for path in sorted(changed_upstream - OVERLAP):
        git('checkout', MAIN, '--', path)
    for path in sorted(OVERLAP):
        old = git('show', BASE + ':' + path).decode()
        current = git('show', MAIN + ':' + path).decode()
        proposed = Path(path).read_text()
        if path == 'package.json':
            a, b, c = map(json.loads, (old, current, proposed))
            if {k:v for k,v in a.items() if k != 'scripts'} != {k:v for k,v in c.items() if k != 'scripts'}:
                raise RuntimeError('Candidate altered dependencies outside script delta')
            for key in a['scripts'].keys() | c['scripts'].keys():
                if a['scripts'].get(key) != c['scripts'].get(key):
                    if b['scripts'].get(key) != a['scripts'].get(key):
                        raise RuntimeError('Upstream script conflict: ' + key)
                    if key in c['scripts']:
                        b['scripts'][key] = c['scripts'][key]
                    else:
                        b['scripts'].pop(key, None)
            merged = json.dumps(b, indent=2, ensure_ascii=False) + '\n'
        elif path == '.gitignore':
            if not current.startswith(old) or not proposed.startswith(old):
                raise RuntimeError('Non-additive gitignore conflict')
            tail = [line for line in proposed[len(old):].splitlines() if not line or line not in current.splitlines()]
            merged = current + '\n'.join(tail) + '\n'
        else:
            merged = replace_once(proposed,
                '      url: ${{ vars.PRODUCTION_URL }}\n    env:\n      DEPLOY_ENV: production',
                '      url: ${{ vars.PRODUCTION_URL }}\n    # Distinguish a real deployment from a skipped, unconfigured cluster.\n    outputs:\n      deployed: ${{ steps.kube-config.outputs.configured }}\n    env:\n      DEPLOY_ENV: production')
            merged = replace_once(merged,
                '    needs: deploy-production\n    if: success()\n',
                "    needs: deploy-production\n    # Preserve the upstream guard: monitor only after a real deployment.\n    if: >-\n      success() &&\n      needs.deploy-production.outputs.deployed == 'true' &&\n      vars.PRODUCTION_URL != ''\n")
            merged = replace_once(merged,
                '      - name: Monitor error rates for 5 minutes\n        run: |',
                '      - name: Monitor error rates for 5 minutes\n        env:\n          PRODUCTION_URL: ${{ vars.PRODUCTION_URL }}\n        run: |')
            merged = replace_once(merged,
                '${{ vars.PRODUCTION_URL }}/api/trpc/health.ready || echo "000")',
                '"${PRODUCTION_URL%/}/api/trpc/health.ready" || echo "000")')
            for required in ("needs.deploy-production.outputs.deployed == 'true'", "vars.PRODUCTION_URL != ''", 'deployed: ${{ steps.kube-config.outputs.configured }}'):
                if required not in current or required not in merged:
                    raise RuntimeError('Upstream deployment guard lost')
        Path(path).write_text(merged)
        git('add', '--', path)
    git('diff', '--cached', '--check', MAIN)
    expected_tree = git('write-tree').decode().strip()
    final = snapshot(expected_tree)
    if set(final) != set(candidate):
        raise RuntimeError('Unexpected file addition/removal during rebase')
    for path in final:
        if path not in OVERLAP:
            expected = upstream[path] if path in changed_upstream else candidate[path]
            if final[path] != expected:
                raise RuntimeError('Lost source identity at ' + path)
    # No application code is executed with this token. Objects are uploaded as data.
    # The connector, not this workflow, must separately create the reviewed ref.
    known_shas = {v['sha'] for v in original.values()} | {v['sha'] for v in upstream.values()}
    entries = []
    for path in sorted(upstream.keys() | final.keys()):
        before, after = upstream.get(path), final.get(path)
        if before == after:
            continue
        if after is None:
            entries.append({'path': path, 'mode': before['mode'], 'type': 'blob', 'sha': None})
            continue
        entry = {'path': path, 'mode': after['mode'], 'type': 'blob'}
        if after['sha'] in known_shas:
            entry['sha'] = after['sha']
        else:
            entry['content'] = git('cat-file', 'blob', after['sha']).decode('utf8')
        entries.append(entry)
    result = api('git/trees', {'base_tree': MAIN_TREE, 'tree': entries})
    if result['sha'] != expected_tree:
        raise RuntimeError('Remote tree does not match local materialization')
    summary = {'status': 'OBJECT_TRANSFER_VERIFIED_NO_REF_UPDATED', 'repository': REPO,
        'parent': MAIN, 'tree': expected_tree, 'archive_tree': CANDIDATE,
        'archive_sha256': '684809bcfba89b5343b743b64fb288008ee10215763ba523125de88934f34b84',
        'files': len(final), 'tree_entries_changed': len(entries),
        'upstream_files_preserved': sorted(changed_upstream - OVERLAP),
        'merged_paths': sorted(OVERLAP), 'changed_objects': {p:final.get(p) for p in sorted(upstream.keys() | final.keys()) if upstream.get(p) != final.get(p)}}
    output = Path(os.environ['RUNNER_TEMP']) / 'ais-source-transfer.json'
    output.write_text(json.dumps(summary, indent=2) + '\n')
    print('AIS_TRANSFER_RESULT=' + json.dumps({k:v for k,v in summary.items() if k != 'changed_objects'}, sort_keys=True))


if __name__ == '__main__':
    main()
