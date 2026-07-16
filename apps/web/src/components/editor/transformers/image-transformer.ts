import type { TextMatchTransformer } from "@lexical/markdown";

import { $createImageNode, $isImageNode, ImageNode } from "../nodes/image-node";

/**
 * `![alt](src)` <-> ImageNode. Must come before the default LINK transformer
 * in the transformer array, or `[alt](src)` would match first and leave a
 * stray `!` behind.
 */
export const IMAGE_TRANSFORMER: TextMatchTransformer = {
  dependencies: [ImageNode],
  export: (node) => {
    if (!$isImageNode(node)) return null;
    return `![${node.getAltText()}](${node.getSrc()})`;
  },
  importRegExp: /!\[([^[]*)\]\(([^()\s]+)\)/,
  regExp: /!\[([^[]*)\]\(([^()\s]+)\)$/,
  replace: (textNode, match) => {
    const [, altText, src] = match;
    textNode.replace($createImageNode(src ?? "", altText ?? ""));
  },
  trigger: ")",
  type: "text-match",
};
