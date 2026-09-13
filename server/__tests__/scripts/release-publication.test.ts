import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gitReader,
  prepareRelease,
  publishRelease,
  verifyReleaseCommit,
  verifyRemoteTag,
} from "../../../scripts/ci/release-publication.js";

let dir: string;
let git: ReturnType<typeof gitReader>;
let source: string;
let commit: string;
const tag = "v1.0.1";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ais-release-"));
  git = gitReader(dir);
  git("init", "-b", "main");
  git("config", "user.name", "Release Test");
  git("config", "user.email", "release-test@example.invalid");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      scripts: { test: "unchanged" },
    })
  );
  git("add", ".");
  git("commit", "-m", "fixture");
  source = git("rev-parse", "HEAD");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.1",
      scripts: { test: "unchanged" },
    })
  );
  writeFileSync(join(dir, "CHANGELOG.md"), "Release notes\n");
  git("add", ".");
  git("commit", "-m", "chore(release): v1.0.1");
  commit = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", commit);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("release publication recovery", () => {
  it("reuses a pushed commit before the tag was created", () => {
    git("checkout", "--detach", source);
    expect(prepareRelease(git, tag, source)).toEqual({
      reuse_commit: "true",
      tag_exists: "false",
      commit,
    });
    expect(git("rev-parse", "HEAD")).toBe(commit);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("reuses an existing tag even if main has advanced", () => {
    git("tag", "-a", tag, "-m", "Release");
    writeFileSync(join(dir, "next.txt"), "later code");
    git("add", ".");
    git("commit", "-m", "later");
    git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
    expect(prepareRelease(git, tag, source)).toEqual({
      reuse_commit: "true",
      tag_exists: "true",
      commit,
    });
  });

  it("only creates a new commit when checkout and remote still match the source", () => {
    git("checkout", "--detach", source);
    git("update-ref", "refs/remotes/origin/main", source);
    expect(prepareRelease(git, tag, source).reuse_commit).toBe("false");
  });

  it.each(["code", "package", "version"])(
    "refuses a reused commit with altered %s",
    kind => {
      if (kind === "code")
        writeFileSync(join(dir, "server.js"), "altered code");
      else
        writeFileSync(
          join(dir, "package.json"),
          JSON.stringify({
            name: "fixture",
            version: kind === "version" ? "1.0.2" : "1.0.1",
            scripts: { test: kind === "package" ? "changed" : "unchanged" },
          })
        );
      git("add", ".");
      git("commit", "--amend", "--no-edit");
      const unsafe = git("rev-parse", "HEAD");
      expect(() => verifyReleaseCommit(git, tag, unsafe, source)).toThrow();
    }
  );

  it("rejects another source and shell metacharacters in a version", () => {
    expect(() => verifyReleaseCommit(git, tag, commit, commit)).toThrow(
      "direct child"
    );
    expect(() =>
      prepareRelease(git, "v1.0.1;touch /tmp/unwanted", source)
    ).toThrow("version tag");
  });

  it("verifies the remote tag's peeled commit", () => {
    const read = vi.fn(
      () => `abc\trefs/tags/${tag}\n${commit}\trefs/tags/${tag}^{}`
    );
    expect(() => verifyRemoteTag(read, tag, commit)).not.toThrow();
    expect(() => verifyRemoteTag(read, tag, source)).toThrow("does not match");
  });

  it("recovers after HTTP 500 using the same tag and SHA without another commit", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        Response.json(
          { tag_name: tag, html_url: "https://example.invalid/release" },
          { status: 201 }
        )
      );
    const options = {
      repository: "fixture/repo",
      tag,
      commit,
      token: "test-only",
      notes: "notes",
      fetchImpl: request,
      verify: vi.fn(),
    };
    await expect(publishRelease(options)).rejects.toThrow(
      "same tag and commit"
    );
    expect(await publishRelease(options)).toMatchObject({ status: "created" });
    const posts = request.mock.calls.filter(
      ([, options]) => options.method === "POST"
    );
    expect(posts).toHaveLength(2);
    expect(posts.map(([, options]) => JSON.parse(options.body))).toEqual([
      expect.objectContaining({ tag_name: tag, target_commitish: commit }),
      expect.objectContaining({ tag_name: tag, target_commitish: commit }),
    ]);
    expect(git("rev-parse", "HEAD")).toBe(commit);
  });

  it("does not POST or edit an already published release", async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({
        tag_name: tag,
        draft: false,
        html_url: "https://example.invalid/release",
      })
    );
    expect(
      await publishRelease({
        repository: "fixture/repo",
        tag,
        commit,
        token: "test-only",
        fetchImpl: request,
        verify: vi.fn(),
      })
    ).toMatchObject({ status: "existing" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not POST after an authorization failure", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 403 }));
    await expect(
      publishRelease({
        repository: "fixture/repo",
        tag,
        commit,
        token: "test-only",
        fetchImpl: request,
        verify: vi.fn(),
      })
    ).rejects.toThrow("403");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
