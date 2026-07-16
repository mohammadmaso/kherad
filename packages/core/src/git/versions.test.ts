import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fs from "node:fs";
import { readCommit } from "isomorphic-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createGitEngine, DEFAULT_BRANCH, type GitEngine } from "./index";
import { isValidVersionName, WikiVersionError } from "./versions";

const AUTHOR = { name: "Alice", email: "alice@kherad.local" };

async function readText(engine: GitEngine, path: string): Promise<string | null> {
  const bytes = await engine.getFileAtRef(DEFAULT_BRANCH, path);
  return bytes === null ? null : Buffer.from(bytes).toString("utf8");
}

describe("wiki versions", () => {
  let gitdir: string;
  let engine: GitEngine;

  beforeEach(async () => {
    gitdir = mkdtempSync(join(tmpdir(), "kherad-versions-test-"));
    engine = createGitEngine(gitdir);
    await engine.initRepo();
  });

  afterEach(() => {
    rmSync(gitdir, { recursive: true, force: true });
  });

  it("validates version names", () => {
    expect(isValidVersionName("v1.0")).toBe(true);
    expect(isValidVersionName("release-2026_07")).toBe(true);
    expect(isValidVersionName("")).toBe(false);
    expect(isValidVersionName(".hidden")).toBe(false);
    expect(isValidVersionName("a..b")).toBe(false);
    expect(isValidVersionName("has space")).toBe(false);
    expect(isValidVersionName("nested/name")).toBe(false);
    expect(isValidVersionName("bad.lock")).toBe(false);
  });

  it("creates, lists, restores, and deletes a version", async () => {
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "raw/eng/a.md", content: "version one" }],
      "state one",
      AUTHOR,
    );

    const version = await engine.createWikiVersion("v1", AUTHOR);
    expect(version.name).toBe("v1");

    // The snapshot commit shares main's tree but is its own commit.
    const snapshot = await readCommit({ fs, gitdir, oid: version.oid });
    expect(snapshot.commit.message).toContain('Snapshot wiki version "v1"');

    // Wiki moves on: page edited, another added.
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [
        { path: "raw/eng/a.md", content: "version two" },
        { path: "raw/eng/b.md", content: "new page" },
      ],
      "state two",
      AUTHOR,
    );

    const versions = await engine.listWikiVersions();
    expect(versions.map((v) => v.name)).toEqual(["v1"]);

    // Restore rolls content back as a single new commit on main.
    const restore = await engine.restoreWikiVersion("v1", AUTHOR);
    expect(restore.restored).toBe(true);
    expect(await readText(engine, "raw/eng/a.md")).toBe("version one");
    expect(await readText(engine, "raw/eng/b.md")).toBeNull();

    const tip = await readCommit({ fs, gitdir, oid: restore.afterOid });
    expect(tip.commit.parent).toEqual([restore.beforeOid]);

    // The pre-restore state is still reachable: snapshot it and go back.
    const restoreAgain = await engine.restoreWikiVersion("v1", AUTHOR);
    expect(restoreAgain.restored).toBe(false); // already at v1's tree

    await engine.deleteWikiVersion("v1");
    expect(await engine.listWikiVersions()).toEqual([]);
  });

  it("lists main's commits and creates a version from an older commit", async () => {
    const oldOid = await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "raw/eng/a.md", content: "old content" }],
      "state one",
      AUTHOR,
    );
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "raw/eng/a.md", content: "new content" }],
      "state two",
      AUTHOR,
    );

    const commits = await engine.listWikiCommits();
    expect(commits.map((c) => c.summary)).toEqual(["state two", "state one", "Initial commit"]);
    expect(commits[1]!.oid).toBe(oldOid);
    expect(commits[0]!.authorName).toBe("Alice");

    // Snapshot the older commit — the version tree is that commit's tree,
    // and main is untouched.
    const version = await engine.createWikiVersion("v-old", AUTHOR, oldOid);
    const snapshot = await readCommit({ fs, gitdir, oid: version.oid });
    expect(snapshot.commit.parent).toEqual([oldOid]);

    const bytes = await engine.getFileAtRef(`version/v-old`, "raw/eng/a.md");
    expect(Buffer.from(bytes!).toString("utf8")).toBe("old content");
    expect(await readText(engine, "raw/eng/a.md")).toBe("new content");

    // Restoring that version rolls main back to the old content.
    const restore = await engine.restoreWikiVersion("v-old", AUTHOR);
    expect(restore.restored).toBe(true);
    expect(await readText(engine, "raw/eng/a.md")).toBe("old content");
  });

  it("rejects creating a version from a nonexistent commit", async () => {
    await expect(
      engine.createWikiVersion("bad", AUTHOR, "0000000000000000000000000000000000000000"),
    ).rejects.toThrow(WikiVersionError);
  });

  it("rejects duplicate and missing version names", async () => {
    await engine.createWikiVersion("v1", AUTHOR);
    await expect(engine.createWikiVersion("v1", AUTHOR)).rejects.toThrow(WikiVersionError);
    await expect(engine.restoreWikiVersion("nope", AUTHOR)).rejects.toThrow(WikiVersionError);
    await expect(engine.deleteWikiVersion("nope")).rejects.toThrow(WikiVersionError);
  });

  it("version branches don't leak into user-draft resolution", async () => {
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "raw/eng/a.md", content: "main content" }],
      "seed",
      AUTHOR,
    );
    await engine.createWikiVersion("old", AUTHOR);
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "raw/eng/a.md", content: "newer content" }],
      "update",
      AUTHOR,
    );

    const latest = await engine.getLatestSourcePageAtRef(DEFAULT_BRANCH, "eng", "a");
    expect(Buffer.from(latest!).toString("utf8")).toBe("newer content");
  });
});
