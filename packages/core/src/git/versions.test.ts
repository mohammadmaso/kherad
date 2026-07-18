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

describe("bundle wiki versions", () => {
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

  it("purgeBundle removes content trees and version branches for one slug", async () => {
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [
        { path: "raw/eng/a.md", content: "eng" },
        { path: "okf/eng/index.md", content: "okf" },
        { path: "raw/hr/handbook.md", content: "hr" },
      ],
      "seed",
      AUTHOR,
    );
    await engine.createBundleWikiVersion("eng", "v1", AUTHOR);

    await engine.purgeBundle("eng", DEFAULT_BRANCH, AUTHOR);

    expect(await readText(engine, "raw/eng/a.md")).toBeNull();
    expect(await readText(engine, "okf/eng/index.md")).toBeNull();
    expect(await readText(engine, "raw/hr/handbook.md")).toBe("hr");
    expect(await engine.listBundleWikiVersions("eng")).toEqual([]);
  });

  it("creates, lists, restores, and deletes a version", async () => {
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "raw/eng/a.md", content: "version one" }],
      "state one",
      AUTHOR,
    );

    const version = await engine.createBundleWikiVersion("eng", "v1", AUTHOR);
    expect(version.name).toBe("v1");

    // The snapshot commit's tree is just the bundle's subtree.
    const snapshot = await readCommit({ fs, gitdir, oid: version.oid });
    expect(snapshot.commit.message).toContain('Snapshot bundle "eng" version "v1"');

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

    const versions = await engine.listBundleWikiVersions("eng");
    expect(versions.map((v) => v.name)).toEqual(["v1"]);

    // Restore rolls the bundle's content back as a single new commit on main.
    const restore = await engine.restoreBundleWikiVersion("eng", "v1", AUTHOR);
    expect(restore.restored).toBe(true);
    expect(await readText(engine, "raw/eng/a.md")).toBe("version one");
    expect(await readText(engine, "raw/eng/b.md")).toBeNull();

    const tip = await readCommit({ fs, gitdir, oid: restore.afterOid });
    expect(tip.commit.parent).toEqual([restore.beforeOid]);

    // The pre-restore state is still reachable: snapshot it and go back.
    const restoreAgain = await engine.restoreBundleWikiVersion("eng", "v1", AUTHOR);
    expect(restoreAgain.restored).toBe(false); // already at v1's tree

    await engine.deleteBundleWikiVersion("eng", "v1");
    expect(await engine.listBundleWikiVersions("eng")).toEqual([]);
  });

  it("restoring one bundle's version leaves every other bundle untouched", async () => {
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [
        { path: "raw/eng/a.md", content: "eng one" },
        { path: "raw/design/a.md", content: "design one" },
      ],
      "seed both bundles",
      AUTHOR,
    );
    await engine.createBundleWikiVersion("eng", "v1", AUTHOR);

    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [
        { path: "raw/eng/a.md", content: "eng two" },
        { path: "raw/design/a.md", content: "design two" },
      ],
      "update both bundles",
      AUTHOR,
    );

    await engine.restoreBundleWikiVersion("eng", "v1", AUTHOR);
    expect(await readText(engine, "raw/eng/a.md")).toBe("eng one");
    // The design bundle was never part of the "eng" version — untouched.
    expect(await readText(engine, "raw/design/a.md")).toBe("design two");

    // "design" has no versions of its own.
    expect(await engine.listBundleWikiVersions("design")).toEqual([]);
  });

  it("a bundle's version snapshot never contains another bundle's pages", async () => {
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [
        { path: "raw/eng/a.md", content: "eng one" },
        { path: "raw/design/a.md", content: "design one" },
        { path: "okf/design/index.md", content: "design compiled" },
      ],
      "seed both bundles",
      AUTHOR,
    );
    const version = await engine.createBundleWikiVersion("eng", "v1", AUTHOR);

    const versionRef = `version/eng/v1`;
    expect(await readText(engine, "raw/design/a.md")).toBe("design one"); // sanity: main still has it
    const engBytes = await engine.getFileAtRef(versionRef, "raw/eng/a.md");
    expect(Buffer.from(engBytes!).toString("utf8")).toBe("eng one");
    const designBytes = await engine.getFileAtRef(versionRef, "raw/design/a.md");
    expect(designBytes).toBeNull();
    // Another bundle's compiled OKF docs are excluded too.
    expect(await engine.getFileAtRef(versionRef, "okf/design/index.md")).toBeNull();
    expect(await engine.getRefOid(versionRef)).toBe(version.oid);
  });

  it("snapshots and restores the bundle's compiled okf/ docs alongside its pages", async () => {
    // An llm_compiled bundle: the public wiki renders okf/<slug>, so a
    // version snapshot without it would read as an empty wiki.
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [
        { path: "raw/eng/a.md", content: "source one" },
        { path: "okf/eng/index.md", content: "compiled one" },
        { path: "okf/eng/concepts/x.md", content: "concept one" },
      ],
      "compile one",
      AUTHOR,
    );
    await engine.createBundleWikiVersion("eng", "v1", AUTHOR);

    // The snapshot carries the compiled docs — viewing the version works.
    const snapBytes = await engine.getFileAtRef("version/eng/v1", "okf/eng/index.md");
    expect(Buffer.from(snapBytes!).toString("utf8")).toBe("compiled one");

    // Wiki moves on: recompiled docs, one concept doc removed.
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [
        { path: "raw/eng/a.md", content: "source two" },
        { path: "okf/eng/index.md", content: "compiled two" },
        { path: "okf/eng/concepts/x.md", content: null },
      ],
      "compile two",
      AUTHOR,
    );

    // Restore rolls back sources AND compiled docs together.
    const restore = await engine.restoreBundleWikiVersion("eng", "v1", AUTHOR);
    expect(restore.restored).toBe(true);
    expect(await readText(engine, "raw/eng/a.md")).toBe("source one");
    expect(await readText(engine, "okf/eng/index.md")).toBe("compiled one");
    expect(await readText(engine, "okf/eng/concepts/x.md")).toBe("concept one");
  });

  it("lists a bundle's commits and creates a version from an older commit", async () => {
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

    const commits = await engine.listBundleWikiCommits("eng");
    expect(commits.map((c) => c.summary)).toEqual(["state two", "state one"]);
    expect(commits[1]!.oid).toBe(oldOid);
    expect(commits[0]!.authorName).toBe("Alice");

    // Snapshot the older commit — the version tree is that commit's bundle
    // subtree, and main is untouched.
    const version = await engine.createBundleWikiVersion("eng", "v-old", AUTHOR, oldOid);
    const snapshot = await readCommit({ fs, gitdir, oid: version.oid });
    expect(snapshot.commit.parent).toEqual([oldOid]);

    const bytes = await engine.getFileAtRef("version/eng/v-old", "raw/eng/a.md");
    expect(Buffer.from(bytes!).toString("utf8")).toBe("old content");
    expect(await readText(engine, "raw/eng/a.md")).toBe("new content");

    // Restoring that version rolls the bundle back to the old content.
    const restore = await engine.restoreBundleWikiVersion("eng", "v-old", AUTHOR);
    expect(restore.restored).toBe(true);
    expect(await readText(engine, "raw/eng/a.md")).toBe("old content");
  });

  it("rejects creating a version from a nonexistent commit", async () => {
    await expect(
      engine.createBundleWikiVersion(
        "eng",
        "bad",
        AUTHOR,
        "0000000000000000000000000000000000000000",
      ),
    ).rejects.toThrow(WikiVersionError);
  });

  it("rejects snapshotting a bundle with no pages yet", async () => {
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "raw/eng/a.md", content: "content" }],
      "seed",
      AUTHOR,
    );
    await expect(engine.createBundleWikiVersion("empty-bundle", "v1", AUTHOR)).rejects.toThrow(
      WikiVersionError,
    );
  });

  it("rejects duplicate and missing version names", async () => {
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "raw/eng/a.md", content: "content" }],
      "seed",
      AUTHOR,
    );
    await engine.createBundleWikiVersion("eng", "v1", AUTHOR);
    await expect(engine.createBundleWikiVersion("eng", "v1", AUTHOR)).rejects.toThrow(
      WikiVersionError,
    );
    await expect(engine.restoreBundleWikiVersion("eng", "nope", AUTHOR)).rejects.toThrow(
      WikiVersionError,
    );
    await expect(engine.deleteBundleWikiVersion("eng", "nope")).rejects.toThrow(WikiVersionError);
  });

  it("version branches don't leak into user-draft resolution", async () => {
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "raw/eng/a.md", content: "main content" }],
      "seed",
      AUTHOR,
    );
    await engine.createBundleWikiVersion("eng", "old", AUTHOR);
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "raw/eng/a.md", content: "newer content" }],
      "update",
      AUTHOR,
    );

    const latest = await engine.getLatestSourcePageAtRef(DEFAULT_BRANCH, "eng", "a");
    expect(Buffer.from(latest!).toString("utf8")).toBe("newer content");
  });

  it("sees pre-migration commits under the legacy wiki/<slug> layout", async () => {
    // Two commits before this bundle was ever saved under raw/…
    const legacyOid = await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "wiki/eng/a.md", content: "legacy content 1" }],
      "legacy edit 1",
      AUTHOR,
    );
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "wiki/eng/a.md", content: "legacy content 2" }],
      "legacy edit 2",
      AUTHOR,
    );
    // Then the page gets re-saved, landing under the current raw/ layout.
    await engine.writeAndCommit(
      DEFAULT_BRANCH,
      [{ path: "raw/eng/a.md", content: "migrated content" }],
      "migrated edit",
      AUTHOR,
    );

    const commits = await engine.listBundleWikiCommits("eng");
    expect(commits.map((c) => c.summary)).toEqual([
      "migrated edit",
      "legacy edit 2",
      "legacy edit 1",
    ]);

    // Snapshotting from a pre-migration commit must not fail just because
    // that commit has no raw/<slug> content yet.
    await engine.createBundleWikiVersion("eng", "v-legacy", AUTHOR, legacyOid);
    const bytes = await engine.getFileAtRef("version/eng/v-legacy", "wiki/eng/a.md");
    expect(Buffer.from(bytes!).toString("utf8")).toBe("legacy content 1");

    // Restoring that legacy-only version must also clear the now-migrated
    // raw/<slug> copy, since the snapshot never had one.
    const restore = await engine.restoreBundleWikiVersion("eng", "v-legacy", AUTHOR);
    expect(restore.restored).toBe(true);
    expect(await readText(engine, "raw/eng/a.md")).toBeNull();
    expect(await readText(engine, "wiki/eng/a.md")).toBe("legacy content 1");
  });
});
