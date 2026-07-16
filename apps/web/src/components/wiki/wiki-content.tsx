"use client";

import { useEffect, useRef } from "react";

let mermaidInitialized = false;

/**
 * Renders server-produced wiki HTML (Markdown → Shiki-highlighted HTML via
 * `packages/core/markdown`) and, post-hydration, finds any `<pre
 * class="mermaid">` blocks the pipeline left untouched and renders them
 * client-side (PRD §6/§12 — no headless browser on the server for v1).
 */
export function WikiContent({ html }: { html: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const blocks = Array.from(container.querySelectorAll<HTMLElement>("pre.mermaid"));
    if (blocks.length === 0) return;

    let cancelled = false;
    const namespace = `wiki-mermaid-${Math.random().toString(36).slice(2)}`;

    (async () => {
      const mermaid = (await import("mermaid")).default;
      if (!mermaidInitialized) {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
        mermaidInitialized = true;
      }

      for (const [index, block] of blocks.entries()) {
        const source = block.textContent ?? "";
        try {
          const { svg } = await mermaid.render(`${namespace}-${index}`, source);
          if (!cancelled) block.outerHTML = svg;
        } catch (err) {
          if (!cancelled) {
            block.textContent = err instanceof Error ? err.message : "Failed to render diagram";
            block.classList.add("mermaid-error");
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [html]);

  return (
    <div
      ref={containerRef}
      className="wiki-content"
      // Content is Markdown authored by internal staff and squash-merged
      // only after review (PRD §7); code blocks are Shiki-highlighted HTML
      // produced server-side, not raw author input.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
