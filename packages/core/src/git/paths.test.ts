import { describe, expect, it } from "vitest";

import {
  normalizePagePath,
  pagePathFromTitle,
  resolveCreatePagePath,
  resolvePagePath,
  slugifyPagePath,
} from "../page-paths";

describe("pagePathFromTitle", () => {
  it("slugifies a Latin title", () => {
    expect(pagePathFromTitle("Getting Started")).toBe("getting-started");
  });

  it("preserves non-Latin letters", () => {
    expect(pagePathFromTitle("راهنما")).toBe("راهنما");
  });

  it("falls back when the title has no path-safe characters", () => {
    expect(pagePathFromTitle("!!!")).toBe("untitled");
    expect(pagePathFromTitle("   ")).toBe("untitled");
  });
});

describe("normalizePagePath", () => {
  it("strips leading and trailing slashes", () => {
    expect(normalizePagePath("/guides/start/")).toBe("guides/start");
    expect(normalizePagePath("  /a/b  ")).toBe("a/b");
  });

  it("rejects empty middle segments and traversal", () => {
    expect(normalizePagePath("a//b")).toBeNull();
    expect(normalizePagePath("../escape")).toBeNull();
  });
});

describe("slugifyPagePath", () => {
  it("slugifies each segment", () => {
    expect(slugifyPagePath("My Folder/New Doc")).toBe("my-folder/new-doc");
  });

  it("returns null for blank input", () => {
    expect(slugifyPagePath("  ")).toBeNull();
    expect(slugifyPagePath("/")).toBeNull();
  });
});

describe("resolveCreatePagePath", () => {
  it("places the title slug under a typed new folder", () => {
    expect(resolveCreatePagePath({ folder: "New Docs", title: "Getting Started" })).toBe(
      "new-docs/getting-started",
    );
  });

  it("creates nested subdirectories from a folder path", () => {
    expect(resolveCreatePagePath({ folder: "team/onboarding", title: "Welcome" })).toBe(
      "team/onboarding/welcome",
    );
  });

  it("joins folder and explicit leaf", () => {
    expect(
      resolveCreatePagePath({ folder: "guides", path: "setup guide", title: "Ignored" }),
    ).toBe("guides/setup-guide");
  });

  it("uses a full path when no folder is set", () => {
    expect(resolveCreatePagePath({ path: "guides/start", title: "Ignored" })).toBe(
      "guides/start",
    );
  });

  it("falls back to the title slug", () => {
    expect(resolveCreatePagePath({ title: "Payroll Policy" })).toBe("payroll-policy");
  });
});

describe("resolvePagePath", () => {
  it("prefers an explicit path", () => {
    expect(resolvePagePath({ path: "guides/start", title: "Ignored" })).toBe("guides/start");
  });

  it("derives from title when path is blank", () => {
    expect(resolvePagePath({ path: "", title: "Payroll Policy" })).toBe("payroll-policy");
    expect(resolvePagePath({ path: "  ", title: "Payroll Policy" })).toBe("payroll-policy");
  });

  it("rejects invalid explicit paths", () => {
    expect(resolvePagePath({ path: "../escape", title: "Title" })).toBeNull();
    expect(normalizePagePath("a//b")).toBeNull();
  });
});
