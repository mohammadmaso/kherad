"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey } from "lexical";
import { useEffect, useId, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { $isMermaidNode } from "./nodes/mermaid-node";

let mermaidInitialized = false;

export function MermaidPreview({ nodeKey, source }: { nodeKey: string; source: string }) {
  const [editor] = useLexicalComposerContext();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renderId = useId().replace(/:/g, "-");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!source.trim()) {
        if (!cancelled) {
          setSvg(null);
          setError(null);
        }
        return;
      }

      try {
        const mermaid = (await import("mermaid")).default;
        if (!mermaidInitialized) {
          mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
          mermaidInitialized = true;
        }
        const { svg: rendered } = await mermaid.render(`mermaid-${renderId}`, source);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setSvg(null);
          setError(err instanceof Error ? err.message : "Failed to render diagram");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, renderId]);

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isMermaidNode(node)) {
        node.setSource(next);
      }
    });
  }

  // This textarea sits inside Lexical's contentEditable root (as a
  // decorator), so native keydown events still bubble to Lexical's root
  // listener, which intercepts Enter and other keys meant for the document
  // (e.g. turning Enter into "insert a new paragraph after this block"
  // instead of letting the browser insert a newline). Stopping propagation
  // during the capture phase — before it reaches Lexical's listener — keeps
  // all native textarea key handling intact.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    event.stopPropagation();
  }

  return (
    <div className="border-border my-3 overflow-hidden rounded-lg border" contentEditable={false}>
      <div className="border-border bg-muted/40 text-muted-foreground border-b px-3 py-1.5 text-xs font-medium">
        Mermaid diagram
      </div>
      <textarea
        className="w-full resize-y bg-transparent p-3 font-mono text-sm outline-none"
        rows={Math.max(3, source.split("\n").length)}
        value={source}
        onChange={handleChange}
        onKeyDownCapture={handleKeyDown}
        spellCheck={false}
      />
      <div className="border-border border-t p-3">
        {error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : svg ? (
          <div
            className="[&_svg]:mx-auto [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <p className="text-muted-foreground text-sm">Diagram preview will appear here.</p>
        )}
      </div>
    </div>
  );
}
