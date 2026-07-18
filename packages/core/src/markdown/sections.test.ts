import { describe, expect, it } from "vitest";

import { assembleDocument, splitIntoSections } from "./sections";

/** Collapse inter-chunk blank lines the way assembleDocument normalizes. */
function normalizeWs(md: string): string {
  return (md.replace(/\n{2,}/g, "\n").replace(/\s+$/, "") + (md.trim().length ? "\n" : "")).trimEnd() + "\n";
}

describe("splitIntoSections", () => {
  it("splits on the shallowest top-level heading depth present", () => {
    const md = [
      "Intro paragraph.",
      "",
      "## First",
      "",
      "Body one.",
      "",
      "### Nested",
      "",
      "Nested body.",
      "",
      "## Second",
      "",
      "Body two.",
      "",
    ].join("\n");

    const result = splitIntoSections(md);
    expect(result.topLevel).toBe(2);
    expect(result.preamble).toContain("Intro paragraph.");
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]!.id).toBe("first");
    expect(result.sections[0]!.headingText).toBe("First");
    expect(result.sections[0]!.markdown).toContain("### Nested");
    expect(result.sections[0]!.markdown).toContain("Nested body.");
    expect(result.sections[1]!.id).toBe("second");
    expect(result.sections[1]!.markdown).toContain("Body two.");
  });

  it("does not split on headings inside fenced or mermaid blocks", () => {
    const md = [
      "## Real",
      "",
      "Before fence.",
      "",
      "```markdown",
      "# Fake heading",
      "```",
      "",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "",
      "## After",
      "",
      "Done.",
      "",
    ].join("\n");

    const result = splitIntoSections(md);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]!.markdown).toContain("# Fake heading");
    expect(result.sections[0]!.markdown).toContain("```mermaid");
    expect(result.sections[1]!.id).toBe("after");
  });

  it("de-duplicates section ids for repeated heading text", () => {
    const md = ["# Notes", "", "a", "", "# Notes", "", "b", ""].join("\n");
    const result = splitIntoSections(md);
    expect(result.sections.map((s) => s.id)).toEqual(["notes", "notes-2"]);
  });

  it("treats a document with no headings as preamble only", () => {
    const md = "Just a paragraph.\n\nAnd another.\n";
    const result = splitIntoSections(md);
    expect(result.topLevel).toBeNull();
    expect(result.sections).toEqual([]);
    expect(result.preamble).toBe(md);
  });

  it("keeps a table wholly inside the section that owns it", () => {
    const md = [
      "## Spec",
      "",
      "| Col | Val |",
      "| --- | --- |",
      "| a | 1 |",
      "",
      "## Next",
      "",
      "After.",
      "",
    ].join("\n");

    const result = splitIntoSections(md);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]!.markdown).toContain("| Col | Val |");
    expect(result.sections[0]!.markdown).toContain("| a | 1 |");
    expect(result.sections[1]!.markdown).not.toContain("| Col | Val |");
  });

  it("round-trips through assembleDocument modulo trailing whitespace", () => {
    const md = [
      "Preamble.",
      "",
      "# Alpha",
      "",
      "One.",
      "",
      "## Nested stays in alpha",
      "",
      "# Beta",
      "",
      "Two.",
      "",
    ].join("\n");

    const split = splitIntoSections(md);
    const reassembled = assembleDocument(split, new Map());
    expect(normalizeWs(reassembled)).toBe(normalizeWs(md));
  });

  it("applies section overrides when assembling", () => {
    const md = ["# A", "", "old", "", "# B", "", "keep", ""].join("\n");
    const split = splitIntoSections(md);
    const out = assembleDocument(split, new Map([["a", "# A\n\nnew\n"]]));
    expect(out).toContain("# A\n\nnew\n");
    expect(out).toContain("# B\n\nkeep\n");
  });
});
