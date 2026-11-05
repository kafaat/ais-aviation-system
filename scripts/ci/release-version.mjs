/** Persist the operator's prerelease choice in the reviewed package version. */
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function parseVersion(value) {
  if (typeof value !== "string") throw new Error("Expected a version string");
  // Keep the publisher's tag grammar: no build metadata or empty components
  // between prerelease separators. Numeric identifiers also follow SemVer.
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?$/.exec(
      value
    );
  if (!match || match[0] !== value)
    throw new Error("Expected a version such as 1.38.0 or 1.38.0-rc.1");
  const prerelease = match[4] ? match[4].split(".") : [];
  if (prerelease.some(part => /^\d+$/.test(part) && /^0\d/.test(part)))
    throw new Error("Numeric prerelease identifiers cannot have leading zeros");
  return { core: match.slice(1, 4).map(BigInt), prerelease };
}

function compareParsedVersions(left, right) {
  for (let index = 0; index < left.core.length; index++) {
    if (left.core[index] !== right.core[index])
      return left.core[index] > right.core[index] ? 1 : -1;
  }
  if (!left.prerelease.length || !right.prerelease.length)
    return Number(!left.prerelease.length) - Number(!right.prerelease.length);
  for (
    let index = 0;
    index < Math.max(left.prerelease.length, right.prerelease.length);
    index++
  ) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === b) continue;
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    if (aNumeric) return BigInt(a) > BigInt(b) ? 1 : -1;
    return a > b ? 1 : -1;
  }
  return 0;
}

export function compareVersions(left, right) {
  return compareParsedVersions(parseVersion(left), parseVersion(right));
}

/**
 * @param {{ currentVersion: string, releaseType?: string, customVersion?: string,
 *   prerelease?: boolean, now?: Date }} options
 */
export function calculateReleaseVersion({
  currentVersion,
  releaseType,
  customVersion = "",
  prerelease = false,
  now = new Date(),
}) {
  const current = parseVersion(currentVersion);
  if (typeof customVersion !== "string" || typeof prerelease !== "boolean")
    throw new Error("Custom version must be a string and prerelease a boolean");
  let version;
  if (customVersion) {
    // Accept a copied tag once; repeated prefixes and whitespace remain errors.
    version = customVersion.replace(/^v/, "");
    parseVersion(version);
  } else {
    const bump = new Map([
      ["major", 0],
      ["minor", 1],
      ["patch", 2],
    ]).get(releaseType);
    if (bump === undefined)
      throw new Error("Release type must be major, minor or patch");
    const core = current.core.map((part, index) =>
      index < bump ? part : index === bump ? part + 1n : 0n
    );
    version = core.join(".");
  }
  // The next run is a push after review/merge and has no workflow inputs.
  // A committed suffix therefore carries the choice through both phases and
  // also prevents a custom prerelease tag from entering stable deployment.
  if (prerelease && !parseVersion(version).prerelease.length) {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
      throw new Error("Expected a valid prerelease timestamp");
    const timestamp = now.toISOString().replace(/\D/g, "").slice(0, 12);
    version += `-rc.${timestamp}`;
  }
  if (compareParsedVersions(parseVersion(version), current) <= 0)
    throw new Error("Release version must be greater than the current version");
  return version;
}

function main() {
  const requested = process.env.RELEASE_PRERELEASE || "false";
  if (!["true", "false"].includes(requested))
    throw new Error("RELEASE_PRERELEASE must be true or false");
  const currentVersion = JSON.parse(
    readFileSync("package.json", "utf8")
  ).version;
  const newVersion = calculateReleaseVersion({
    currentVersion,
    customVersion: process.env.CUSTOM_VERSION || "",
    releaseType: process.env.RELEASE_TYPE || "",
    prerelease: requested === "true",
  });
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `current_version=${currentVersion}\nnew_version=${newVersion}\n`
  );
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
