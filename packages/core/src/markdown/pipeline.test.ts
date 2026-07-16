import { describe, expect, it } from "vitest";

import { renderMarkdownToHtml } from "./pipeline";

describe("renderMarkdownToHtml", () => {
  it("marks each paragraph dir=auto so the browser resolves direction from its own text", async () => {
    const html = await renderMarkdownToHtml(
      ["This paragraph is English.", "", "این پاراگراف فارسی است."].join("\n"),
    );

    expect(html).toContain('<p dir="auto">This paragraph is English.</p>');
    expect(html).toContain('<p dir="auto">این پاراگراف فارسی است.</p>');
  });

  it("marks headings, list items, blockquotes, and table cells for auto direction", async () => {
    const html = await renderMarkdownToHtml(
      [
        "# سلام",
        "",
        "- یک",
        "- two",
        "",
        "> نقل قول",
        "",
        "| A | ب |",
        "| --- | --- |",
        "| x | y |",
      ].join("\n"),
    );

    expect(html).toContain('<h1 dir="auto">');
    expect(html).toContain('<li dir="auto">یک</li>');
    expect(html).toContain('<li dir="auto">two</li>');
    expect(html).toContain('<blockquote dir="auto">');
    expect(html).toContain('<p dir="auto">نقل قول</p>');
    expect(html).toContain('<th dir="auto">A</th>');
    expect(html).toContain('<td dir="auto">x</td>');
  });

  it("forces code blocks and inline code to ltr regardless of surrounding language", async () => {
    const html = await renderMarkdownToHtml(
      ["این یک کد است: `const x = 1;`", "", "```text", "const x = 1;", "```"].join("\n"),
    );

    expect(html).toContain('<code dir="ltr">const x = 1;</code>');
    expect(html).toMatch(/<pre[^>]*dir="ltr"/);
  });
});
