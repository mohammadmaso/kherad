import { describe, expect, it } from "vitest";

import { chunkMarkdownForEmbedding } from "./chunking";

describe("chunkMarkdownForEmbedding", () => {
  it("prefixes chunks with the page title", async () => {
    const chunks = await chunkMarkdownForEmbedding(
      "Payroll",
      "## Overview\n\nPayroll runs every month on the 15th.",
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toMatch(/^Payroll\n\n/);
  });

  it("splits on ATX ##+ headings and packs short sections", async () => {
    const md = [
      "## One",
      "",
      "Short A.",
      "",
      "## Two",
      "",
      "Short B.",
      "",
      "## Three",
      "",
      "Short C.",
    ].join("\n");
    const chunks = await chunkMarkdownForEmbedding("Doc", md);
    // Short sections pack into fewer chunks than section count.
    expect(chunks.length).toBeLessThan(3);
    expect(chunks.some((c) => c.includes("Short A") && c.includes("Short B"))).toBe(true);
  });

  it("splits oversized sections with overlap", async () => {
    const para = "Word ".repeat(400); // ~2000 chars
    const md = `## Big\n\n${para}\n\n${para}\n\n${para}`;
    const chunks = await chunkMarkdownForEmbedding("Title", md);
    expect(chunks.length).toBeGreaterThan(1);
    // Overlap: consecutive chunks share some trailing/leading content.
    if (chunks.length >= 2) {
      const a = chunks[0]!.slice(-80);
      const b = chunks[1]!;
      // At least some shared vocabulary from overlap window.
      expect(a.split(/\s+/).some((w) => w.length > 2 && b.includes(w))).toBe(true);
    }
  });

  it("hard-caps at 64 chunks", async () => {
    const sections = Array.from({ length: 100 }, (_, i) => {
      const body = `Paragraph ${i} with enough unique content to avoid packing: ${"x".repeat(1200)}`;
      return `## Section ${i}\n\n${body}`;
    }).join("\n\n");
    const chunks = await chunkMarkdownForEmbedding("Cap", sections);
    expect(chunks.length).toBeLessThanOrEqual(64);
  });

  it("returns a title-only chunk for empty markdown", async () => {
    const chunks = await chunkMarkdownForEmbedding("Alone", "");
    expect(chunks).toEqual(["Alone"]);
  });
});
