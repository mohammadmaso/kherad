import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readCommit, resolveRef, writeCommit, writeRef, writeTree } from "isomorphic-git";
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BINARY_CONFLICT_OURS,
  BINARY_CONFLICT_THEIRS,
  createGitEngine,
  DEFAULT_BRANCH,
  MergeConflictDetectedError,
  userBranchName,
  type GitEngine,
} from "./index";

const AUTHOR = { name: "Alice", email: "alice@kherad.local" };

function decode(bytes: Uint8Array | null): string | null {
  return bytes ? new TextDecoder().decode(bytes) : null;
}

describe("git engine", () => {
  let gitdir: string;
  let engine: GitEngine;

  beforeEach(async () => {
    gitdir = mkdtempSync(join(tmpdir(), "kherad-git-test-"));
    engine = createGitEngine(gitdir);
    await engine.initRepo();
  });

  afterEach(() => {
    rmSync(gitdir, { recursive: true, force: true });
  });

  it("initRepo is idempotent and creates the default branch", async () => {
    await engine.initRepo();
    await engine.initRepo();
    expect(await engine.listBranches()).toEqual([DEFAULT_BRANCH]);
  });

  it("createUserBranch creates a branch off main and is idempotent", async () => {
    const ref1 = await engine.createUserBranch("alice");
    const ref2 = await engine.createUserBranch("alice");

    expect(ref1).toBe(userBranchName("alice"));
    expect(ref2).toBe(ref1);
    expect(await engine.listBranches()).toContain("user/alice");

    const mainOid = await resolveRef({ fs, gitdir, ref: DEFAULT_BRANCH });
    const branchOid = await resolveRef({ fs, gitdir, ref: "user/alice" });
    expect(branchOid).toBe(mainOid);
  });

  it("writeAndCommit creates a missing branch off main so squashMerge can find a base", async () => {
    await engine.writeAndCommit(
      "agent/okf-demo",
      [{ path: "okf/demo/index.md", content: "# Demo\n" }],
      "compile okf",
      AUTHOR,
    );

    const mainOid = await resolveRef({ fs, gitdir, ref: DEFAULT_BRANCH });
    const { commit } = await readCommit({
      fs,
      gitdir,
      oid: await resolveRef({ fs, gitdir, ref: "agent/okf-demo" }),
    });
    expect(commit.parent).toEqual([mainOid]);

    const result = await engine.squashMerge(
      "agent/okf-demo",
      DEFAULT_BRANCH,
      "merge okf",
      "okf/demo",
    );
    expect(result.oid).toBeTruthy();
    expect(decode(await engine.getFileAtRef(DEFAULT_BRANCH, "okf/demo/index.md"))).toBe("# Demo\n");
  });

  it("ensureBranchOff resets an orphan tip so a later commit can merge", async () => {
    // Simulate the pre-fix bug: an orphan tip with no parent.
    const emptyTree = await writeTree({ fs, gitdir, tree: [] });
    const signature = {
      name: AUTHOR.name,
      email: AUTHOR.email,
      timestamp: Math.floor(Date.now() / 1000),
      timezoneOffset: 0,
    };
    const orphanOid = await writeCommit({
      fs,
      gitdir,
      commit: {
        message: "orphan",
        tree: emptyTree,
        parent: [],
        author: signature,
        committer: signature,
      },
    });
    await writeRef({
      fs,
      gitdir,
      ref: "refs/heads/agent/okf-orphan",
      value: orphanOid,
      force: true,
    });

    await engine.ensureBranchOff("agent/okf-orphan", DEFAULT_BRANCH);
    await engine.writeAndCommit(
      "agent/okf-orphan",
      [{ path: "okf/orphan/index.md", content: "fixed\n" }],
      "repair",
      AUTHOR,
    );

    const result = await engine.squashMerge(
      "agent/okf-orphan",
      DEFAULT_BRANCH,
      "merge repaired",
      "okf/orphan",
    );
    expect(result.oid).toBeTruthy();
  });

  it("writeAndCommit writes and reads back file content, including nested paths", async () => {
    await engine.createUserBranch("alice");
    await engine.writeAndCommit(
      "user/alice",
      [
        { path: "root.md", content: "hello" },
        { path: "wiki/team/page.md", content: "nested" },
      ],
      "add pages",
      AUTHOR,
    );

    expect(decode(await engine.getFileAtRef("user/alice", "root.md"))).toBe("hello");
    expect(decode(await engine.getFileAtRef("user/alice", "wiki/team/page.md"))).toBe("nested");
    expect(await engine.getFileAtRef("user/alice", "does-not-exist.md")).toBeNull();
  });

  it("listFilesAtRef lists blob paths and filters by directory prefix", async () => {
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [
        { path: "wiki/team/page.md", content: "raw" },
        { path: "okf/team/index.md", content: "index" },
        { path: "okf/team/concepts/thing.md", content: "concept" },
        { path: "okf/teammates/index.md", content: "other bundle" },
      ],
      "add files",
      AUTHOR,
    );

    expect((await engine.listFilesAtRef(DEFAULT_BRANCH, "okf/team")).sort()).toEqual([
      "okf/team/concepts/thing.md",
      "okf/team/index.md",
    ]);
    expect(await engine.listFilesAtRef(DEFAULT_BRANCH)).toContain("wiki/team/page.md");
    expect(await engine.listFilesAtRef("no-such-branch", "okf/team")).toEqual([]);
  });

  it("writeAndCommit supports rename (delete old path + add new path) in one commit", async () => {
    await engine.createUserBranch("alice");
    await engine.writeAndCommit(
      "user/alice",
      [{ path: "wiki/team/old.md", content: "content" }],
      "add page",
      AUTHOR,
    );

    await engine.writeAndCommit(
      "user/alice",
      [
        { path: "wiki/team/old.md", content: null },
        { path: "wiki/team/new.md", content: "content" },
      ],
      "rename page",
      AUTHOR,
    );

    expect(await engine.getFileAtRef("user/alice", "wiki/team/old.md")).toBeNull();
    expect(decode(await engine.getFileAtRef("user/alice", "wiki/team/new.md"))).toBe("content");
  });

  it("diffRefs reports added/modified/deleted, optionally scoped to a path", async () => {
    await engine.createUserBranch("alice");
    await engine.writeAndCommit(
      "user/alice",
      [
        { path: "a.md", content: "a" },
        { path: "b.md", content: "b" },
      ],
      "base",
      AUTHOR,
    );
    const baseOid = await resolveRef({ fs, gitdir, ref: "user/alice" });

    await engine.writeAndCommit(
      "user/alice",
      [
        { path: "a.md", content: "a changed" },
        { path: "b.md", content: null },
        { path: "c.md", content: "c" },
      ],
      "changes",
      AUTHOR,
    );

    const diff = await engine.diffRefs(baseOid, "user/alice");
    expect([...diff].sort((x, y) => x.path.localeCompare(y.path))).toEqual([
      { path: "a.md", status: "modified" },
      { path: "b.md", status: "deleted" },
      { path: "c.md", status: "added" },
    ]);

    const scoped = await engine.diffRefs(baseOid, "user/alice", "a.md");
    expect(scoped).toEqual([{ path: "a.md", status: "modified" }]);
  });

  it("squashMerge preserves unrelated changes already on the target branch", async () => {
    await engine.createUserBranch("alice");
    await engine.writeAndCommit(
      "user/alice",
      [{ path: "alice.md", content: "alice's page" }],
      "alice adds a page",
      AUTHOR,
    );

    // Simulate someone else's change already merged into main independently.
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "bob.md", content: "bob's page" }],
      "bob's change, already merged",
      { name: "Bob", email: "bob@kherad.local" },
    );

    const oldMainOid = await resolveRef({ fs, gitdir, ref: DEFAULT_BRANCH });
    const result = await engine.squashMerge(
      "user/alice",
      DEFAULT_BRANCH,
      "Squash merge alice's MR",
    );
    expect(result.alreadyMerged).toBe(false);

    expect(decode(await engine.getFileAtRef(DEFAULT_BRANCH, "alice.md"))).toBe("alice's page");
    expect(decode(await engine.getFileAtRef(DEFAULT_BRANCH, "bob.md"))).toBe("bob's page");

    const finalCommit = await readCommit({ fs, gitdir, oid: result.oid });
    expect(finalCommit.commit.parent).toEqual([oldMainOid]);
  });

  it("squashMerge is a no-op when the source branch has nothing new", async () => {
    await engine.createUserBranch("alice");
    const oldMainOid = await resolveRef({ fs, gitdir, ref: DEFAULT_BRANCH });

    const result = await engine.squashMerge("user/alice", DEFAULT_BRANCH, "nothing to merge");
    expect(result.alreadyMerged).toBe(true);
    expect(result.oid).toBe(oldMainOid);
  });

  it("squashMerge throws MergeConflictDetectedError with raw markers when both branches edit the same lines", async () => {
    await engine.createUserBranch("alice");
    await engine.writeAndCommit(
      "user/alice",
      [{ path: "page.md", content: "line1\nline2\nline3\n" }],
      "alice adds the page",
      AUTHOR,
    );
    await engine.squashMerge("user/alice", DEFAULT_BRANCH, "merge alice's page");

    // Bob branches off main *after* alice's page landed, then diverges from it.
    await engine.createUserBranch("bob");
    await engine.writeAndCommit(
      "user/bob",
      [{ path: "page.md", content: "line1\nBOB-line2\nline3\n" }],
      "bob edits line2",
      { name: "Bob", email: "bob@kherad.local" },
    );
    // Meanwhile a different, already-approved MR lands directly on main, touching the same line.
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "page.md", content: "line1\nMAIN-line2\nline3\n" }],
      "someone else's change, already merged",
      AUTHOR,
    );

    await expect(
      engine.squashMerge("user/bob", DEFAULT_BRANCH, "merge bob's MR"),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(MergeConflictDetectedError);
      const conflictErr = err as MergeConflictDetectedError;
      expect(conflictErr.files).toHaveLength(1);
      const [file] = conflictErr.files;
      expect(file?.path).toBe("page.md");
      expect(file?.markerText).toContain("<<<<<<< main");
      expect(file?.markerText).toContain("MAIN-line2");
      expect(file?.markerText).toContain("=======");
      expect(file?.markerText).toContain("BOB-line2");
      expect(file?.markerText).toContain(">>>>>>> user/bob");
      return true;
    });
  });

  it("conflict markers stay on their own lines when file sides omit a trailing newline", async () => {
    // Markdown / editor saves often omit the final newline. Without padding,
    // diff3 concatenation glued `=======` / `>>>>>>>` onto the previous line
    // (e.g. "```======="), which broke the conflict-resolution UI parser.
    await engine.createUserBranch("alice");
    await engine.writeAndCommit(
      "user/alice",
      [{ path: "page.md", content: "line1\n```\ncode\n```" }],
      "alice adds fence without trailing newline",
      AUTHOR,
    );
    await engine.squashMerge("user/alice", DEFAULT_BRANCH, "merge alice");

    await engine.createUserBranch("bob");
    await engine.writeAndCommit(
      "user/bob",
      [{ path: "page.md", content: "line1\n```\ncode\n```\nextra" }],
      "bob appends without trailing newline",
      { name: "Bob", email: "bob@kherad.local" },
    );
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "page.md", content: "line1\n```\nMAIN\n```" }],
      "main edits fence body, still no trailing newline",
      AUTHOR,
    );

    await expect(engine.squashMerge("user/bob", DEFAULT_BRANCH, "merge bob")).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(MergeConflictDetectedError);
        const markerText = (err as MergeConflictDetectedError).files[0]?.markerText ?? "";
        expect(markerText).toMatch(/\n={7}\n/);
        expect(markerText).toMatch(/\n>{7} /);
        expect(markerText).not.toMatch(/```={7}/);
        expect(markerText).not.toMatch(/[^\n]>{7} /);
        return true;
      },
    );
  });

  it("squashMerge uses NUL-free sentinel markers for binary image conflicts", async () => {
    const pngOurs = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x01]);
    const pngTheirs = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x02]);
    const pngBase = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x00]);

    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [
        { path: "doc.md", content: "line1\nline2\n" },
        { path: "_assets/pic.png", content: pngBase },
      ],
      "seed",
      AUTHOR,
    );

    await engine.createUserBranch("bob");
    await engine.writeAndCommit(
      "user/bob",
      [
        { path: "doc.md", content: "line1\nBOB\n" },
        { path: "_assets/pic.png", content: pngTheirs },
      ],
      "bob edits text and image",
      { name: "Bob", email: "bob@kherad.local" },
    );
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [
        { path: "doc.md", content: "line1\nMAIN\n" },
        { path: "_assets/pic.png", content: pngOurs },
      ],
      "main diverges on both",
      AUTHOR,
    );

    const conflict = await engine
      .squashMerge("user/bob", DEFAULT_BRANCH, "merge bob")
      .catch((err: unknown) => {
        if (err instanceof MergeConflictDetectedError) return err;
        throw err;
      });
    expect(conflict).toBeInstanceOf(MergeConflictDetectedError);
    const files = (conflict as MergeConflictDetectedError).files;
    expect(files.map((f) => f.path).sort()).toEqual(["_assets/pic.png", "doc.md"]);

    const imageConflict = files.find((f) => f.path === "_assets/pic.png");
    expect(imageConflict?.markerText).toContain(BINARY_CONFLICT_OURS);
    expect(imageConflict?.markerText).toContain(BINARY_CONFLICT_THEIRS);
    expect(imageConflict?.markerText.includes("\0")).toBe(false);

    await engine.resolveMergeConflict("user/bob", DEFAULT_BRANCH, "merge bob resolved", [
      { path: "doc.md", content: "line1\nRESOLVED\n" },
      { path: "_assets/pic.png", content: BINARY_CONFLICT_THEIRS },
    ]);

    const mergedPng = await engine.getFileAtRef(DEFAULT_BRANCH, "_assets/pic.png");
    expect(mergedPng).not.toBeNull();
    expect(Buffer.from(mergedPng!).equals(Buffer.from(pngTheirs))).toBe(true);
    expect(decode(await engine.getFileAtRef(DEFAULT_BRANCH, "doc.md"))).toBe("line1\nRESOLVED\n");
  });

  it("resolveMergeConflict finishes the merge with the manager's resolved text and keeps unrelated changes", async () => {
    await engine.createUserBranch("alice");
    await engine.writeAndCommit(
      "user/alice",
      [{ path: "page.md", content: "line1\nline2\nline3\n" }],
      "alice adds the page",
      AUTHOR,
    );
    await engine.squashMerge("user/alice", DEFAULT_BRANCH, "merge alice's page");

    await engine.createUserBranch("bob");
    await engine.writeAndCommit(
      "user/bob",
      [
        { path: "page.md", content: "line1\nBOB-line2\nline3\n" },
        { path: "bob-only.md", content: "unrelated content only bob touched" },
      ],
      "bob edits line2 and adds a new page",
      { name: "Bob", email: "bob@kherad.local" },
    );
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "page.md", content: "line1\nMAIN-line2\nline3\n" }],
      "someone else's change, already merged",
      AUTHOR,
    );

    const conflict = await engine
      .squashMerge("user/bob", DEFAULT_BRANCH, "merge bob's MR")
      .catch((err: unknown) => {
        if (err instanceof MergeConflictDetectedError) return err;
        throw err;
      });
    expect(conflict).toBeInstanceOf(MergeConflictDetectedError);

    const oldMainOid = await resolveRef({ fs, gitdir, ref: DEFAULT_BRANCH });
    const result = await engine.resolveMergeConflict(
      "user/bob",
      DEFAULT_BRANCH,
      "merge bob's MR (resolved)",
      [{ path: "page.md", content: "line1\nRESOLVED-line2\nline3\n" }],
    );
    expect(result.alreadyMerged).toBe(false);

    expect(decode(await engine.getFileAtRef(DEFAULT_BRANCH, "page.md"))).toBe(
      "line1\nRESOLVED-line2\nline3\n",
    );
    expect(decode(await engine.getFileAtRef(DEFAULT_BRANCH, "bob-only.md"))).toBe(
      "unrelated content only bob touched",
    );

    const finalCommit = await readCommit({ fs, gitdir, oid: result.oid });
    expect(finalCommit.commit.parent).toEqual([oldMainOid]);
  });

  it("squashMerge scoped to a pathPrefix ignores conflicting/differing content in other bundles", async () => {
    // All bundles share one branch per user and one `main`, distinguished only
    // by a `wiki/<bundle-slug>/` path prefix — approving bundle A's merge
    // request must not be affected by (or leak in) bundle B's content, even
    // though it lives in the same tree and the same user branch.
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "wiki/bundle-a/page.md", content: "line1\nline2\nline3\n" }],
      "seed bundle A",
      AUTHOR,
    );
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "wiki/bundle-b/page.md", content: "b-line1\nb-line2\n" }],
      "seed bundle B",
      AUTHOR,
    );

    await engine.createUserBranch("carol");
    // Carol only means to touch bundle A...
    await engine.writeAndCommit(
      "user/carol",
      [{ path: "wiki/bundle-a/page.md", content: "line1\nCAROL-line2\nline3\n" }],
      "carol edits bundle A",
      { name: "Carol", email: "carol@kherad.local" },
    );
    // ...but her branch also carries a stale, conflicting edit to bundle B
    // (e.g. an abandoned draft) that genuinely conflicts with what's already
    // on main for that other bundle.
    await engine.writeAndCommit(
      "user/carol",
      [{ path: "wiki/bundle-b/page.md", content: "carol-b-line1\nb-line2\n" }],
      "carol's stale, unrelated bundle B draft",
      { name: "Carol", email: "carol@kherad.local" },
    );
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "wiki/bundle-b/page.md", content: "main-b-line1\nb-line2\n" }],
      "someone else's bundle B change, already merged",
      AUTHOR,
    );

    // Approving carol's bundle-A merge request must succeed cleanly...
    const result = await engine.squashMerge(
      "user/carol",
      DEFAULT_BRANCH,
      "merge carol's bundle A MR",
      "wiki/bundle-a",
    );
    expect(result.alreadyMerged).toBe(false);

    // ...bringing in only the bundle-A change...
    expect(decode(await engine.getFileAtRef(DEFAULT_BRANCH, "wiki/bundle-a/page.md"))).toBe(
      "line1\nCAROL-line2\nline3\n",
    );
    // ...while bundle B on main is completely untouched by carol's unrelated,
    // genuinely-conflicting draft for it.
    expect(decode(await engine.getFileAtRef(DEFAULT_BRANCH, "wiki/bundle-b/page.md"))).toBe(
      "main-b-line1\nb-line2\n",
    );
  });

  it("resolveMergeConflict works with pathPrefix for okf subtree", async () => {
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "okf/demo/concepts/a.md", content: "line1\nline2\nline3\n" }],
      "seed okf",
      AUTHOR,
    );

    await engine.ensureBranchOff("agent/okf-1", DEFAULT_BRANCH);
    await engine.writeAndCommit(
      "agent/okf-1",
      [{ path: "okf/demo/concepts/a.md", content: "line1\nAGENT-line2\nline3\n" }],
      "agent compile",
      AUTHOR,
    );

    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "okf/demo/concepts/a.md", content: "line1\nMAIN-line2\nline3\n" }],
      "main edit",
      AUTHOR,
    );

    const conflict = await engine
      .squashMerge("agent/okf-1", DEFAULT_BRANCH, "merge okf", "okf/demo")
      .catch((err: unknown) => {
        if (err instanceof MergeConflictDetectedError) return err;
        throw err;
      });
    expect(conflict).toBeInstanceOf(MergeConflictDetectedError);
    if (!(conflict instanceof MergeConflictDetectedError)) {
      throw new Error("expected a MergeConflictDetectedError");
    }
    expect(conflict.files[0]?.path).toBe("okf/demo/concepts/a.md");

    const result = await engine.resolveMergeConflict(
      "agent/okf-1",
      DEFAULT_BRANCH,
      "merge okf (resolved)",
      [{ path: "okf/demo/concepts/a.md", content: "line1\nRESOLVED-line2\nline3\n" }],
      "okf/demo",
    );
    expect(result.alreadyMerged).toBe(false);
    expect(decode(await engine.getFileAtRef(DEFAULT_BRANCH, "okf/demo/concepts/a.md"))).toBe(
      "line1\nRESOLVED-line2\nline3\n",
    );
  });

  it("serializes concurrent writeAndCommit calls without corrupting history", async () => {
    await engine.createUserBranch("alice");

    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        engine.writeAndCommit(
          "user/alice",
          [{ path: `file-${i}.md`, content: `content-${i}` }],
          `commit ${i}`,
          AUTHOR,
        ),
      ),
    );

    // Every write succeeded and produced a distinct commit oid.
    expect(new Set(results).size).toBe(N);

    // Every file made it into the final tree — nothing was lost to a lost-update race.
    for (let i = 0; i < N; i++) {
      expect(decode(await engine.getFileAtRef("user/alice", `file-${i}.md`))).toBe(`content-${i}`);
    }

    // The history is a clean single-parent chain of exactly N commits above the
    // branch point (no two commits sharing a parent / clobbering each other).
    let oid = await resolveRef({ fs, gitdir, ref: "user/alice" });
    const branchPointOid = await resolveRef({ fs, gitdir, ref: DEFAULT_BRANCH });
    let count = 0;
    while (oid !== branchPointOid) {
      const commit = await readCommit({ fs, gitdir, oid });
      expect(commit.commit.parent.length).toBe(1);
      oid = commit.commit.parent[0]!;
      count++;
    }
    expect(count).toBe(N);
  });
});
