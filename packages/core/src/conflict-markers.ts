const OURS_MARKER = /^<{7} (.*)$/;
const DIVIDER_MARKER = /^={7}$/;
const THEIRS_MARKER = /^>{7} (.*)$/;
/** Opening marker glued to the end of a context line (no trailing newline before it). */
const GLUED_OURS_MARKER = /^(.*)<{7} (.*)$/;
/** Divider glued to the end of an "ours" line. */
const GLUED_DIVIDER_MARKER = /^(.*)={7}$/;
/** Closing marker glued to the end of a "theirs" line. */
const GLUED_THEIRS_MARKER = /^(.*)>{7} (.*)$/;

export type ConflictContextSegment = { kind: "context"; text: string };

export type ConflictHunkSegment = {
  kind: "conflict";
  id: string;
  oursLabel: string;
  theirsLabel: string;
  ours: string;
  theirs: string;
};

export type ConflictSegment = ConflictContextSegment | ConflictHunkSegment;

/**
 * Splits diff3 `<<<<<<<`/`=======`/`>>>>>>>` marker text (as produced by the
 * git engine's conflict resolution) into alternating context/conflict
 * segments, so a UI can render each conflicting hunk as a pick-one card
 * instead of asking a non-technical manager to hand-edit raw git markers.
 *
 * Also accepts markers that were glued onto the previous line (files /
 * conflict sides with no trailing newline) — older conflict rows in the DB
 * can look like `` ```======= `` or `text>>>>>>> branch`.
 */
export function parseConflictMarkers(markerText: string): ConflictSegment[] {
  const lines = markerText.split("\n");
  const segments: ConflictSegment[] = [];

  let context: string[] = [];
  let ours: string[] | null = null;
  let theirs: string[] | null = null;
  let oursLabel = "";
  let theirsLabel = "";
  let hunkIndex = 0;

  const flushContext = () => {
    if (context.length > 0) {
      segments.push({ kind: "context", text: context.join("\n") });
      context = [];
    }
  };

  const pushHunk = (label: string) => {
    theirsLabel = label;
    segments.push({
      kind: "conflict",
      id: `hunk-${hunkIndex++}`,
      oursLabel,
      theirsLabel,
      ours: ours!.join("\n"),
      theirs: theirs!.join("\n"),
    });
    ours = null;
    theirs = null;
  };

  for (const line of lines) {
    if (ours === null && theirs === null) {
      const oursMatch = OURS_MARKER.exec(line);
      if (oursMatch) {
        flushContext();
        ours = [];
        oursLabel = oursMatch[1] ?? "";
        continue;
      }
      const gluedOurs = GLUED_OURS_MARKER.exec(line);
      if (gluedOurs) {
        const before = gluedOurs[1] ?? "";
        if (before.length > 0) context.push(before);
        flushContext();
        ours = [];
        oursLabel = gluedOurs[2] ?? "";
        continue;
      }
      context.push(line);
      continue;
    }

    if (ours !== null && theirs === null) {
      if (DIVIDER_MARKER.test(line)) {
        theirs = [];
        continue;
      }
      const gluedDivider = GLUED_DIVIDER_MARKER.exec(line);
      if (gluedDivider) {
        const before = gluedDivider[1] ?? "";
        if (before.length > 0) ours.push(before);
        theirs = [];
        continue;
      }
      ours.push(line);
      continue;
    }

    // theirs !== null
    const theirsMatch = THEIRS_MARKER.exec(line);
    if (theirsMatch) {
      pushHunk(theirsMatch[1] ?? "");
      continue;
    }
    const gluedTheirs = GLUED_THEIRS_MARKER.exec(line);
    if (gluedTheirs) {
      const before = gluedTheirs[1] ?? "";
      if (before.length > 0) theirs!.push(before);
      pushHunk(gluedTheirs[2] ?? "");
      continue;
    }
    theirs!.push(line);
  }

  flushContext();
  return segments;
}

export type HunkResolution = { mode: "ours" | "theirs" | "both" | "custom"; customText?: string };

function resolvedHunkText(
  hunk: ConflictHunkSegment,
  resolution: HunkResolution | undefined,
): string {
  if (!resolution) return "";
  switch (resolution.mode) {
    case "ours":
      return hunk.ours;
    case "theirs":
      return hunk.theirs;
    case "both":
      return [hunk.ours, hunk.theirs].filter((text) => text.length > 0).join("\n");
    case "custom":
      return resolution.customText ?? "";
  }
}

/** Reassembles full file text from parsed segments plus the manager's per-hunk choices. */
export function assembleResolvedText(
  segments: ConflictSegment[],
  resolutions: Record<string, HunkResolution>,
): string {
  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const text =
      segment.kind === "context"
        ? segment.text
        : resolvedHunkText(segment, resolutions[segment.id]);
    // Drop empty conflict resolutions so choosing an empty side does not
    // insert a blank line where the markers used to be. Keep empty context
    // (intentional blank lines between hunks).
    if (segment.kind === "conflict" && text.length === 0) continue;
    parts.push(text);
  }
  return parts.join("\n");
}

export function conflictHunks(segments: ConflictSegment[]): ConflictHunkSegment[] {
  return segments.filter((segment): segment is ConflictHunkSegment => segment.kind === "conflict");
}
