import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createGitEngine, DEFAULT_BRANCH, type GitEngine } from "./index";

const AUTHOR = { name: "Test", email: "test@example.com" };

describe("getLatestSourcePageAtRef", () => {
  let gitdir: string;
  let engine: GitEngine;

  beforeEach(async () => {
    gitdir = mkdtempSync(join(tmpdir(), "kherad-source-test-"));
    engine = createGitEngine(gitdir);
    await engine.initRepo();
  });

  afterEach(() => {
    rmSync(gitdir, { recursive: true, force: true });
  });

  it("reads a draft from a user branch when main has no copy yet", async () => {
    await engine.writeAndCommit(
      "user/alice",
      [{ path: "raw/demo/kkf.md", content: "# compile3\n" }],
      "draft kkf",
      AUTHOR,
    );

    const onMain = await engine.getSourcePageAtRef(DEFAULT_BRANCH, "demo", "kkf");
    expect(onMain).toBeNull();

    const latest = await engine.getLatestSourcePageAtRef(DEFAULT_BRANCH, "demo", "kkf");
    expect(latest).not.toBeNull();
    expect(new TextDecoder().decode(latest!)).toBe("# compile3\n");
  });
});
