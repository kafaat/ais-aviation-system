import { describe, expect, it } from "vitest";
import { selectProposalVersion } from "../../../scripts/ci/release-proposal.mjs";

const sha = "a".repeat(40);
const branch = (version: string) => `${sha}\trefs/heads/release/v${version}`;
const tag = (version: string) => `${sha}\trefs/tags/v${version}`;
const options = {
  current: "1.37.0",
  candidate: "1.37.1",
  remoteRefs: "",
};

describe("open release proposal version selection", () => {
  it("selects the calculated version when there is no unpublished proposal", () => {
    expect(selectProposalVersion(options)).toBe("1.37.1");
  });

  it("ignores released branches, including annotated tags", () => {
    expect(
      selectProposalVersion({
        ...options,
        remoteRefs: [
          `${sha}\trefs/heads/main`,
          branch("1.36.0"),
          tag("1.36.0"),
          `${sha}\trefs/tags/v1.36.0^{}`,
          branch("1.37.0"),
          tag("1.37.0"),
        ].join("\n"),
      })
    ).toBe("1.37.1");
  });

  it("refreshes an already reviewed higher release scope on an automatic run", () => {
    expect(
      selectProposalVersion({ ...options, remoteRefs: branch("1.38.0") })
    ).toBe("1.38.0");
  });

  it("rejects a different manually selected release scope instead of silently choosing it", () => {
    expect(() =>
      selectProposalVersion({
        ...options,
        remoteRefs: branch("1.38.0"),
        manual: true,
      })
    ).toThrow();
  });

  it.each([false, true])(
    "rejects an open proposal below the required release scope (manual=%s)",
    manual => {
      expect(() =>
        selectProposalVersion({
          ...options,
          candidate: "1.38.0",
          remoteRefs: branch("1.37.1"),
          manual,
        })
      ).toThrow("below the required");
    }
  );

  it("reuses the original prerelease timestamp when main advances", () => {
    expect(
      selectProposalVersion({
        ...options,
        candidate: "1.38.0",
        remoteRefs: branch("1.38.0-rc.202611040100"),
      })
    ).toBe("1.38.0-rc.202611040100");
  });

  it("reuses the original timestamp on a repeated manual prerelease request", () => {
    expect(
      selectProposalVersion({
        ...options,
        candidate: "1.38.0-rc.202611050100",
        remoteRefs: branch("1.38.0-rc.202611040100"),
        manual: true,
        requestedPrerelease: true,
      })
    ).toBe("1.38.0-rc.202611040100");
  });

  it("reuses a custom prerelease requested without its generated timestamp", () => {
    expect(
      selectProposalVersion({
        ...options,
        candidate: "1.38.0-rc.202611050100",
        remoteRefs: branch("1.38.0-rc.202611040100"),
        customVersion: "v1.38.0",
        manual: true,
        requestedPrerelease: true,
      })
    ).toBe("1.38.0-rc.202611040100");
  });

  it.each([
    {
      existing: "1.38.0",
      candidate: "1.38.0-rc.202611050100",
      requestedPrerelease: true,
    },
    {
      existing: "1.38.0-rc.202611040100",
      candidate: "1.38.0",
      requestedPrerelease: false,
    },
  ])(
    "refuses a manual change to the prerelease choice for $existing",
    ({ existing, candidate, requestedPrerelease }) => {
      expect(() =>
        selectProposalVersion({
          ...options,
          candidate,
          remoteRefs: branch(existing),
          manual: true,
          requestedPrerelease,
        })
      ).toThrow("different prerelease choice");
    }
  );

  it("retains an explicit custom prerelease with the checkbox unchecked", () => {
    expect(
      selectProposalVersion({
        ...options,
        candidate: "1.38.0-beta.2",
        remoteRefs: branch("1.38.0-beta.2"),
        customVersion: "v1.38.0-beta.2",
        manual: true,
        requestedPrerelease: false,
      })
    ).toBe("1.38.0-beta.2");
  });

  it("rejects conflicting explicit custom prerelease identifiers", () => {
    expect(() =>
      selectProposalVersion({
        ...options,
        candidate: "1.38.0-beta.3",
        remoteRefs: branch("1.38.0-beta.2"),
        customVersion: "v1.38.0-beta.3",
        manual: true,
      })
    ).toThrow("different release");
  });

  it("allows a reviewed stable promotion from the current prerelease", () => {
    expect(
      selectProposalVersion({
        ...options,
        current: "1.38.0-rc.1",
        candidate: "1.38.0",
        remoteRefs: branch("1.38.0"),
        customVersion: "1.38.0",
        manual: true,
      })
    ).toBe("1.38.0");
  });

  it("compares numeric prerelease identifiers rather than string order", () => {
    expect(
      selectProposalVersion({
        ...options,
        current: "1.38.0-rc.9",
        candidate: "1.38.0-rc.10",
        remoteRefs: branch("1.38.0-rc.10"),
        customVersion: "1.38.0-rc.10",
        manual: true,
      })
    ).toBe("1.38.0-rc.10");
  });

  it.each(["1.36.9", "1.37.0", "1.37.0-rc.1"])(
    "rejects an outstanding version %s that no longer advances main",
    version => {
      expect(() =>
        selectProposalVersion({ ...options, remoteRefs: branch(version) })
      ).toThrow("does not advance");
    }
  );

  it("refuses ambiguous unpublished branches without silently ignoring either", () => {
    expect(() =>
      selectProposalVersion({
        ...options,
        remoteRefs: [branch("1.37.1"), branch("1.38.0")].join("\n"),
      })
    ).toThrow("Several unpublished");
  });

  it("rejects a malformed release branch before choosing it", () => {
    expect(() =>
      selectProposalVersion({ ...options, remoteRefs: branch("1.38.0;unsafe") })
    ).toThrow("Expected a version");
  });
});

describe("refresh without a new release classification", () => {
  const reuseOptions = { ...options, candidate: "", reuseOnly: true };

  it("refreshes an existing manual stable proposal after a documentation-only follow-up", () => {
    expect(
      selectProposalVersion({
        ...reuseOptions,
        remoteRefs: branch("1.38.0"),
      })
    ).toBe("1.38.0");
  });

  it("retains a same-core stable promotion from the current prerelease", () => {
    expect(
      selectProposalVersion({
        ...reuseOptions,
        current: "1.38.0-rc.9",
        remoteRefs: branch("1.38.0"),
      })
    ).toBe("1.38.0");
  });

  it("retains a manually selected prerelease without regenerating its identifier", () => {
    expect(
      selectProposalVersion({
        ...reuseOptions,
        remoteRefs: branch("1.38.0-rc.202611040100"),
      })
    ).toBe("1.38.0-rc.202611040100");
  });

  it.each(["", [branch("1.37.1"), tag("1.37.1")].join("\n")])(
    "refuses to invent a version when no unpublished branch remains (%j)",
    remoteRefs => {
      expect(() =>
        selectProposalVersion({ ...reuseOptions, remoteRefs })
      ).toThrow();
    }
  );

  it("still rejects multiple unpublished proposals", () => {
    expect(() =>
      selectProposalVersion({
        ...reuseOptions,
        remoteRefs: [branch("1.37.1"), branch("1.38.0")].join("\n"),
      })
    ).toThrow("Several unpublished");
  });

  it("still validates the existing branch version", () => {
    expect(() =>
      selectProposalVersion({
        ...reuseOptions,
        remoteRefs: branch("1.38.0;unsafe"),
      })
    ).toThrow("Expected a version");
  });

  it.each(["1.36.9", "1.37.0", "1.37.0-rc.1"])(
    "still rejects an outstanding version %s that no longer advances main",
    version => {
      expect(() =>
        selectProposalVersion({ ...reuseOptions, remoteRefs: branch(version) })
      ).toThrow("does not advance");
    }
  );
});
