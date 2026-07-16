import { CHECK_LIST, TRANSFORMERS, type Transformer } from "@lexical/markdown";

import { HR_TRANSFORMER } from "./hr-transformer";
import { IMAGE_TRANSFORMER } from "./image-transformer";
import { MERMAID_TRANSFORMER } from "./mermaid-transformer";
import { TABLE_TRANSFORMER } from "./table-transformer";

/**
 * Order matters — transformers are tried in array order, first match wins:
 * - MERMAID must come before the default CODE transformer (both match fenced blocks)
 *   so ```mermaid fences resolve to MermaidNode instead of a plain code block.
 * - CHECK_LIST must come before the default UNORDERED_LIST so `- [x]` items resolve
 *   to checklist items instead of plain bullets (it is not part of TRANSFORMERS).
 * - IMAGE must come before the default LINK so `![alt](src)` doesn't half-match as
 *   a link with a stray `!`.
 */
export const EDITOR_TRANSFORMERS: Transformer[] = [
  MERMAID_TRANSFORMER,
  TABLE_TRANSFORMER,
  HR_TRANSFORMER,
  CHECK_LIST,
  IMAGE_TRANSFORMER,
  ...TRANSFORMERS,
];
