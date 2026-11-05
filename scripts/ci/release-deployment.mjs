/** Verify release provenance and refuse stale production checkouts. */
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  gitReader,
  verifyReleaseCommit,
  verifyRemoteTag,
} from "./release-publication.js";

export async function verifyReleaseDeployment({
  eventName,
  ref,
  eventSha,
  tag = "",
  commit = "",
  repository,
  token,
  git = gitReader(),
  fetchImpl = fetch,
}) {
  // Release-branch dispatches still run the normal proposal checks. Merely
  // running the CI workflow manually must never opt into production deployment.
  if (!tag && !commit) return { requested: "false", tag: "", commit: "" };
  if (eventName !== "workflow_dispatch")
    throw new Error(
      "Release deployment requires an explicit workflow dispatch"
    );
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag))
    throw new Error("Release deployment requires a stable version tag");
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new Error("Release deployment requires the full expected commit SHA");
  if (ref !== `refs/tags/${tag}`)
    throw new Error("Dispatch must run on the requested release tag");
  if (eventSha !== commit || git("rev-parse", "HEAD") !== commit)
    throw new Error(
      "Dispatch and checkout must match the expected release commit"
    );
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !token)
    throw new Error(
      "Repository and read token are required for release verification"
    );

  // Provenance can be checked after main advances. The production jobs also
  // require current main just before mutating their environment, under its lock.
  // Retargeting the tag or dispatching an unmerged commit is never allowed.
  if (git("rev-parse", `refs/tags/${tag}^{commit}`) !== commit)
    throw new Error("Local release tag does not match the expected commit");
  verifyRemoteTag(git, tag, commit);
  try {
    git("merge-base", "--is-ancestor", commit, "refs/remotes/origin/main");
  } catch {
    throw new Error("Release commit must be part of origin/main");
  }
  verifyReleaseCommit(git, tag, commit, git("rev-parse", `${commit}^`));

  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok)
    throw new Error(`Published release lookup failed (${response.status})`);
  const release = await response.json();
  if (
    release.tag_name !== tag ||
    release.draft !== false ||
    release.prerelease !== false ||
    typeof release.published_at !== "string" ||
    !Number.isFinite(Date.parse(release.published_at))
  )
    throw new Error(
      "Deployment requires the matching published stable release"
    );
  verifyRemoteTag(git, tag, commit);
  return { requested: "true", tag, commit };
}

export function verifyCurrentDeploymentHead(git, expectedSha) {
  if (
    typeof expectedSha !== "string" ||
    !/^[a-f0-9]{40}$/.test(expectedSha) ||
    expectedSha.length !== 40
  )
    throw new Error("Production deployment requires the full event commit SHA");
  if (git("rev-parse", "HEAD") !== expectedSha)
    throw new Error("Production checkout does not match the event commit");
  // Read the remote now, not the origin/main snapshot fetched before CI or an
  // environment approval wait. The caller holds the environment's deployment
  // lock, so a delayed run cannot overwrite a newer main deployment.
  const remote = git("ls-remote", "--heads", "origin", "refs/heads/main");
  const match = /^([a-f0-9]{40})\s+refs\/heads\/main$/.exec(remote);
  if (!match || match[1] !== expectedSha)
    throw new Error(
      "Production source no longer matches current origin/main; use the current main revision"
    );
  // This is an eligibility check, not a receipt or same-SHA deduplication.
  return expectedSha;
}

async function main() {
  if (process.argv[2] === "current-main") {
    const commit = verifyCurrentDeploymentHead(
      gitReader(),
      process.env.GITHUB_SHA || ""
    );
    console.info(JSON.stringify({ current_main: commit }));
    return;
  }
  if (process.argv[2]) throw new Error("Expected current-main or no command");
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
  const result = await verifyReleaseDeployment({
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    eventSha: process.env.GITHUB_SHA,
    tag: process.env.RELEASE_TAG || "",
    commit: process.env.RELEASE_EXPECTED_SHA || "",
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
  });
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(result)
      .map(([key, value]) => `${key}=${value}\n`)
      .join("")
  );
  console.info(JSON.stringify(result));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
