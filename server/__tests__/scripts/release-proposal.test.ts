import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { format } from "prettier";
import { gitReader } from "../../../scripts/ci/release-publication.js";
import {
  commitProposal,
  generateReleaseNotes,
  hasCurrentChecks,
  prepareProposal,
  renderProposalBody,
  renderProposalChangelog,
  selectProposalVersion,
} from "../../../scripts/ci/release-proposal.mjs";

const source = "a".repeat(40);
const nextSource = "b".repeat(40);
const version = "1.1.0";
const branch = `release/v${version}`;
const notesStart = "<!-- ais-release-notes:start -->";
const notesEnd = "<!-- ais-release-notes:end -->";
const bodyStart = "<!-- ais-release-proposal:start -->";
const bodyEnd = "<!-- ais-release-proposal:end -->";
// A past published release can itself have bot-managed notes. Its source marker
// is historical content, not a second source for the current proposal.
const publishedHistory =
  "## What's Changed in v1.0.0\n\n- Published contract.\n\n---\n\n" +
  "## What's Changed in v0.9.0\n\n" +
  `<!-- ais-release-source: ${"c".repeat(40)} -->\n${notesStart}\n\n` +
  `- Older published contract.\n\n${notesEnd}`;
const baseChangelog = `# Changelog\n\n${publishedHistory}\n`;
const directories: string[] = [];

function releaseNotes(message = "First fix", releaseVersion = version) {
  return (
    `## What's Changed in v${releaseVersion}\n\n### Bug Fixes\n\n` +
    `- ${message}\n\n**Full Changelog**: ` +
    `https://github.com/fixture/repo/compare/v1.0.0...v${releaseVersion}\n`
  );
}

function renderInitial(changelog = baseChangelog) {
  return renderProposalChangelog({
    version,
    source,
    notes: releaseNotes(),
    baseChangelog: changelog,
    previousChangelog: undefined,
    previousBaseChangelog: undefined,
  });
}

function fixture(changelog = baseChangelog) {
  const root = mkdtempSync(join(tmpdir(), "ais-release-proposal-"));
  directories.push(root);
  const cwd = join(root, "checkout");
  const remote = join(root, "origin.git");
  mkdirSync(cwd);
  mkdirSync(remote);
  gitReader(remote)("init", "--bare", "--initial-branch=main");
  const git = gitReader(cwd);
  git("init", "-b", "main");
  git("config", "user.name", "Release Proposal Test");
  git("config", "user.email", "release-proposal@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  git("remote", "add", "origin", remote);
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify(
      { name: "fixture", version: "1.0.0", scripts: { start: "node app.js" } },
      null,
      2
    ) + "\n"
  );
  writeFileSync(join(cwd, "CHANGELOG.md"), changelog);
  writeFileSync(join(cwd, "app.js"), "export const generation = 1;\n");
  git("add", ".");
  git("commit", "-m", "source fixture");
  git("push", "-u", "origin", "main");
  return {
    root,
    cwd,
    remote,
    git,
    source: git("rev-parse", "HEAD"),
    changelog,
  };
}

type Fixture = ReturnType<typeof fixture>;

function committedFile(f: Fixture, commit: string, path: string) {
  return execFileSync("git", ["show", `${commit}:${path}`], {
    cwd: f.cwd,
    encoding: "utf8",
  });
}

function propose(f: Fixture, sourceSha = f.source, message = "First fix") {
  f.git("checkout", "--detach", sourceSha);
  const prepared = prepareProposal(f.git, {
    version,
    source: sourceSha,
    notes: releaseNotes(message),
    cwd: f.cwd,
  });
  expect(prepared.skip).toBe("false");
  const committed = commitProposal(f.git, {
    version,
    source: sourceSha,
    previous: prepared.previous_head,
  });
  return { prepared, ...committed };
}

function pushProposal(f: Fixture, head: string) {
  f.git("push", "origin", `${head}:refs/heads/${branch}`);
}

function remoteProposal(f: Fixture) {
  return f.git("ls-remote", "--heads", "origin", `refs/heads/${branch}`);
}

function advanceMain(f: Fixture) {
  f.git("checkout", "main");
  writeFileSync(join(f.cwd, "app.js"), "export const generation = 2;\n");
  const pkg = JSON.parse(readFileSync(join(f.cwd, "package.json"), "utf8"));
  pkg.scripts.check = "node --check app.js";
  writeFileSync(
    join(f.cwd, "package.json"),
    JSON.stringify(pkg, null, 2) + "\n"
  );
  f.git("add", "app.js", "package.json");
  f.git("commit", "-m", "fix: advance application and package commands");
  f.git("push", "origin", "main");
  return f.git("rev-parse", "HEAD");
}

function classifyTrigger(f: Fixture, event = "push", releaseType = "") {
  // Execute the workflow's literal Bash block, rather than reproducing its
  // classification in a test double. jq and Git are also used by that job.
  const workflow = readFileSync(
    join(process.cwd(), ".github", "workflows", "release.yml"),
    "utf8"
  ).split("\n");
  const step = workflow.findIndex(
    line => line.trim() === "- name: Classify the trigger"
  );
  if (step < 0) throw new Error("Missing release classifier workflow step");
  const run = workflow.findIndex(
    (line, index) => index > step && line.trim() === "run: |"
  );
  if (run < 0) throw new Error("Missing classifier shell block");
  const indentation = workflow[run].indexOf("run:") + 2;
  const script: string[] = [];
  for (const line of workflow.slice(run + 1)) {
    if (line.trim() && !line.startsWith(" ".repeat(indentation))) break;
    script.push(line.slice(indentation));
  }
  const output = join(f.root, "classify-output");
  writeFileSync(output, "");
  execFileSync("bash", ["-c", script.join("\n")], {
    cwd: f.cwd,
    env: {
      ...process.env,
      GITHUB_OUTPUT: output,
      RESUME_TAG: "",
      INPUT_RELEASE_TYPE: releaseType,
      EVENT_NAME: event,
    },
    stdio: "pipe",
  });
  return Object.fromEntries(
    readFileSync(output, "utf8")
      .trim()
      .split("\n")
      .map(line => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ])
  );
}

function advanceDocumentation(f: Fixture) {
  f.git("checkout", "main");
  writeFileSync(join(f.cwd, "README.md"), "Reviewed operator procedure.\n");
  f.git("add", "README.md");
  f.git("commit", "-m", "docs: clarify operator procedure");
  f.git("push", "origin", "main");
  return f.git("rev-parse", "HEAD");
}

afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("release proposal version selection", () => {
  it("ignores published release branches while selecting a new proposal", () => {
    const remoteRefs =
      `${source}\trefs/heads/release/v1.0.0\n` +
      `${nextSource}\trefs/tags/v1.0.0\n` +
      `${source}\trefs/tags/v1.0.0^{}\n`;
    expect(
      selectProposalVersion({
        candidate: version,
        current: "1.0.0",
        remoteRefs,
      })
    ).toBe(version);
  });

  it.each(["1.1.0", "1.1.0-rc.202611050001", "2.0.0"])(
    "retains compatible open version %s during automatic refresh",
    openVersion => {
      expect(
        selectProposalVersion({
          candidate: version,
          current: "1.0.0",
          remoteRefs: `${source}\trefs/heads/release/v${openVersion}`,
        })
      ).toBe(openVersion);
    }
  );

  it("retains a custom prerelease's committed timestamp on a repeated request", () => {
    expect(
      selectProposalVersion({
        candidate: "1.1.0-rc.202611050100",
        current: "1.0.0",
        remoteRefs: `${source}\trefs/heads/release/v1.1.0-rc.202611050001`,
        customVersion: "v1.1.0",
        requestedPrerelease: true,
        manual: true,
      })
    ).toBe("1.1.0-rc.202611050001");
  });

  it("rejects an open patch proposal when new changes require a minor version", () => {
    expect(() =>
      selectProposalVersion({
        candidate: version,
        current: "1.0.0",
        remoteRefs: `${source}\trefs/heads/release/v1.0.1`,
      })
    ).toThrow("below the required");
  });

  it.each([
    ["1.1.0", true],
    ["1.1.0-rc.1", false],
  ] as const)(
    "rejects a manual release-kind change for existing %s",
    (openVersion, requestedPrerelease) => {
      expect(() =>
        selectProposalVersion({
          candidate: version,
          current: "1.0.0",
          remoteRefs: `${source}\trefs/heads/release/v${openVersion}`,
          requestedPrerelease,
          manual: true,
        })
      ).toThrow("different prerelease choice");
    }
  );

  it("rejects an explicitly different custom version and competing proposals", () => {
    const refs = `${source}\trefs/heads/release/v2.0.0`;
    expect(() =>
      selectProposalVersion({
        candidate: version,
        current: "1.0.0",
        remoteRefs: refs,
        customVersion: version,
        manual: true,
      })
    ).toThrow("open release");
    expect(() =>
      selectProposalVersion({
        candidate: version,
        current: "1.0.0",
        remoteRefs: `${refs}\n${nextSource}\trefs/heads/release/v${version}`,
      })
    ).toThrow("Several unpublished");
  });

  it("rejects an obsolete open version after main's package version advances", () => {
    expect(() =>
      selectProposalVersion({
        candidate: "1.2.0",
        current: "1.1.0",
        remoteRefs: `${source}\trefs/heads/release/v1.0.1`,
      })
    ).toThrow("does not advance");
  });
});

describe("release workflow trigger classification", () => {
  it("refreshes a manual proposal after documentation alone advances main", () => {
    const f = fixture();
    f.git("tag", "v1.0.0");
    f.git("push", "origin", "refs/tags/v1.0.0");
    expect(classifyTrigger(f, "workflow_dispatch", "minor")).toMatchObject({
      mode: "propose",
      release_type: "minor",
    });
    const manual = propose(f, f.source, "Manual release review");
    pushProposal(f, manual.head);
    const advanced = advanceDocumentation(f);

    expect(classifyTrigger(f)).toMatchObject({
      mode: "propose",
      release_type: "existing",
    });
    // The version job skips calculation for this mode, so exercise the actual
    // selector CLI with an empty candidate and the workflow's reuse flag.
    const selected = join(f.root, "selected-version-output");
    execFileSync(
      process.execPath,
      [join(process.cwd(), "scripts", "ci", "release-proposal.mjs"), "select"],
      {
        cwd: f.cwd,
        env: {
          ...process.env,
          GITHUB_OUTPUT: selected,
          CANDIDATE_VERSION: "",
          CUSTOM_VERSION: "",
          RELEASE_PRERELEASE: "",
          EVENT_NAME: "push",
          REUSE_OPEN_PROPOSAL: "true",
        },
        stdio: "pipe",
      }
    );
    expect(readFileSync(selected, "utf8")).toBe(
      `current_version=1.0.0\nnew_version=${version}\n`
    );
    expect(remoteProposal(f)).toBe(`${manual.head}\trefs/heads/${branch}`);
    expect(f.git("rev-parse", "HEAD")).toBe(advanced);
  });

  it("does not create a release for documentation alone without an open proposal", () => {
    const f = fixture();
    f.git("tag", "v1.0.0");
    f.git("push", "origin", "refs/tags/v1.0.0");
    advanceDocumentation(f);
    expect(classifyTrigger(f)).toMatchObject({
      mode: "none",
      release_type: "none",
    });
    expect(remoteProposal(f)).toBe("");
  });

  it("does not mistake a published release's leftover branch for an open proposal", () => {
    const f = fixture();
    f.git("tag", "v1.0.0");
    f.git("push", "origin", "refs/tags/v1.0.0");
    f.git("push", "origin", `${f.source}:refs/heads/release/v1.0.0`);
    advanceDocumentation(f);
    expect(classifyTrigger(f)).toMatchObject({
      mode: "none",
      release_type: "none",
    });
    expect(
      f.git("ls-remote", "--heads", "origin", "refs/heads/release/v1.0.0")
    ).toBe(`${f.source}\trefs/heads/release/v1.0.0`);
  });
});

describe("managed release notes", () => {
  it("generates the full tagged range once per category and preserves literal commit text", () => {
    const f = fixture();
    f.git("tag", "v1.0.0");
    const subjects = [
      "feat(reporting): add an export source",
      "fix: retain literal \\n and $(touch release-note-command)",
      "perf: batch scoped reads",
      "refactor: simplify the reader",
      "docs: record acceptance limits",
      "ci: refresh a pinned action",
      "fixation on another subject is not a conventional fix",
    ];
    for (const subject of subjects)
      f.git(
        "commit",
        "--allow-empty",
        "-m",
        subject,
        "-m",
        "Private commit body is not a release-note subject."
      );
    const notes = generateReleaseNotes(f.git, version, "fixture/repo");
    for (const subject of subjects)
      expect(notes.split(subject)).toHaveLength(2);
    for (const heading of [
      "Features",
      "Bug Fixes",
      "Performance Improvements",
      "Code Refactoring",
      "Documentation",
      "Maintenance",
      "Other Changes",
    ])
      expect(notes).toContain(`### ${heading}\n`);
    expect(notes).not.toContain("source fixture");
    expect(notes).not.toContain("Private commit body");
    expect(notes).not.toContain("retain literal \n");
    expect(notes).toContain(
      `https://github.com/fixture/repo/compare/v1.0.0...v${version}`
    );
  });

  it("generates initial release notes without inventing a previous tag", () => {
    const f = fixture();
    const notes = generateReleaseNotes(f.git, version, "fixture/repo");
    expect(notes).toContain(`## What's Changed in v${version}\n`);
    expect(notes).toContain("source fixture");
    expect(notes).not.toContain("Full Changelog");
  });

  it("refreshes only its managed block while preserving manual text and historical bytes", () => {
    const manualBefore = "### Upgrade review\n\nRun the approved migrator.\n\n";
    const manualAfter =
      "\n\n### Acceptance\n\nProvider acceptance is still pending.\n";
    const previous = renderInitial()
      .replace(
        `<!-- ais-release-source: ${source}`,
        `${manualBefore}<!-- ais-release-source: ${source}`
      )
      .replace(notesEnd, `${notesEnd}${manualAfter}`);
    const refreshed = renderProposalChangelog({
      version,
      source: nextSource,
      notes: releaseNotes("Second fix"),
      baseChangelog,
      previousChangelog: previous,
      previousBaseChangelog: baseChangelog,
    });
    expect(refreshed).toContain(manualBefore);
    expect(refreshed).toContain(manualAfter.trimEnd());
    expect(refreshed).toContain(`<!-- ais-release-source: ${nextSource} -->`);
    expect(refreshed).not.toContain("- First fix");
    expect(refreshed).toContain("- Second fix");
    expect(
      refreshed.endsWith(baseChangelog.slice("# Changelog\n\n".length))
    ).toBe(true);
  });

  it.each(["", "\n\n", "\n \n"])(
    "preserves the full historical suffix with trailing bytes %j",
    ending => {
      const original = `# Changelog\n\n${publishedHistory}${ending}`;
      const previous = renderInitial(original);
      const refreshed = renderProposalChangelog({
        version,
        source: nextSource,
        notes: releaseNotes("Second fix"),
        baseChangelog: original,
        previousChangelog: previous,
        previousBaseChangelog: original,
      });
      expect(refreshed.endsWith(publishedHistory + ending)).toBe(true);
    }
  );

  it.each([
    ["unmanaged notes", (text: string) => text.replace(notesStart, "")],
    [
      "nested start",
      (text: string) =>
        text.replace(notesStart, `${notesStart}\n${notesStart}`),
    ],
    [
      "extra end",
      (text: string) => text.replace(notesEnd, `${notesEnd}\n${notesEnd}`),
    ],
    [
      "changed history",
      (text: string) =>
        text.replace(
          "- Published contract.",
          "- Rewritten published contract."
        ),
    ],
    ["wrong heading", (text: string) => text.replace(`v${version}`, "v1.2.0")],
  ] as const)("refuses to overwrite %s", (_name, edit) => {
    expect(() =>
      renderProposalChangelog({
        version,
        source: nextSource,
        notes: releaseNotes("Second fix"),
        baseChangelog,
        previousChangelog: edit(renderInitial()),
        previousBaseChangelog: baseChangelog,
      })
    ).toThrow();
  });

  it("rejects a mismatched generated release heading", () => {
    expect(() =>
      renderProposalChangelog({
        version,
        source,
        notes: releaseNotes("Wrong version", "1.2.0"),
        baseChangelog,
        previousChangelog: undefined,
        previousBaseChangelog: undefined,
      })
    ).toThrow("selected release version");
  });
});

describe("release proposal Git lifecycle", () => {
  it("remains idempotent after the same Prettier formatting used by the workflow", async () => {
    const canonicalHistory = await format(baseChangelog, {
      parser: "markdown",
    });
    const f = fixture(canonicalHistory);
    async function formattedProposal() {
      f.git("checkout", "--detach", f.source);
      const prepared = prepareProposal(f.git, {
        version,
        source: f.source,
        notes: releaseNotes(),
        cwd: f.cwd,
      });
      for (const [path, parser] of [
        ["CHANGELOG.md", "markdown"],
        ["package.json", "json"],
      ]) {
        const absolute = join(f.cwd, path);
        writeFileSync(
          absolute,
          await format(readFileSync(absolute, "utf8"), { parser })
        );
      }
      return commitProposal(f.git, {
        version,
        source: f.source,
        previous: prepared.previous_head,
      });
    }
    const first = await formattedProposal();
    pushProposal(f, first.head);
    const rerun = await formattedProposal();
    expect(rerun).toEqual({ changed: "false", head: first.head });
    expect(
      committedFile(f, first.head, "CHANGELOG.md").endsWith(
        canonicalHistory.slice("# Changelog\n\n".length)
      )
    ).toBe(true);
    expect(f.git("status", "--porcelain")).toBe("");
  });

  it.each(["", "\n\n"])(
    "refreshes from advanced main without losing human notes or history (suffix %j), then does nothing on rerun",
    ending => {
      const f = fixture(`# Changelog\n\n${publishedHistory}${ending}`);
      const first = propose(f);
      expect(first.changed).toBe("true");
      expect(f.git("rev-parse", `${first.head}^`)).toBe(f.source);
      pushProposal(f, first.head);

      const manualNote =
        "\n\n### Operator review\n\nKeep the migration preflight.\n";
      writeFileSync(
        join(f.cwd, "CHANGELOG.md"),
        readFileSync(join(f.cwd, "CHANGELOG.md"), "utf8").replace(
          notesEnd,
          `${notesEnd}${manualNote}`
        )
      );
      f.git("add", "CHANGELOG.md");
      f.git("commit", "-m", "docs: record operator migration review");
      const reviewed = f.git("rev-parse", "HEAD");
      pushProposal(f, reviewed);

      const currentSource = advanceMain(f);
      const refreshed = propose(f, currentSource, "Second fix");
      expect(refreshed.prepared.previous_head).toBe(reviewed);
      expect(refreshed.changed).toBe("true");
      expect(f.git("rev-parse", `${refreshed.head}^1`)).toBe(reviewed);
      expect(f.git("rev-parse", `${refreshed.head}^2`)).toBe(currentSource);
      expect(f.git("diff", "--name-only", currentSource, refreshed.head)).toBe(
        "CHANGELOG.md\npackage.json"
      );
      expect(committedFile(f, refreshed.head, "app.js")).toBe(
        "export const generation = 2;\n"
      );
      const pkg = JSON.parse(committedFile(f, refreshed.head, "package.json"));
      expect(pkg).toEqual({
        name: "fixture",
        version,
        scripts: { start: "node app.js", check: "node --check app.js" },
      });
      const changelog = committedFile(f, refreshed.head, "CHANGELOG.md");
      expect(changelog).toContain(manualNote.trimEnd());
      expect(changelog).toContain(
        `<!-- ais-release-source: ${currentSource} -->`
      );
      expect(changelog).toContain("- Second fix");
      expect(changelog).not.toContain("- First fix");
      expect(changelog.endsWith(publishedHistory + ending)).toBe(true);
      expect(f.git("status", "--porcelain")).toBe("");
      pushProposal(f, refreshed.head);

      const rerun = propose(f, currentSource, "Second fix");
      expect(rerun.changed).toBe("false");
      expect(rerun.head).toBe(refreshed.head);
      expect(f.git("status", "--porcelain")).toBe("");
      expect(remoteProposal(f)).toBe(`${refreshed.head}\trefs/heads/${branch}`);
    }
  );

  it("skips a stale source before mutating files or the release branch", () => {
    const f = fixture();
    const first = propose(f);
    pushProposal(f, first.head);
    advanceMain(f);
    f.git("checkout", "--detach", f.source);
    const before = remoteProposal(f);
    const result = prepareProposal(f.git, {
      version,
      source: f.source,
      notes: releaseNotes(),
      cwd: f.cwd,
    });
    expect(result.skip).toBe("true");
    expect(f.git("status", "--porcelain")).toBe("");
    expect(remoteProposal(f)).toBe(before);
  });

  it("refuses a dirty source checkout without discarding the local changelog edit", () => {
    const f = fixture();
    const local = "# Changelog\n\nUncommitted local replacement\n";
    writeFileSync(join(f.cwd, "CHANGELOG.md"), local);
    expect(() =>
      prepareProposal(f.git, {
        version,
        source: f.source,
        notes: releaseNotes(),
        cwd: f.cwd,
      })
    ).toThrow("uncommitted changes");
    expect(readFileSync(join(f.cwd, "CHANGELOG.md"), "utf8")).toBe(local);
    expect(committedFile(f, f.source, "CHANGELOG.md")).toBe(f.changelog);
    expect(remoteProposal(f)).toBe("");
  });

  it("refuses an already tagged release without creating a proposal", () => {
    const f = fixture();
    f.git("tag", `v${version}`);
    f.git("push", "origin", `refs/tags/v${version}`);
    expect(() => propose(f)).toThrow("already exists");
    expect(f.git("status", "--porcelain")).toBe("");
    expect(remoteProposal(f)).toBe("");
  });

  it("leaves an unmanaged legacy proposal intact for manual review", () => {
    const f = fixture();
    const pkg = JSON.parse(readFileSync(join(f.cwd, "package.json"), "utf8"));
    writeFileSync(
      join(f.cwd, "package.json"),
      JSON.stringify({ ...pkg, version }, null, 2) + "\n"
    );
    writeFileSync(
      join(f.cwd, "CHANGELOG.md"),
      `# Changelog\n\n${releaseNotes()}\n---\n\n${publishedHistory}\n`
    );
    f.git("add", "package.json", "CHANGELOG.md");
    f.git("commit", "-m", "legacy release proposal");
    const legacy = f.git("rev-parse", "HEAD");
    pushProposal(f, legacy);
    f.git("checkout", "--detach", f.source);
    expect(() =>
      prepareProposal(f.git, {
        version,
        source: f.source,
        notes: releaseNotes("Second fix"),
        cwd: f.cwd,
      })
    ).toThrow();
    expect(remoteProposal(f)).toBe(`${legacy}\trefs/heads/${branch}`);
    expect(f.git("status", "--porcelain")).toBe("");
  });

  it.each(["application code", "package commands", "published history"])(
    "rejects an outstanding proposal with changed %s without discarding its head",
    change => {
      const f = fixture();
      const first = propose(f);
      pushProposal(f, first.head);
      if (change === "application code") {
        writeFileSync(
          join(f.cwd, "app.js"),
          "export const unreviewed = true;\n"
        );
      } else if (change === "package commands") {
        const pkg = JSON.parse(
          readFileSync(join(f.cwd, "package.json"), "utf8")
        );
        pkg.scripts.start = "node different.js";
        writeFileSync(
          join(f.cwd, "package.json"),
          JSON.stringify(pkg, null, 2) + "\n"
        );
      } else {
        writeFileSync(
          join(f.cwd, "CHANGELOG.md"),
          readFileSync(join(f.cwd, "CHANGELOG.md"), "utf8").replace(
            "- Published contract.",
            "- Changed old release."
          )
        );
      }
      f.git("add", ".");
      f.git("commit", "-m", "independent branch edit");
      const edited = f.git("rev-parse", "HEAD");
      pushProposal(f, edited);
      f.git("checkout", "--detach", f.source);
      expect(() =>
        prepareProposal(f.git, {
          version,
          source: f.source,
          notes: releaseNotes("Second fix"),
          cwd: f.cwd,
        })
      ).toThrow();
      expect(remoteProposal(f)).toBe(`${edited}\trefs/heads/${branch}`);
      expect(f.git("status", "--porcelain")).toBe("");
    }
  );

  it.each(["package.json", "CHANGELOG.md"])(
    "rejects an independently changed executable bit on %s",
    path => {
      const f = fixture();
      const first = propose(f);
      pushProposal(f, first.head);
      chmodSync(join(f.cwd, path), 0o755);
      f.git("update-index", "--chmod=+x", path);
      f.git("commit", "-m", "change release file mode");
      const edited = f.git("rev-parse", "HEAD");
      pushProposal(f, edited);
      f.git("checkout", "--detach", f.source);
      expect(() =>
        prepareProposal(f.git, {
          version,
          source: f.source,
          notes: releaseNotes(),
          cwd: f.cwd,
        })
      ).toThrow("regular non-executable files");
      expect(remoteProposal(f)).toBe(`${edited}\trefs/heads/${branch}`);
      expect(f.git("status", "--porcelain")).toBe("");
    }
  );

  it("rejects unexpected staged files before a proposal commit can be pushed", () => {
    const f = fixture();
    prepareProposal(f.git, {
      version,
      source: f.source,
      notes: releaseNotes(),
      cwd: f.cwd,
    });
    writeFileSync(
      join(f.cwd, "unrelated.js"),
      "export const unrelated = true;\n"
    );
    f.git("add", "unrelated.js");
    expect(() => commitProposal(f.git, { version, source: f.source })).toThrow(
      "must change only"
    );
    expect(f.git("rev-parse", "HEAD")).toBe(f.source);
    expect(remoteProposal(f)).toBe("");
  });

  it("rejects historical notes changed between preparation and commit", () => {
    const f = fixture();
    prepareProposal(f.git, {
      version,
      source: f.source,
      notes: releaseNotes(),
      cwd: f.cwd,
    });
    writeFileSync(
      join(f.cwd, "CHANGELOG.md"),
      readFileSync(join(f.cwd, "CHANGELOG.md"), "utf8").replace(
        "- Published contract.",
        "- Formatter or script changed published history."
      )
    );
    expect(() => commitProposal(f.git, { version, source: f.source })).toThrow(
      "published changelog history"
    );
    expect(f.git("rev-parse", "HEAD")).toBe(f.source);
    expect(remoteProposal(f)).toBe("");
  });

  it("cannot overwrite an independently advanced release branch with its refresh commit", () => {
    const f = fixture();
    const first = propose(f);
    pushProposal(f, first.head);
    const other = join(f.root, "other-reviewer");
    execFileSync("git", ["clone", "--branch", branch, f.remote, other], {
      stdio: "pipe",
    });
    const reviewer = gitReader(other);
    reviewer("config", "user.name", "Other Reviewer");
    reviewer("config", "user.email", "other-reviewer@example.invalid");
    reviewer("config", "commit.gpgsign", "false");

    const currentSource = advanceMain(f);
    const refreshed = propose(f, currentSource, "Second fix");
    writeFileSync(
      join(other, "CHANGELOG.md"),
      readFileSync(join(other, "CHANGELOG.md"), "utf8").replace(
        notesEnd,
        `${notesEnd}\n\nConcurrent reviewer note.\n`
      )
    );
    reviewer("add", "CHANGELOG.md");
    reviewer("commit", "-m", "docs: concurrent release review");
    reviewer("push", "origin", `HEAD:refs/heads/${branch}`);
    const concurrent = reviewer("rev-parse", "HEAD");

    expect(() => pushProposal(f, refreshed.head)).toThrow();
    expect(remoteProposal(f)).toBe(`${concurrent}\trefs/heads/${branch}`);
    expect(f.git("rev-parse", `${refreshed.head}^1`)).toBe(first.head);
  });
});

describe("release PR description and exact-head check evidence", () => {
  it("refreshes its PR description block without overwriting human context", () => {
    const prefix = "Operator review: preserve the backup requirement.\n\n";
    const suffix = "\n\nIndependent reviewer findings stay here.\n";
    const old = renderProposalBody({ version, source, notes: releaseNotes() });
    const refreshed = renderProposalBody({
      version,
      source: nextSource,
      notes: releaseNotes("Second fix"),
      previousBody: prefix + old + suffix,
    });
    expect(refreshed.startsWith(prefix)).toBe(true);
    expect(refreshed.endsWith("\n" + suffix)).toBe(true);
    expect(refreshed).toContain(nextSource);
    expect(refreshed).not.toContain("First fix");
    expect(refreshed).toContain("Second fix");
    expect(refreshed).toContain(
      "- [ ] Required checks pass on the latest proposal head."
    );
  });

  it.each([
    ["unmanaged", "Human-authored release description"],
    ["nested starts", `${bodyStart}\n${bodyStart}\ncontent\n${bodyEnd}`],
    ["extra ends", `${bodyStart}\ncontent\n${bodyEnd}\n${bodyEnd}`],
    [
      "duplicate blocks",
      `${bodyStart}\na\n${bodyEnd}\n${bodyStart}\nb\n${bodyEnd}`,
    ],
  ])("refuses %s PR-body markers", (_kind, previousBody) => {
    expect(() =>
      renderProposalBody({
        version,
        source,
        notes: releaseNotes(),
        previousBody,
      })
    ).toThrow();
  });

  it("ignores successful runs on an older proposal head and unapproved current runs", () => {
    const runs = [
      { headSha: source, conclusion: "success", event: "pull_request" },
      {
        headSha: nextSource,
        conclusion: "action_required",
        event: "pull_request",
      },
      { headSha: nextSource, conclusion: "success", event: "push" },
    ];
    expect(hasCurrentChecks(runs, nextSource)).toBe(false);
    expect(hasCurrentChecks(runs, source)).toBe(true);
  });

  it.each(["pull_request", "workflow_dispatch"])(
    "recognizes an already started %s run for the exact current head",
    event => {
      expect(
        hasCurrentChecks(
          [{ headSha: nextSource, conclusion: null, event }],
          nextSource
        )
      ).toBe(true);
    }
  );
});
