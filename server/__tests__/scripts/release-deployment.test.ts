import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { gitReader } from "../../../scripts/ci/release-publication.js";
import {
  verifyCurrentDeploymentHead,
  verifyReleaseDeployment,
} from "../../../scripts/ci/release-deployment.mjs";

let dir: string;
let repo: string;
let origin: string;
let git: ReturnType<typeof gitReader>;
let source: string;
let commit: string;
const tag = "v1.0.1";
const published = {
  tag_name: tag,
  draft: false,
  prerelease: false,
  published_at: "2026-11-05T00:00:00Z",
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ais-release-deployment-"));
  repo = join(dir, "repo");
  origin = join(dir, "origin.git");
  mkdirSync(repo);
  mkdirSync(origin);
  gitReader(origin)("init", "--bare");
  git = gitReader(repo);
  git("init", "-b", "main");
  git("config", "user.name", "Deployment Test");
  git("config", "user.email", "deployment-test@example.invalid");
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0" })
  );
  git("add", ".");
  git("commit", "-m", "fixture");
  source = git("rev-parse", "HEAD");
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.1" })
  );
  writeFileSync(join(repo, "CHANGELOG.md"), "Release notes\n");
  git("add", ".");
  git("commit", "-m", "chore(release): v1.0.1");
  commit = git("rev-parse", "HEAD");
  git("tag", "-a", tag, "-m", "Release");
  git("remote", "add", "origin", origin);
  git("push", "origin", "main", "--tags");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function request() {
  return {
    eventName: "workflow_dispatch",
    ref: `refs/tags/${tag}`,
    eventSha: commit,
    tag,
    commit,
    repository: "fixture/repo",
    token: "test-only",
    git,
    fetchImpl: vi.fn().mockResolvedValue(Response.json(published)),
  };
}

describe("release deployment admission", () => {
  it.each(["push", "pull_request", "workflow_dispatch"])(
    "keeps empty-input %s runs validation-only without Git or API access",
    async eventName => {
      const options = {
        ...request(),
        eventName,
        ref: "refs/heads/release/v1.0.1",
        tag: "",
        commit: "",
        git: vi.fn(),
      };
      expect(await verifyReleaseDeployment(options)).toEqual({
        requested: "false",
        tag: "",
        commit: "",
      });
      expect(options.git).not.toHaveBeenCalled();
      expect(options.fetchImpl).not.toHaveBeenCalled();
    }
  );

  it("verifies the exact published tag provenance even after main advances", async () => {
    writeFileSync(join(repo, "later.txt"), "later code\n");
    git("add", ".");
    git("commit", "-m", "later code");
    git("push", "origin", "main");
    git("checkout", "--detach", commit);
    const options = request();
    expect(await verifyReleaseDeployment(options)).toEqual({
      requested: "true",
      tag,
      commit,
    });
    expect(git("rev-parse", "HEAD")).toBe(commit);
    expect(git("status", "--porcelain")).toBe("");
    expect(options.fetchImpl).toHaveBeenCalledTimes(1);
    expect(options.fetchImpl.mock.calls[0][0]).toBe(
      `https://api.github.com/repos/fixture/repo/releases/tags/${tag}`
    );
    expect(options.fetchImpl.mock.calls[0][1].method).toBeUndefined();
  });

  it.each([
    ["tag only", { commit: "" }],
    ["commit only", { tag: "" }],
    ["short commit", { commit: "a".repeat(7) }],
    ["prerelease tag", { tag: "v1.0.1-rc.1" }],
    ["malformed tag", { tag: "v1.0.1;echo unsafe" }],
    ["branch ref", { ref: "refs/heads/main" }],
    ["other tag ref", { ref: "refs/tags/v1.0.2" }],
    ["other event SHA", { eventSha: "a".repeat(40) }],
    ["non-dispatch request", { eventName: "push" }],
  ])("rejects %s before API access", async (_name, overrides) => {
    const options = { ...request(), ...overrides };
    await expect(verifyReleaseDeployment(options)).rejects.toThrow();
    expect(options.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a checkout of another commit", async () => {
    git("checkout", "--detach", source);
    const options = request();
    await expect(verifyReleaseDeployment(options)).rejects.toThrow(
      "checkout must match"
    );
    expect(options.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a local tag that points elsewhere", async () => {
    git("tag", "-f", tag, source);
    const options = request();
    await expect(verifyReleaseDeployment(options)).rejects.toThrow(
      "Local release tag"
    );
    expect(options.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a retargeted remote tag before API access", async () => {
    gitReader(origin)("update-ref", `refs/tags/${tag}`, source);
    const options = request();
    await expect(verifyReleaseDeployment(options)).rejects.toThrow(
      "Remote release tag"
    );
    expect(options.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a tag moved during the release lookup", async () => {
    const options = request();
    options.fetchImpl.mockImplementation(async () => {
      gitReader(origin)("update-ref", `refs/tags/${tag}`, source);
      return Response.json(published);
    });
    await expect(verifyReleaseDeployment(options)).rejects.toThrow(
      "Remote release tag"
    );
    expect(options.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a release commit outside main", async () => {
    git("update-ref", "refs/remotes/origin/main", source);
    const options = request();
    await expect(verifyReleaseDeployment(options)).rejects.toThrow(
      "part of origin/main"
    );
    expect(options.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a release tag that smuggles code into the version bump", async () => {
    writeFileSync(join(repo, "server.js"), "changed code\n");
    git("add", ".");
    git("commit", "--amend", "--no-edit");
    commit = git("rev-parse", "HEAD");
    git("tag", "-f", "-a", tag, "-m", "Altered fixture");
    git("push", "--force", "origin", "main", "--tags");
    const options = request();
    await expect(verifyReleaseDeployment(options)).rejects.toThrow(
      "changes code"
    );
    expect(options.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([403, 404, 500])("rejects release lookup HTTP %s", async status => {
    const options = request();
    options.fetchImpl.mockResolvedValue(new Response(null, { status }));
    await expect(verifyReleaseDeployment(options)).rejects.toThrow(
      `(${status})`
    );
  });

  it.each([
    ["draft", { draft: true }],
    ["prerelease", { prerelease: true }],
    ["unpublished", { published_at: null }],
    ["invalid publication time", { published_at: "invalid" }],
    ["another tag", { tag_name: "v1.0.2" }],
    ["missing publication classification", { prerelease: undefined }],
  ])("rejects a %s release", async (_name, overrides) => {
    const options = request();
    options.fetchImpl.mockResolvedValue(
      Response.json({ ...published, ...overrides })
    );
    await expect(verifyReleaseDeployment(options)).rejects.toThrow(
      "matching published stable release"
    );
  });
});

describe("production current-main guard", () => {
  it.each(["main push", "tag dispatch"])(
    "allows a %s whose checkout and current remote main match its event SHA",
    kind => {
      if (kind === "tag dispatch") git("checkout", "--detach", commit);
      expect(verifyCurrentDeploymentHead(git, commit)).toBe(commit);
      expect(git("rev-parse", "HEAD")).toBe(commit);
      expect(git("status", "--porcelain")).toBe("");
    }
  );

  it.each(["main push", "tag dispatch"])(
    "rejects a delayed %s after remote main advances, even with an old tracking ref",
    kind => {
      git("checkout", "-b", "next");
      writeFileSync(join(repo, "later.txt"), "new main source\n");
      git("add", ".");
      git("commit", "-m", "next main change");
      const next = git("rev-parse", "HEAD");
      git("push", "origin", "next");
      // Advance the origin independently of this run's cached origin/main.
      gitReader(origin)("update-ref", "refs/heads/main", next);
      if (kind === "tag dispatch") git("checkout", "--detach", commit);
      else git("checkout", "main");
      expect(git("rev-parse", "refs/remotes/origin/main")).toBe(commit);
      expect(() => verifyCurrentDeploymentHead(git, commit)).toThrow(
        "no longer matches current origin/main"
      );
      expect(git("rev-parse", "HEAD")).toBe(commit);
      expect(git("status", "--porcelain")).toBe("");
    }
  );

  it("rejects a checkout that differs from the event SHA", () => {
    git("checkout", "--detach", source);
    expect(() => verifyCurrentDeploymentHead(git, commit)).toThrow(
      "checkout does not match the event commit"
    );
  });

  it.each(["", "a".repeat(7), "a".repeat(40) + "\n"])(
    "rejects an incomplete or malformed event SHA before using Git",
    expected => {
      const read = vi.fn();
      expect(() => verifyCurrentDeploymentHead(read, expected)).toThrow(
        "full event commit SHA"
      );
      expect(read).not.toHaveBeenCalled();
    }
  );

  it("refuses deployment if the current remote main cannot be resolved", () => {
    gitReader(origin)("update-ref", "-d", "refs/heads/main");
    expect(() => verifyCurrentDeploymentHead(git, commit)).toThrow(
      "no longer matches current origin/main"
    );
  });

  it("runs the current-main CLI against GITHUB_SHA without deployment inputs or outputs", () => {
    const script = join(process.cwd(), "scripts/ci/release-deployment.mjs");
    const result = execFileSync(process.execPath, [script, "current-main"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, GITHUB_SHA: commit, GITHUB_OUTPUT: "" },
    });
    expect(JSON.parse(result)).toEqual({ current_main: commit });
    expect(git("rev-parse", "HEAD")).toBe(commit);
  });
});
