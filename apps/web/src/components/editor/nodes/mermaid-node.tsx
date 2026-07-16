import {
  DecoratorNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import type { JSX } from "react";

import { MermaidPreview } from "../mermaid-preview";

export type SerializedMermaidNode = Spread<
  {
    source: string;
  },
  SerializedLexicalNode
>;

function convertMermaidElement(domNode: HTMLElement) {
  const source = domNode.getAttribute("data-mermaid-source") ?? domNode.textContent ?? "";
  return { node: $createMermaidNode(source) };
}

export class MermaidNode extends DecoratorNode<JSX.Element> {
  __source: string;

  static override getType(): string {
    return "mermaid";
  }

  static override clone(node: MermaidNode): MermaidNode {
    return new MermaidNode(node.__source, node.__key);
  }

  constructor(source: string, key?: NodeKey) {
    super(key);
    this.__source = source;
  }

  static override importJSON(serializedNode: SerializedMermaidNode): MermaidNode {
    return $createMermaidNode(serializedNode.source);
  }

  override exportJSON(): SerializedMermaidNode {
    return {
      type: "mermaid",
      version: 1,
      source: this.__source,
    };
  }

  static override importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (domNode.getAttribute("data-lexical-mermaid") !== "true") {
          return null;
        }
        return {
          conversion: convertMermaidElement,
          priority: 1,
        };
      },
    };
  }

  override exportDOM(): DOMExportOutput {
    const element = document.createElement("div");
    element.setAttribute("data-lexical-mermaid", "true");
    element.setAttribute("data-mermaid-source", this.__source);
    element.textContent = this.__source;
    return { element };
  }

  override createDOM(config: EditorConfig): HTMLElement {
    const div = document.createElement("div");
    const theme = config.theme.mermaid;
    if (typeof theme === "string") {
      div.className = theme;
    }
    return div;
  }

  override updateDOM(): boolean {
    return false;
  }

  override isInline(): boolean {
    return false;
  }

  getSource(): string {
    return this.getLatest().__source;
  }

  setSource(source: string): void {
    this.getWritable().__source = source;
  }

  override getTextContent(): string {
    return this.__source;
  }

  override decorate(_editor: LexicalEditor, _config: EditorConfig): JSX.Element {
    return <MermaidPreview nodeKey={this.getKey()} source={this.__source} />;
  }
}

export function $createMermaidNode(source: string): MermaidNode {
  return new MermaidNode(source);
}

export function $isMermaidNode(node: LexicalNode | null | undefined): node is MermaidNode {
  return node instanceof MermaidNode;
}
