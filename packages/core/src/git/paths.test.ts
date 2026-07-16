import { describe, expect, it } from "vitest";

import { normalizePagePath, pagePathFromTitle, resolvePagePath } from "../page-paths";

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
