import { describe, expect, it } from "vitest";

import {
  frontmatterToMetadata,
  parseOkfFrontmatter,
  serializeOkfFrontmatter,
  stripFrontmatter,
} from "../markdown/frontmatter";

describe("parseOkfFrontmatter", () => {
  it("parses known keys and extras", () => {
    const md = `---
type: concept
title: Payroll
tags:
  - finance
  - hr
custom: value
---

# Body
`;
    const fm = parseOkfFrontmatter(md);
    expect(fm).toMatchObject({
      type: "concept",
      title: "Payroll",
      tags: ["finance", "hr"],
      extra: { custom: "value" },
    });
    expect(stripFrontmatter(md)).toMatch(/^# Body/);
  });

  it("returns null when no frontmatter", () => {
    expect(parseOkfFrontmatter("# Hello")).toBeNull();
  });

  it("does not treat OCR page-separator lines as frontmatter delimiters", () => {
    const md = `--- Page 1 ---
# Heading
Name: Jane Doe
Date: 2024-01-01

--- Page 2 ---
More content
`;
    expect(parseOkfFrontmatter(md)).toBeNull();
    expect(stripFrontmatter(md)).toBe(md);
  });

  it("round-trips through serialize", () => {
    const original = {
      type: "process",
      title: "Onboarding",
      description: "How we hire",
      tags: ["hr"],
      resource: "/wiki/acme/source/hr/onboarding",
      timestamp: "2026-01-01T00:00:00Z",
      extra: { owner: "People" },
    };
    const serialized = serializeOkfFrontmatter(original);
    const parsed = parseOkfFrontmatter(`${serialized}Body`);
    expect(parsed).toMatchObject({
      type: "process",
      title: "Onboarding",
      tags: ["hr"],
      extra: { owner: "People" },
    });
  });

  it("frontmatterToMetadata flattens extras", () => {
    const meta = frontmatterToMetadata({
      type: "concept",
      title: "X",
      extra: { foo: "bar" },
    });
    expect(meta).toEqual({ type: "concept", title: "X", foo: "bar" });
  });
});
