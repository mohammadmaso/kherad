import type { MultilineElementTransformer } from "@lexical/markdown";
import type { LexicalNode } from "lexical";

import { $createMermaidNode, $isMermaidNode, MermaidNode } from "../nodes/mermaid-node";

/** Fenced ```mermaid blocks <-> MermaidNode, so the stored markdown stays plain and portable. */
export const MERMAID_TRANSFORMER: MultilineElementTransformer = {
  dependencies: [MermaidNode],
  export: (node: LexicalNode) => {
    if (!$isMermaidNode(node)) return null;
    return "```mermaid\n" + node.getSource() + "\n```";
  },
  regExpStart: /^```mermaid$/,
  regExpEnd: /^```$/,
  replace: (rootNode, _children, _startMatch, _endMatch, linesInBetween) => {
    if (!linesInBetween) return;
    rootNode.append($createMermaidNode(linesInBetween.join("\n")));
  },
  type: "multiline-element",
};
