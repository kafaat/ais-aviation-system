from pathlib import Path
import re
import subprocess

PATTERN = re.compile(
    r"(uses:\s*)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)(/[A-Za-z0-9_./-]+)?@([^\s#]+)"
)


def resolve(repo: str, ref: str) -> str:
    if re.fullmatch(r"[0-9a-fA-F]{40}", ref):
        return ref
    url = f"https://github.com/{repo}.git"
    for candidate in (
        f"refs/tags/{ref}^{{}}",
        f"refs/tags/{ref}",
        f"refs/heads/{ref}",
    ):
        cp = subprocess.run(
            ["git", "ls-remote", url, candidate],
            check=True,
            text=True,
            capture_output=True,
        )
        lines = [line for line in cp.stdout.splitlines() if line.strip()]
        if lines:
            sha = lines[0].split()[0]
            if re.fullmatch(r"[0-9a-f]{40}", sha):
                return sha
    raise RuntimeError(f"Cannot resolve {repo}@{ref}")


def main() -> None:
    production_gates = Path(".github/workflows/production-gates.yml")
    text = production_gates.read_text()
    if "name: Action SHA Pinning" not in text:
        text = text.replace(
            "jobs:\n",
            "jobs:\n"
            "  action-pinning:\n"
            "    name: Action SHA Pinning\n"
            "    runs-on: ubuntu-latest\n"
            "    steps:\n"
            "      - uses: actions/checkout@v4\n"
            "      - name: Reject mutable external action references\n"
            "        run: python3 scripts/ci/check_action_pins.py\n\n",
            1,
        )
        production_gates.write_text(text)

    cache: dict[tuple[str, str], str] = {}
    for path in sorted(Path(".github/workflows").glob("*.y*ml")):
        source = path.read_text()

        def repl(match: re.Match[str]) -> str:
            prefix, repo, subpath, ref = match.groups()
            key = (repo, ref)
            sha = cache.setdefault(key, resolve(repo, ref))
            return f"{prefix}{repo}{subpath or ''}@{sha}"

        path.write_text(PATTERN.sub(repl, source))

    guard = Path("scripts/ci/check_action_pins.py")
    guard.write_text(
        'from pathlib import Path\n'
        'import re, sys\n'
        'pat=re.compile(r"uses:\\s*([^\\s#]+)@([^\\s#]+)")\n'
        'bad=[]\n'
        'for path in sorted(Path(".github/workflows").glob("*.y*ml")):\n'
        '    for n,line in enumerate(path.read_text().splitlines(),1):\n'
        '        m=pat.search(line)\n'
        '        if not m: continue\n'
        '        target,ref=m.groups()\n'
        '        if target.startswith("./"): continue\n'
        '        if not re.fullmatch(r"[0-9a-fA-F]{40}",ref): bad.append(f"{path}:{n}: {target}@{ref}")\n'
        'if bad:\n'
        '    print("External GitHub Actions must be pinned to full commit SHAs:",file=sys.stderr)\n'
        '    print("\\n".join(bad),file=sys.stderr)\n'
        '    raise SystemExit(1)\n'
        'print("PASS: all external workflow actions are SHA-pinned")\n'
    )
    for (repo, ref), sha in sorted(cache.items()):
        print(f"{repo}@{ref} -> {sha}")


if __name__ == "__main__":
    main()
