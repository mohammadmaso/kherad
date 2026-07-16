import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fs from "node:fs";
import { readBlob, readCommit, resolveRef } from "isomorphic-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createGitEngine, DEFAULT_BRANCH, type GitEngine } from "./index";
import { buildSubtreeMirror, documentMirrorRefName } from "./subtree";

const AUTHOR = { name: "Alice", email: "alice@kherad.local" };

async function readText(gitdir: string, oid: string, filepath: string): Promise<string> {
  const { blob } = await readBlob({ fs, gitdir, oid, filepath });
  return Buffer.from(blob).toString("utf8");
}

describe("buildSubtreeMirror", () => {
  let gitdir: string;
  let engine: GitEngine;

  beforeEach(async () => {
    gitdir = mkdtempSync(join(tmpdir(), "kherad-subtree-test-"));
    engine = createGitEngine(gitdir);
    await engine.initRepo();
  });

  afterEach(() => {
    rmSync(gitdir, { recursive: true, force: true });
  });

  it("resolves null when the path prefix never existed on the source ref", async () => {
    const result = await buildSubtreeMirror(
      gitdir,
      DEFAULT_BRANCH,
      "wiki/eng",
      documentMirrorRefName(),
    );
    expect(result).toEqual({ tipOid: null, commitCount: 0 });
  });

  it("re-roots the bundle's subtree and skips commits that didn't touch it", async () => {
    await engine.createUserBranch("alice");
    await engine.writeAndCommit(
      "user/alice",
      [
        { path: "wiki/eng/a.md", content: "hello" },
        { path: "other/x.md", content: "unrelated" },
      ],
      "add eng page and unrelated page",
      AUTHOR,
    );
    await engine.squashMerge("user/alice", DEFAULT_BRANCH, "merge alice's MR");

    // Touches only the unrelated path — should be skipped (identical subtree).
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "other/x.md", content: "changed" }],
      "unrelated change",
      AUTHOR,
    );

    // Touches the bundle path again — should be picked up.
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "wiki/eng/a.md", content: "hello v2" }],
      "update eng page",
      AUTHOR,
    );

    const mirrorRef = documentMirrorRefName();
    const result = await buildSubtreeMirror(gitdir, DEFAULT_BRANCH, "wiki/eng", mirrorRef);

    expect(result.tipOid).not.toBeNull();
    expect(result.commitCount).toBe(2);

    // The tip's tree is re-rooted: "a.md" lives at the root, not "wiki/eng/a.md".
    expect(await readText(gitdir, result.tipOid!, "a.md")).toBe("hello v2");

    // The ref was actually written.
    expect(await resolveRef({ fs, gitdir, ref: mirrorRef })).toBe(result.tipOid);

    // History is linear with the original commit messages/authors preserved.
    const tip = await readCommit({ fs, gitdir, oid: result.tipOid! });
    expect(tip.commit.message).toBe("update eng page\n");
    expect(tip.commit.author.name).toBe(AUTHOR.name);
    expect(tip.commit.parent).toHaveLength(1);

    const root = await readCommit({ fs, gitdir, oid: tip.commit.parent[0]! });
    expect(root.commit.message).toBe("merge alice's MR\n");
    expect(root.commit.parent).toEqual([]);
  });

  it("rebuilding the mirror is idempotent when nothing under the path changed", async () => {
    await engine.createUserBranch("alice");
    await engine.writeAndCommit(
      "user/alice",
      [{ path: "wiki/eng/a.md", content: "hello" }],
      "add page",
      AUTHOR,
    );
    await engine.squashMerge("user/alice", DEFAULT_BRANCH, "merge alice's MR");

    const mirrorRef = documentMirrorRefName();
    const first = await buildSubtreeMirror(gitdir, DEFAULT_BRANCH, "wiki/eng", mirrorRef);
    const second = await buildSubtreeMirror(gitdir, DEFAULT_BRANCH, "wiki/eng", mirrorRef);

    expect(second.tipOid).toBe(first.tipOid);
    expect(second.commitCount).toBe(first.commitCount);
  });
});
