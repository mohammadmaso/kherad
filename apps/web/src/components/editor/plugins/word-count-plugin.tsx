"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { useEffect, useState, type JSX } from "react";

function count(text: string): { words: number; characters: number } {
  const trimmed = text.trim();
  return {
    words: trimmed === "" ? 0 : trimmed.split(/\s+/).length,
    characters: trimmed.length,
  };
}

export function WordCountPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [{ words, characters }, setCounts] = useState(() =>
    count(editor.getEditorState().read(() => $getRoot().getTextContent())),
  );

  useEffect(() => {
    return editor.registerTextContentListener((text) => {
      setCounts(count(text));
    });
  }, [editor]);

  return (
    <div className="text-muted-foreground flex select-none justify-end px-1 text-xs tabular-nums">
      {words} {words === 1 ? "word" : "words"} · {characters}{" "}
      {characters === 1 ? "character" : "characters"}
    </div>
  );
}
