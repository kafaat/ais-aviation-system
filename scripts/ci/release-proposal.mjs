import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { compareVersions, parseVersion } from "./release-version.mjs";
import { gitReader } from "./release-publication.js";

const shaPattern = /^[a-f0-9]{40}$/;
const notesStart = "<!-- ais-release-notes:start -->";
const notesEnd = "<!-- ais-release-notes:end -->";
const bodyStart = "<!-- ais-release-proposal:start -->";
const bodyEnd = "<!-- ais-release-proposal:end -->";

function requireSha(sha) {
  if (!shaPattern.test(sha)) throw new Error("Invalid release source SHA");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, stable(value[key])])
    );
  return value;
}

function samePackageExceptVersion(left, right) {
  const { version: _left, ...before } = left;
  const { version: _right, ...after } = right;
  return JSON.stringify(stable(before)) === JSON.stringify(stable(after));
}

function history(text) {
  const header = /^# Changelog\r?\n\r?\n/.exec(text);
  if (!header) throw new Error("Expected the existing Changelog header");
  return text.slice(header[0].length);
}

// gitReader intentionally trims command output. Changelog history is a byte
// contract, so read blobs without trimming their leading or trailing newlines.
function gitFile(git, revision, path) {
  return execFileSync("git", ["show", `${revision}:${path}`], {
    cwd: git("rev-parse", "--show-toplevel"),
    encoding: "utf8",
  });
}

export function selectProposalVersion({
  candidate,
  current,
  remoteRefs,
  customVersion = "",
  requestedPrerelease = false,
  manual = false,
  reuseOnly = false,
}) {
  const desired = reuseOnly ? null : parseVersion(candidate);
  const refs = new Map(
    remoteRefs
      .split("\n")
      .filter(Boolean)
      .map(line => line.trim().split(/\s+/).reverse())
  );
  const open = [...refs.keys()]
    .filter(ref => ref.startsWith("refs/heads/release/v"))
    .map(ref => ref.slice("refs/heads/release/v".length))
    .filter(version => !refs.has(`refs/tags/v${version}`));
  if (open.length > 1)
    throw new Error(
      "Several unpublished release branches exist; resolve them before proposing a release"
    );
  if (!open.length) {
    if (reuseOnly)
      throw new Error("No unpublished release proposal remains to refresh");
    return candidate;
  }
  const version = open[0];
  const existing = parseVersion(version);
  if (compareVersions(version, current) <= 0)
    throw new Error(
      "The open release version does not advance the current package version"
    );
  if (reuseOnly) return version;
  const coreComparison = compareVersions(
    existing.core.join("."),
    desired.core.join(".")
  );
  if (coreComparison < 0)
    throw new Error(
      `Open release v${version} is below the required v${candidate}; review and replace that proposal`
    );
  if (manual && coreComparison > 0)
    throw new Error(
      `The requested version conflicts with open release v${version}`
    );
  if (customVersion && customVersion.replace(/^v/, "") !== version) {
    const custom = parseVersion(customVersion.replace(/^v/, ""));
    const samePrereleaseRequest =
      requestedPrerelease &&
      custom.prerelease.length === 0 &&
      existing.prerelease.length > 0 &&
      custom.core.join(".") === existing.core.join(".");
    if (!samePrereleaseRequest)
      throw new Error(`A different release v${version} is already open`);
  }
  if (
    manual &&
    requestedPrerelease !== Boolean(existing.prerelease.length) &&
    !customVersion.includes("-")
  )
    throw new Error(
      "The open proposal has a different prerelease choice; review it before changing release kind"
    );
  return version;
}

export function verifyProposalChanges(git, source, head, version) {
  requireSha(source);
  requireSha(head);
  parseVersion(version);
  git("merge-base", "--is-ancestor", source, head);
  const paths = git("diff", "--name-only", source, head)
    .split("\n")
    .filter(Boolean);
  if (
    !paths.includes("package.json") ||
    paths.some(path => !["package.json", "CHANGELOG.md"].includes(path))
  )
    throw new Error(
      "Release proposal must change only package.json and CHANGELOG.md"
    );
  const entries = git(
    "ls-tree",
    head,
    "--",
    "package.json",
    "CHANGELOG.md"
  ).split("\n");
  if (
    entries.length !== 2 ||
    entries.some(entry => !entry.startsWith("100644 blob "))
  )
    throw new Error("Release files must remain regular non-executable files");
  const before = JSON.parse(git("show", `${source}:package.json`));
  const after = JSON.parse(git("show", `${head}:package.json`));
  if (
    after.version !== version ||
    compareVersions(version, before.version) <= 0 ||
    !samePackageExceptVersion(before, after)
  )
    throw new Error(
      "Release proposal changes package.json beyond the intended version bump"
    );
}

export function renderProposalChangelog({
  version,
  source,
  notes,
  baseChangelog,
  previousChangelog,
  previousBaseChangelog,
}) {
  requireSha(source);
  parseVersion(version);
  const heading = `## What's Changed in v${version}`;
  if (!notes.startsWith(`${heading}\n`))
    throw new Error(
      "Generated notes do not match the selected release version"
    );
  const managed = `<!-- ais-release-source: ${source} -->\n${notesStart}\n\n${notes.slice(heading.length).trim()}\n\n${notesEnd}`;
  let section = `${heading}\n\n${managed}\n`;
  if (previousChangelog !== undefined) {
    const previousHistory = history(previousBaseChangelog);
    const suffix = `\n---\n\n${previousHistory}`;
    const content = history(previousChangelog);
    if (!content.startsWith(`${heading}\n`) || !content.endsWith(suffix))
      throw new Error(
        "The release heading or published changelog history was edited; refusing to overwrite it"
      );
    const previousSection = content.slice(0, -suffix.length);
    const pattern =
      /<!-- ais-release-source: [a-f0-9]{40} -->\s*<!-- ais-release-notes:start -->[\s\S]*?<!-- ais-release-notes:end -->/g;
    const matches = [...previousSection.matchAll(pattern)];
    if (
      matches.length !== 1 ||
      previousSection.split(notesStart).length !== 2 ||
      previousSection.split(notesEnd).length !== 2
    )
      throw new Error(
        "The open proposal has no unique managed notes block; preserve and review its notes manually"
      );
    section = previousSection.replace(pattern, () => managed);
  }
  return `# Changelog\n\n${section.trimEnd()}\n\n---\n\n${history(baseChangelog)}`;
}

export function prepareProposal(
  git,
  { version, source, notes, cwd = process.cwd() }
) {
  requireSha(source);
  parseVersion(version);
  if (git("rev-parse", "HEAD") !== source)
    throw new Error("Proposal checkout does not match its source SHA");
  if (git("status", "--porcelain", "--untracked-files=no"))
    throw new Error(
      "Proposal source checkout must have no uncommitted changes"
    );
  git("fetch", "--no-tags", "origin", "main");
  if (git("rev-parse", "refs/remotes/origin/main") !== source)
    return {
      skip: "true",
      reason: "main advanced; a newer main run must refresh the proposal",
    };
  const branch = `release/v${version}`;
  if (git("ls-remote", "--tags", "origin", `refs/tags/v${version}`))
    throw new Error(
      "This release tag already exists; use publication recovery instead"
    );
  const refs = git("ls-remote", "--heads", "origin", `refs/heads/${branch}`);
  const previous = refs ? refs.split(/\s+/)[0] : "";
  const basePackage = JSON.parse(git("show", `${source}:package.json`));
  if (compareVersions(version, basePackage.version) <= 0)
    throw new Error("Proposal version must advance the source version");
  const baseChangelog = gitFile(git, source, "CHANGELOG.md");
  let previousChangelog;
  let previousBaseChangelog;
  if (previous) {
    requireSha(previous);
    git("fetch", "--no-tags", "origin", `refs/heads/${branch}`);
    if (git("rev-parse", "FETCH_HEAD") !== previous)
      throw new Error(
        "Release branch changed during preparation; retry with its new head"
      );
    previousChangelog = gitFile(git, previous, "CHANGELOG.md");
    const firstSection = history(previousChangelog).split(
      "\n## What's Changed in "
    )[0];
    const sources = [
      ...firstSection.matchAll(/<!-- ais-release-source: ([a-f0-9]{40}) -->/g),
    ];
    if (sources.length !== 1)
      throw new Error(
        "Open proposal has no unique source marker; review its notes manually before enabling refresh"
      );
    const previousSource = sources[0][1];
    git("merge-base", "--is-ancestor", previousSource, source);
    verifyProposalChanges(git, previousSource, previous, version);
    const previousPackage = JSON.parse(
      git("show", `${previousSource}:package.json`)
    );
    if (previousPackage.version !== basePackage.version)
      throw new Error(
        "Another release changed main's version; review the outstanding proposal"
      );
    previousBaseChangelog = gitFile(git, previousSource, "CHANGELOG.md");
  }
  const changelog = renderProposalChangelog({
    version,
    source,
    notes,
    baseChangelog,
    previousChangelog,
    previousBaseChangelog,
  });
  writeFileSync(
    `${cwd}/package.json`,
    JSON.stringify({ ...basePackage, version }, null, 2) + "\n"
  );
  writeFileSync(`${cwd}/CHANGELOG.md`, changelog);
  return { skip: "false", branch, source, previous_head: previous };
}

export function commitProposal(git, { version, source, previous = "" }) {
  requireSha(source);
  parseVersion(version);
  if (previous) requireSha(previous);
  if (git("rev-parse", "HEAD") !== source)
    throw new Error("Source checkout moved while preparing the proposal");
  const baseHistory = history(gitFile(git, source, "CHANGELOG.md"));
  const changelog = readFileSync(
    `${git("rev-parse", "--show-toplevel")}/CHANGELOG.md`,
    "utf8"
  );
  if (!changelog.endsWith(`\n---\n\n${baseHistory}`))
    throw new Error(
      "Formatting changed published changelog history; refusing to commit it"
    );
  git("add", "package.json", "CHANGELOG.md");
  const tree = git("write-tree");
  if (previous && tree === git("rev-parse", `${previous}^{tree}`)) {
    git("checkout", "--detach", previous);
    return { changed: "false", head: previous };
  }
  const parents =
    previous && previous !== source
      ? ["-p", previous, "-p", source]
      : ["-p", source];
  const commit = git(
    "commit-tree",
    tree,
    ...parents,
    "-m",
    `chore(release): ${previous ? "refresh " : ""}v${version}`
  );
  verifyProposalChanges(git, source, commit, version);
  git("checkout", "--detach", commit);
  return { changed: "true", head: commit };
}

export function renderProposalBody({
  version,
  source,
  notes,
  previousBody = "",
}) {
  requireSha(source);
  parseVersion(version);
  const managed = `${bodyStart}\n## Description\n\nPrepare v${version} from main \`${source}\`. The proposal changes only the package version and its changelog. Publication uses the exact merged release commit.\n\n## Type of Change\n\n- [x] Other: release version and notes.\n\n## Related Issues\n\nGenerated and refreshed by Release Automation.\n\n## How to Test\n\n1. Review the complete version and changelog diff against the recorded main source.\n2. Require the repository checks on the latest proposal head before merging.\n3. After merge, verify the published tag and release body against the merged commit.\n\n## Checklist\n\n- [x] The proposal contains only the intended version bump and changelog.\n- [ ] Required checks pass on the latest proposal head.\n- [ ] The release scope and notes have been reviewed.\n\n## Release Notes\n\n${notes.trim()}\n${bodyEnd}`;
  if (!previousBody) return managed + "\n";
  const pattern =
    /<!-- ais-release-proposal:start -->[\s\S]*?<!-- ais-release-proposal:end -->/g;
  if (
    [...previousBody.matchAll(pattern)].length !== 1 ||
    previousBody.split(bodyStart).length !== 2 ||
    previousBody.split(bodyEnd).length !== 2
  )
    throw new Error(
      "Existing PR description is unmanaged; review it before enabling automatic refresh"
    );
  return previousBody.replace(pattern, () => managed);
}

export function hasCurrentChecks(runs, head) {
  requireSha(head);
  return runs.some(
    run =>
      run.headSha === head &&
      run.conclusion !== "action_required" &&
      ["pull_request", "workflow_dispatch"].includes(run.event)
  );
}

export function generateReleaseNotes(git, version, repository) {
  parseVersion(version);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Invalid repository");
  let lastTag = "";
  try {
    lastTag = git("describe", "--tags", "--abbrev=0");
  } catch {
    /* First release. */
  }
  const commits = git(
    "log",
    ...(lastTag ? [`${lastTag}..HEAD`] : ["HEAD"]),
    "--pretty=format:%s (%h)",
    "--reverse"
  )
    .split("\n")
    .filter(Boolean);
  const groups = [
    ["Features", /^(feat|feature)(\([^\n]*\))?!?:/],
    ["Bug Fixes", /^(fix|bugfix)(\([^\n]*\))?!?:/],
    ["Performance Improvements", /^perf(\([^\n]*\))?!?:/],
    ["Code Refactoring", /^refactor(\([^\n]*\))?!?:/],
    ["Documentation", /^docs(\([^\n]*\))?!?:/],
    ["Maintenance", /^(chore|build|ci)(\([^\n]*\))?!?:/],
    ["Other Changes", /./],
  ];
  let remaining = commits;
  const sections = [`## What's Changed in v${version}`];
  for (const [title, pattern] of groups) {
    const selected = remaining.filter(subject => pattern.test(subject));
    remaining = remaining.filter(subject => !pattern.test(subject));
    if (selected.length)
      sections.push(
        `### ${title}\n\n${selected.map(subject => `- ${subject}`).join("\n")}`
      );
  }
  if (lastTag)
    sections.push(
      `**Full Changelog**: https://github.com/${repository}/compare/${encodeURIComponent(lastTag)}...v${version}`
    );
  return sections.join("\n\n") + "\n";
}

function emit(values) {
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n]/.test(String(value)))
      throw new Error("Invalid multiline workflow output");
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

function main() {
  const git = gitReader();
  const version = process.env.RELEASE_VERSION;
  const source = process.env.RELEASE_SOURCE_SHA;
  switch (process.argv[2]) {
    case "notes": {
      const delimiter = `release_notes_${randomUUID()}`;
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `changelog<<${delimiter}\n${generateReleaseNotes(git, version, process.env.GITHUB_REPOSITORY)}${delimiter}\n`
      );
      break;
    }
    case "select":
      emit({
        current_version: JSON.parse(readFileSync("package.json", "utf8"))
          .version,
        new_version: selectProposalVersion({
          candidate: process.env.CANDIDATE_VERSION,
          current: JSON.parse(readFileSync("package.json", "utf8")).version,
          remoteRefs: git("ls-remote", "--heads", "--tags", "origin"),
          customVersion: process.env.CUSTOM_VERSION || "",
          requestedPrerelease: process.env.RELEASE_PRERELEASE === "true",
          manual: process.env.EVENT_NAME === "workflow_dispatch",
          reuseOnly: process.env.REUSE_OPEN_PROPOSAL === "true",
        }),
      });
      break;
    case "prepare":
      emit(
        prepareProposal(git, {
          version,
          source,
          notes: process.env.RELEASE_NOTES,
        })
      );
      break;
    case "commit":
      emit(
        commitProposal(git, {
          version,
          source,
          previous: process.env.RELEASE_PREVIOUS_HEAD,
        })
      );
      break;
    case "checks": {
      const head = process.env.RELEASE_HEAD;
      requireSha(head);
      const runs = JSON.parse(
        execFileSync(
          "gh",
          [
            "run",
            "list",
            "--workflow",
            process.env.RELEASE_WORKFLOW,
            "--branch",
            process.env.RELEASE_BRANCH,
            "--commit",
            head,
            "--json",
            "headSha,event,conclusion",
          ],
          { encoding: "utf8" }
        )
      );
      console.info(String(hasCurrentChecks(runs, head)));
      break;
    }
    case "body": {
      const prs = JSON.parse(
        execFileSync(
          "gh",
          [
            "pr",
            "list",
            "--state",
            "open",
            "--head",
            `release/v${version}`,
            "--base",
            "main",
            "--json",
            "number,body",
          ],
          { encoding: "utf8" }
        )
      );
      if (prs.length > 1)
        throw new Error("Several open PRs use the same release branch");
      const changelog = history(readFileSync("CHANGELOG.md", "utf8"));
      const suffix = `\n---\n\n${history(gitFile(git, source, "CHANGELOG.md"))}`;
      if (!changelog.endsWith(suffix))
        throw new Error("Proposal notes do not preserve published history");
      const notes = changelog.slice(0, -suffix.length);
      writeFileSync(
        process.env.RELEASE_BODY_FILE,
        renderProposalBody({
          version,
          source,
          notes,
          previousBody: prs[0]?.body || "",
        })
      );
      emit({ pr_number: prs[0]?.number || "" });
      if (process.argv[3] === "--print-number")
        console.info(prs[0]?.number || "");
      break;
    }
    default:
      throw new Error("Use select, notes, prepare, commit, body, or checks");
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
