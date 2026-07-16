import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fs from "node:fs";
import { readBlob, readCommit, resolveRef, writeCommit } from "isomorphic-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createGitEngine, DEFAULT_BRANCH, type GitEngine } from "./index";
import { applyRemoteSubtree } from "./remote-pull";
import { toGitSignature } from "./repo";
import { applyTreeChanges } from "./tree";

const AUTHOR = { name: "Alice", email: "alice@kherad.local" };

async function readText(gitdir: string, oid: string, filepath: string): Promise<string> {
  const { blob } = await readBlob({ fs, gitdir, oid, filepath });
  return Buffer.from(blob).toString("utf8");
}

async function fileExists(gitdir: string, oid: string, filepath: string): Promise<boolean> {
  try {
    await readBlob({ fs, gitdir, oid, filepath });
    return true;
  } catch {
    return false;
  }
}

/** Fabricates a standalone "remote" commit inside the same object store (as a real fetch would). */
async function writeRemoteCommit(
  gitdir: string,
  files: Record<string, string>,
): Promise<string> {
  const treeOid = await applyTreeChanges(
    gitdir,
    undefined,
    new Map(Object.entries(files)),
  );
  const signature = toGitSignature(AUTHOR);
  return writeCommit({
    fs,
    gitdir,
    commit: {
      message: "remote commit",
      tree: treeOid,
      parent: [],
      author: signature,
      committer: signature,
    },
  });
}

describe("applyRemoteSubtree", () => {
  let gitdir: string;
  let engine: GitEngine;

  beforeEach(async () => {
    gitdir = mkdtempSync(join(tmpdir(), "kherad-remote-pull-test-"));
    engine = createGitEngine(gitdir);
    await engine.initRepo();
  });

  afterEach(() => {
    rmSync(gitdir, { recursive: true, force: true });
  });

  it("mirrors the remote tree under the prefix and leaves siblings untouched", async () => {
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [
        { path: "raw/eng/local-only.md", content: "kept locally only" },
        { path: "raw/eng/shared.md", content: "old version" },
        { path: "raw/hr/handbook.md", content: "other bundle" },
        { path: "okf/eng/index.md", content: "compiled" },
      ],
      "seed",
      AUTHOR,
    );

    const remoteOid = await writeRemoteCommit(gitdir, {
      "shared.md": "new version",
      "guides/setup.md": "brand new page",
    });

    const result = await applyRemoteSubtree(
      gitdir,
      DEFAULT_BRANCH,
      "raw/eng",
      remoteOid,
      "pull eng",
      AUTHOR,
    );

    expect(result.changed).toBe(true);
    expect(await resolveRef({ fs, gitdir, ref: DEFAULT_BRANCH })).toBe(result.afterOid);

    // Exact mirror: updated + added, local-only page under the prefix removed.
    expect(await readText(gitdir, result.afterOid, "raw/eng/shared.md")).toBe("new version");
    expect(await readText(gitdir, result.afterOid, "raw/eng/guides/setup.md")).toBe(
      "brand new page",
    );
    expect(await fileExists(gitdir, result.afterOid, "raw/eng/local-only.md")).toBe(false);

    // Other bundles and other top-level trees are untouched.
    expect(await readText(gitdir, result.afterOid, "raw/hr/handbook.md")).toBe("other bundle");
    expect(await readText(gitdir, result.afterOid, "okf/eng/index.md")).toBe("compiled");

    // Single commit parented on the previous tip.
    const commit = await readCommit({ fs, gitdir, oid: result.afterOid });
    expect(commit.commit.parent).toEqual([result.beforeOid]);
  });

  it("is a no-op when the subtree already matches the remote", async () => {
    const remoteOid = await writeRemoteCommit(gitdir, { "a.md": "same" });

    const first = await applyRemoteSubtree(
      gitdir,
      DEFAULT_BRANCH,
      "raw/eng",
      remoteOid,
      "pull eng",
      AUTHOR,
    );
    const second = await applyRemoteSubtree(
      gitdir,
      DEFAULT_BRANCH,
      "raw/eng",
      remoteOid,
      "pull eng again",
      AUTHOR,
    );

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.afterOid).toBe(first.afterOid);
  });

  it("removes stale legacy prefixes in the same pull commit", async () => {
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [
        { path: "wiki/eng/old.md", content: "legacy copy" },
        { path: "wiki/hr/other.md", content: "other bundle legacy" },
      ],
      "legacy seed",
      AUTHOR,
    );

    const remoteOid = await writeRemoteCommit(gitdir, { "old.md": "pulled" });
    const result = await applyRemoteSubtree(
      gitdir,
      DEFAULT_BRANCH,
      "raw/eng",
      remoteOid,
      "pull eng",
      AUTHOR,
      ["wiki/eng"],
    );

    expect(await readText(gitdir, result.afterOid, "raw/eng/old.md")).toBe("pulled");
    expect(await fileExists(gitdir, result.afterOid, "wiki/eng/old.md")).toBe(false);
    expect(await readText(gitdir, result.afterOid, "wiki/hr/other.md")).toBe(
      "other bundle legacy",
    );
  });

  it("an empty remote tree removes the subtree entirely", async () => {
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "raw/eng/a.md", content: "will be removed" }],
      "seed",
      AUTHOR,
    );

    const remoteOid = await writeRemoteCommit(gitdir, {});
    const result = await applyRemoteSubtree(
      gitdir,
      DEFAULT_BRANCH,
      "raw/eng",
      remoteOid,
      "pull eng",
      AUTHOR,
    );

    expect(result.changed).toBe(true);
    expect(await fileExists(gitdir, result.afterOid, "raw/eng/a.md")).toBe(false);
  });
});
