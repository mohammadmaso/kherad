"use client";

import { useEffect, useRef } from "react";

import { useI18n } from "@/lib/i18n/provider";

let mermaidInitialized = false;

/**
 * Renders server-produced wiki HTML (Markdown → Shiki-highlighted HTML via
 * `packages/core/markdown`) and, post-hydration, finds any `<pre
 * class="mermaid">` blocks the pipeline left untouched and renders them
 * client-side (PRD §6/§12 — no headless browser on the server for v1).
 */
export function WikiContent({ html }: { html: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const blocks = Array.from(container.querySelectorAll<HTMLElement>("pre.mermaid"));
    if (blocks.length === 0) return;

    let cancelled = false;
    const namespace = `wiki-mermaid-${Math.random().toString(36).slice(2)}`;
    const errorMessage = t.wiki.mermaidRenderFailed;

    (async () => {
      const mermaid = (await import("mermaid")).default;
      if (!mermaidInitialized) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          // Mermaid otherwise injects a red "Syntax error in text / mermaid version …"
          // SVG into the page on parse failure — we handle errors ourselves.
          suppressErrorRendering: true,
        });
        mermaidInitialized = true;
      }

      for (const [index, block] of blocks.entries()) {
        const source = block.textContent ?? "";
        const renderId = `${namespace}-${index}`;
        try {
          const { svg } = await mermaid.render(renderId, source);
          if (!cancelled) block.outerHTML = svg;
        } catch {
          // Mermaid may still leave a temporary error node in <body>.
          document.getElementById(`d${renderId}`)?.remove();
          document.getElementById(renderId)?.remove();
          if (!cancelled) {
            block.textContent = "";
            block.classList.add("mermaid-error");
            const message = document.createElement("p");
            message.className = "mermaid-error-message";
            message.textContent = errorMessage;
            block.appendChild(message);
            if (source.trim()) {
              const code = document.createElement("pre");
              code.className = "mermaid-error-source";
              code.textContent = source.trim();
              block.appendChild(code);
            }
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [html, t.wiki.mermaidRenderFailed]);

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
