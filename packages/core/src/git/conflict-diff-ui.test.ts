import { describe, expect, it } from "vitest";

import {
  assembleResolvedText,
  conflictHunks,
  parseConflictMarkers,
} from "../../../../apps/web/src/lib/conflict-diff";

describe("conflict-diff parser (web UI)", () => {
  it("parses well-formed markers on their own lines", () => {
    const segments = parseConflictMarkers(
      "line1\n<<<<<<< main\nMAIN-line2\n=======\nBOB-line2\n>>>>>>> user/bob\nline3\n",
    );
    expect(conflictHunks(segments)).toHaveLength(1);
    expect(assembleResolvedText(segments, { "hunk-0": { mode: "theirs" } })).toBe(
      "line1\nBOB-line2\nline3\n",
    );
  });

  it("parses markers glued to content when a side has no trailing newline", () => {
    const markerText = `<<<<<<< main
llll

\`\`\`javascript
let a = b;
for N
\`\`\`=======
[llll](/wiki/welcome/kk) 

\`\`\`javascript
let a = b;
for N
\`\`\`

![img](/api/assets/x.jpg)

1405-04-13 18.09.22>>>>>>> user/bob
`;
    const segments = parseConflictMarkers(markerText);
    const hunks = conflictHunks(segments);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.ours.endsWith("```")).toBe(true);
    expect(hunks[0]?.theirs).toContain("[llll](/wiki/welcome/kk)");
    expect(hunks[0]?.theirs).toContain("1405-04-13 18.09.22");
    expect(hunks[0]?.theirs).not.toContain(">>>>>>>");

    expect(assembleResolvedText(segments, { "hunk-0": { mode: "ours" } })).toBe(
      `llll

\`\`\`javascript
let a = b;
for N
\`\`\`
`,
    );
  });

  it("does not insert a blank line when the chosen side is empty", () => {
    const segments = parseConflictMarkers(
      "before\n<<<<<<< main\n=======\ntheirs\n>>>>>>> u\nafter\n",
    );
    expect(assembleResolvedText(segments, { "hunk-0": { mode: "ours" } })).toBe("before\nafter\n");
  });
});
