/** Publish an immutable release tag without repeating the version mutation. */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function gitReader(cwd = process.cwd()) {
  return (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

export function validateTag(tag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(tag))
    throw new Error("Expected a version tag, for example v1.25.0");
}

export function verifyReleaseCommit(git, tag, commit, sourceSha) {
  validateTag(tag);
  if (![commit, sourceSha].every(value => /^[a-f0-9]{40}$/.test(value)))
    throw new Error("Expected full commit SHAs");
  if (git("rev-parse", `${commit}^`) !== sourceSha)
    throw new Error(
      "Release commit is not a direct child of the expected source"
    );
  const paths = git("diff", "--name-only", sourceSha, commit).split("\n");
  if (
    !paths.includes("package.json") ||
    paths.some(path => !["package.json", "CHANGELOG.md"].includes(path))
  )
    throw new Error("Release commit changes code");
  const before = JSON.parse(git("show", `${sourceSha}:package.json`));
  const after = JSON.parse(git("show", `${commit}:package.json`));
  if (`v${after.version}` !== tag || before.version === after.version)
    throw new Error("Release version does not match the tag");
  delete before.version;
  delete after.version;
  // Compare recursively, independent of JSON key ordering.
  const stable = value =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map(key => [key, stable(value[key])])
          )
        : value;
  if (JSON.stringify(stable(before)) !== JSON.stringify(stable(after)))
    throw new Error("Release changes package.json beyond version");
}

export function prepareRelease(git, tag, sourceSha) {
  validateTag(tag);
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error("Expected source SHA");
  let tagged;
  try {
    tagged = git("rev-parse", "--verify", `refs/tags/${tag}^{commit}`);
  } catch {
    /* No tag yet. */
  }
  const remote = git("rev-parse", "refs/remotes/origin/main");
  const candidate = tagged || (remote !== sourceSha ? remote : null);
  if (!candidate) {
    if (git("rev-parse", "HEAD") !== sourceSha)
      throw new Error("Checkout does not match release source");
    return { reuse_commit: "false", tag_exists: "false", commit: "" };
  }
  verifyReleaseCommit(git, tag, candidate, sourceSha);
  git("checkout", "--detach", candidate);
  return {
    reuse_commit: "true",
    tag_exists: String(Boolean(tagged)),
    commit: candidate,
  };
}

export function verifyRemoteTag(git, tag, commit) {
  validateTag(tag);
  const lines = git(
    "ls-remote",
    "origin",
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`
  )
    .split("\n")
    .filter(Boolean);
  const refs = new Map(lines.map(line => line.split(/\s+/)));
  const peeled = lines
    .map(line => line.split(/\s+/))
    .find(([, ref]) => ref.endsWith("^{}"));
  const direct = lines
    .map(line => line.split(/\s+/))
    .find(([, ref]) => ref === `refs/tags/${tag}`);
  if ((peeled || direct)?.[0] !== commit || refs.size === 0)
    throw new Error("Remote release tag does not match the verified commit");
}

export async function publishRelease({
  repository,
  tag,
  commit,
  token,
  notes = "",
  prerelease = false,
  fetchImpl = fetch,
  verify,
}) {
  validateTag(tag);
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
    !/^[a-f0-9]{40}$/.test(commit) ||
    !token
  )
    throw new Error("Repository, exact commit and token are required");
  const root = `https://api.github.com/repos/${repository}/releases`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const request = (url, options = {}) =>
    fetchImpl(url, {
      ...options,
      headers: { ...headers, ...options.headers },
      signal: AbortSignal.timeout(30_000),
    });
  const read = async () => {
    const response = await request(`${root}/tags/${encodeURIComponent(tag)}`);
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`Release lookup failed (${response.status})`);
    const value = await response.json();
    if (value.tag_name !== tag || value.draft)
      throw new Error("Existing release is not the expected published tag");
    return value;
  };
  verify();
  const existing = await read();
  if (existing) {
    verify();
    return { status: "existing", url: existing.html_url };
  }
  verify();
  const response = await request(root, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: commit,
      name: tag,
      body: notes,
      draft: false,
      prerelease,
      generate_release_notes: !notes,
    }),
  });
  if (response.status === 409 || response.status === 422) {
    const raced = await read();
    if (raced) {
      verify();
      return { status: "existing", url: raced.html_url };
    }
  }
  if (!response.ok)
    throw new Error(
      `Release publication failed (${response.status}); rerun with the same tag and commit`
    );
  const created = await response.json();
  verify();
  return { status: "created", url: created.html_url };
}

async function main() {
  const git = gitReader();
  const tag = process.env.RELEASE_TAG || "";
  const mode = process.argv[2];
  if (mode === "prepare") {
    const result = prepareRelease(
      git,
      tag,
      process.env.RELEASE_SOURCE_SHA || ""
    );
    if (!process.env.GITHUB_OUTPUT)
      throw new Error("GITHUB_OUTPUT is required");
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(result)
        .map(([k, v]) => `${k}=${v}\n`)
        .join("")
    );
    return;
  }
  if (mode !== "publish" && mode !== "resume")
    throw new Error("Expected prepare, publish or resume");
  validateTag(tag);
  const commit = git("rev-parse", `refs/tags/${tag}^{commit}`);
  if (mode === "resume" && commit !== process.env.RELEASE_EXPECTED_SHA)
    throw new Error("Resume requires the exact expected tag commit");
  verifyReleaseCommit(
    git,
    tag,
    commit,
    mode === "resume"
      ? git("rev-parse", `${commit}^`)
      : process.env.RELEASE_SOURCE_SHA || ""
  );
  const result = await publishRelease({
    repository: process.env.GITHUB_REPOSITORY || "",
    tag,
    commit,
    token: process.env.GITHUB_TOKEN || "",
    notes: process.env.RELEASE_NOTES || "",
    // The operator's explicit choice wins. The tag suffix only covers the
    // auto-increment path, which appends -rc; a custom version does not, so
    // reading the tag alone published a checked prerelease as a full release.
    prerelease: process.env.RELEASE_PRERELEASE === "true" || tag.includes("-"),
    verify: () => verifyRemoteTag(git, tag, commit),
  });
  console.info(JSON.stringify({ tag, commit, ...result }));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
