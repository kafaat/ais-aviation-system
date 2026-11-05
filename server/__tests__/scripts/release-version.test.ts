import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { calculateReleaseVersion } from "../../../scripts/ci/release-version.mjs";
import { gitReader } from "../../../scripts/ci/release-publication.js";

const now = new Date("2026-11-05T00:17:49.000Z");
const currentVersion = "1.37.0";
const versionScript = resolve("scripts/ci/release-version.mjs");
const publisherScript = resolve("scripts/ci/release-publication.js");
const directories: string[] = [];
function temporaryDirectory() {
  const path = mkdtempSync(join(tmpdir(), "ais-release-version-"));
  directories.push(path);
  return path;
}
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("release version persistence", () => {
  it.each([
    ["major", "2.0.0"],
    ["minor", "1.38.0"],
    ["patch", "1.37.1"],
  ])(
    "increments %s without changing stable release behavior",
    (releaseType, expected) => {
      expect(calculateReleaseVersion({ currentVersion, releaseType })).toBe(
        expected
      );
      expect(
        calculateReleaseVersion({
          currentVersion,
          releaseType,
          prerelease: true,
          now,
        })
      ).toBe(`${expected}-rc.202611050017`);
    }
  );

  it.each(["1.38.0", "v1.38.0"])(
    "persists the checked prerelease choice for custom version %s",
    customVersion => {
      expect(
        calculateReleaseVersion({
          currentVersion,
          customVersion,
          prerelease: true,
          now,
        })
      ).toBe("1.38.0-rc.202611050017");
    }
  );

  it.each([true, false])(
    "retains an explicit prerelease suffix when the input is %s",
    prerelease => {
      expect(
        calculateReleaseVersion({
          currentVersion,
          customVersion: "v1.38.0-beta.2",
          prerelease,
          now,
        })
      ).toBe("1.38.0-beta.2");
    }
  );

  it("promotes a prerelease to its explicitly requested stable version", () => {
    expect(
      calculateReleaseVersion({
        currentVersion: "1.38.0-rc.9",
        customVersion: "1.38.0",
      })
    ).toBe("1.38.0");
    // Without a custom version, retain the existing release_type bump policy.
    expect(
      calculateReleaseVersion({
        currentVersion: "1.38.0-rc.9",
        releaseType: "patch",
      })
    ).toBe("1.38.1");
  });

  it.each([
    ["1.38.0-rc.9", "1.38.0-rc.10"],
    ["1.38.0-9", "1.38.0-alpha"],
    ["1.38.0-alpha", "1.38.0-alpha.0"],
    ["1.38.0-alpha.1", "1.38.0-beta"],
    ["1.38.0-beta", "1.38.0-rc.1"],
  ])(
    "orders prerelease identifiers %s before %s",
    (previous, customVersion) => {
      expect(
        calculateReleaseVersion({ currentVersion: previous, customVersion })
      ).toBe(customVersion);
      expect(() =>
        calculateReleaseVersion({
          currentVersion: customVersion,
          customVersion: previous,
        })
      ).toThrow("greater than");
    }
  );

  it.each(["1.36.9", "1.37.0", "1.37.0-rc.1"])(
    "rejects a non-advancing custom version %s",
    customVersion => {
      expect(() =>
        calculateReleaseVersion({ currentVersion, customVersion })
      ).toThrow("greater than");
    }
  );

  it.each([
    "vv1.38.0",
    "01.38.0",
    "1.038.0",
    "1.38.00",
    "1.38.0-01",
    "1.38.0-rc.01",
    "1.38.0+build.1",
    "1.38.0-",
    "1.38.0-rc..1",
    "1.38.0-alpha--2",
    "1.38.0-rc-",
    "1.38",
    "1.38.0\n",
    " 1.38.0",
    "1.38.0;echo unsafe",
    "1.38.0-rc/1",
  ])("rejects unsupported custom version %j", customVersion => {
    expect(() =>
      calculateReleaseVersion({ currentVersion, customVersion })
    ).toThrow();
  });

  it("rejects an unknown automatic bump and an invalid timestamp", () => {
    expect(() =>
      calculateReleaseVersion({ currentVersion, releaseType: "none" })
    ).toThrow("Release type");
    expect(() =>
      calculateReleaseVersion({
        currentVersion,
        customVersion: "1.38.0",
        prerelease: true,
        now: new Date("invalid"),
      })
    ).toThrow("timestamp");
  });

  it("compares and increments numeric components without rounding", () => {
    expect(
      calculateReleaseVersion({
        currentVersion: "1.0.9007199254740992",
        releaseType: "patch",
      })
    ).toBe("1.0.9007199254740993");
  });

  it("fails invalid CLI input without emitting workflow outputs", () => {
    const dir = temporaryDirectory();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ version: currentVersion })
    );
    const output = join(dir, "outputs");
    writeFileSync(output, "existing=preserved\n");
    const result = spawnSync(process.execPath, [versionScript], {
      cwd: dir,
      env: {
        ...process.env,
        CUSTOM_VERSION: "1.37.0",
        RELEASE_PRERELEASE: "false",
        GITHUB_OUTPUT: output,
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("greater than");
    expect(readFileSync(output, "utf8")).toBe("existing=preserved\n");
  });

  it.each([
    ["v1.38.0", "true", true],
    ["v1.38.0-beta.2", "false", true],
    ["v1.38.0", "false", false],
  ])(
    "publishes %s (prerelease=%s) correctly after the dispatch inputs are gone",
    (customVersion, requestedPrerelease, expectedPrerelease) => {
      const dir = temporaryDirectory();
      const remote = temporaryDirectory();
      gitReader(remote)("init", "--bare");
      const git = gitReader(dir);
      git("init", "-b", "main");
      git("config", "user.name", "Release Version Test");
      git("config", "user.email", "release-version@example.invalid");
      git("remote", "add", "origin", remote);
      const packagePath = join(dir, "package.json");
      writeFileSync(
        packagePath,
        JSON.stringify({ name: "fixture", version: currentVersion })
      );
      git("add", "package.json");
      git("commit", "-m", "source");
      const source = git("rev-parse", "HEAD");
      const output = join(dir, "version-output");
      execFileSync(process.execPath, [versionScript], {
        cwd: dir,
        env: {
          ...process.env,
          CUSTOM_VERSION: customVersion,
          RELEASE_TYPE: "minor",
          RELEASE_PRERELEASE: requestedPrerelease,
          GITHUB_OUTPUT: output,
        },
      });
      const outputs = Object.fromEntries(
        readFileSync(output, "utf8")
          .trim()
          .split("\n")
          .map(line => line.split("="))
      );
      expect(outputs.current_version).toBe(currentVersion);
      if (requestedPrerelease === "true")
        expect(outputs.new_version).toMatch(/^1\.38\.0-rc\.\d{12}$/);
      else expect(outputs.new_version).toBe(customVersion.replace(/^v/, ""));
      writeFileSync(
        packagePath,
        JSON.stringify({ name: "fixture", version: outputs.new_version })
      );
      writeFileSync(
        join(dir, "CHANGELOG.md"),
        "Reviewed custom release notes\n"
      );
      git("add", "package.json", "CHANGELOG.md");
      git("commit", "-m", "reviewed release");
      const commit = git("rev-parse", "HEAD");
      const tag = `v${outputs.new_version}`;
      git("tag", "-a", tag, "-m", "Reviewed release");
      git("push", "origin", `refs/tags/${tag}`);

      // Run the real publisher CLI with a local HTTP stub. The new process has
      // no dispatch inputs, exactly as on the merged release's push event.
      const preload = join(dir, "fetch-stub.mjs");
      const published = join(dir, "published.json");
      writeFileSync(
        preload,
        `
      import { writeFileSync } from "node:fs";
      globalThis.fetch = async (url, options) => {
        if (!options.method) return new Response(null, { status: 404 });
        if (options.method !== "POST") throw new Error("Unexpected HTTP method");
        writeFileSync(process.env.PUBLISHED_PAYLOAD, options.body);
        return Response.json({ html_url: "https://example.invalid/release" }, { status: 201 });
      };
    `
      );
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        RELEASE_TAG: tag,
        RELEASE_SOURCE_SHA: source,
        GITHUB_REPOSITORY: "fixture/repo",
        GITHUB_TOKEN: "test-only",
        RELEASE_NOTES: "Reviewed custom release notes",
        PUBLISHED_PAYLOAD: published,
      };
      delete env.RELEASE_PRERELEASE;
      delete env.CUSTOM_VERSION;
      execFileSync(
        process.execPath,
        ["--import", preload, publisherScript, "publish"],
        { cwd: dir, env }
      );
      expect(JSON.parse(readFileSync(published, "utf8"))).toMatchObject({
        tag_name: tag,
        target_commitish: commit,
        prerelease: expectedPrerelease,
        generate_release_notes: false,
      });
      expect(git("rev-parse", "HEAD")).toBe(commit);
    }
  );
});
