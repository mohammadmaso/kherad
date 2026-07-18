import type { AuthedUser } from "@kherad/core/auth";
import type { GitEngine } from "@kherad/core/git";
import {
  assembleDocument,
  renderMarkdownToHtml,
  splitIntoSections,
  type PageSection,
  type SectionSplitResult,
} from "@kherad/core/markdown";
import { schema, type Database } from "@kherad/db";
import { createTool } from "@mastra/core/tools";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { createResearchTools } from "./tools";

type SectionEditStatus = "proposed" | "accepted" | "rejected" | "superseded" | "original";

async function loadLatestEdits(db: Database, sessionId: string) {
  return db.query.agentSectionEdits.findMany({
    where: eq(schema.agentSectionEdits.sessionId, sessionId),
    orderBy: desc(schema.agentSectionEdits.createdAt),
  });
}

function latestNonSuperseded(
  edits: Array<typeof schema.agentSectionEdits.$inferSelect>,
  sectionId: string,
) {
  return edits.find((e) => e.sectionId === sectionId && e.status !== "superseded") ?? null;
}

function latestAccepted(
  edits: Array<typeof schema.agentSectionEdits.$inferSelect>,
  sectionId: string,
) {
  return edits.find((e) => e.sectionId === sectionId && e.status === "accepted") ?? null;
}

function effectiveMarkdown(
  section: PageSection,
  edits: Array<typeof schema.agentSectionEdits.$inferSelect>,
): string {
  return latestAccepted(edits, section.id)?.proposedMarkdown ?? section.markdown;
}

function sectionStatus(
  section: PageSection,
  edits: Array<typeof schema.agentSectionEdits.$inferSelect>,
): SectionEditStatus {
  const latest = latestNonSuperseded(edits, section.id);
  return latest?.status ?? "original";
}

/**
 * Edit-mode tools: list/read page sections from the session snapshot and
 * propose per-section edits awaiting user Accept/Reject.
 */
export function createPageEditTools(args: {
  db: Database;
  git: GitEngine;
  user: AuthedUser;
  sessionId: string;
  snapshot: SectionSplitResult;
}) {
  const { db, sessionId, snapshot } = args;
  const sectionById = new Map(snapshot.sections.map((s) => [s.id, s]));

  const listPageSections = createTool({
    id: "list_page_sections",
    description:
      "List every heading section on the target page (id, heading, level, edit status). Sections are split on all heading depths (h1–h6), so prefer working with deeper headings (h3+) rather than whole h1/h2 chapters. Call this first. If sections is empty, the page has no headings to edit section-by-section.",
    inputSchema: z.object({}),
    execute: async () => {
      if (snapshot.sections.length === 0) {
        return {
          sections: [],
          topLevel: snapshot.topLevel,
          note: "This page has no headings to edit section-by-section. Tell the user and stop — do not invent sections.",
        };
      }
      const edits = await loadLatestEdits(db, sessionId);
      return {
        topLevel: snapshot.topLevel,
        hasPreamble: Boolean(snapshot.preamble?.trim()),
        note: "Prefer reading and editing headingLevel >= 3 when available. Use h1/h2 only when that heading has no deeper children you need, or the task truly spans the whole chapter.",
        sections: snapshot.sections.map((section) => ({
          id: section.id,
          headingText: section.headingText,
          headingLevel: section.headingLevel,
          orderIndex: section.orderIndex,
          status: sectionStatus(section, edits),
        })),
      };
    },
  });

  const readPageSection = createTool({
    id: "read_page_section",
    description:
      "Read the effective markdown for one heading section by id from list_page_sections. Prefer low-level headings (h3–h6) so you load a small focused chunk — do not read large h1/h2 chapters when a deeper section covers the task. Only read sections relevant to the task.",
    inputSchema: z.object({
      sectionId: z.string().describe("Section id from list_page_sections"),
    }),
    execute: async ({ sectionId }) => {
      const section = sectionById.get(sectionId);
      if (!section) {
        return { error: `Unknown section id "${sectionId}". Call list_page_sections first.` };
      }
      const edits = await loadLatestEdits(db, sessionId);
      const deeper = snapshot.sections.filter(
        (s) => s.orderIndex > section.orderIndex && s.headingLevel > section.headingLevel,
      );
      const nextSameOrHigher = snapshot.sections.find(
        (s) => s.orderIndex > section.orderIndex && s.headingLevel <= section.headingLevel,
      );
      const childCount = deeper.filter(
        (s) => !nextSameOrHigher || s.orderIndex < nextSameOrHigher.orderIndex,
      ).length;
      return {
        sectionId: section.id,
        headingText: section.headingText,
        headingLevel: section.headingLevel,
        status: sectionStatus(section, edits),
        markdown: effectiveMarkdown(section, edits),
        ...(section.headingLevel <= 2 && childCount > 0
          ? {
              hint: `This is an h${section.headingLevel} with ${childCount} deeper heading section(s) under it. Prefer read_page_section on those child ids instead of relying on this coarse chunk.`,
            }
          : {}),
      };
    },
  });

  const proposeSectionEdit = createTool({
    id: "propose_section_edit",
    description:
      "Propose a replacement markdown body for one existing heading section (prefer h3+). The user must Accept or Reject before it affects the saved page. Do not re-propose a section that is still awaiting a decision.",
    inputSchema: z.object({
      sectionId: z.string().describe("Section id from list_page_sections"),
      newMarkdown: z
        .string()
        .describe("Full replacement markdown for the section, including its heading"),
    }),
    execute: async ({ sectionId, newMarkdown }) => {
      const section = sectionById.get(sectionId);
      if (!section) {
        return { error: `Unknown section id "${sectionId}". Only existing sections can be edited.` };
      }
      const trimmed = newMarkdown.trim();
      if (!trimmed) return { error: "newMarkdown must not be empty" };

      const edits = await loadLatestEdits(db, sessionId);
      const pending = edits.find((e) => e.sectionId === sectionId && e.status === "proposed");
      if (pending) {
        return {
          error: `Section "${sectionId}" already has a proposal awaiting the user's decision. Wait for Accept/Reject before proposing again.`,
        };
      }

      const baseMarkdown = effectiveMarkdown(section, edits);
      const [baseHtml, proposedHtml] = await Promise.all([
        renderMarkdownToHtml(baseMarkdown),
        renderMarkdownToHtml(trimmed),
      ]);

      await db
        .update(schema.agentSectionEdits)
        .set({ status: "superseded" })
        .where(
          and(
            eq(schema.agentSectionEdits.sessionId, sessionId),
            eq(schema.agentSectionEdits.sectionId, sectionId),
            eq(schema.agentSectionEdits.status, "proposed"),
          ),
        );

      const [row] = await db
        .insert(schema.agentSectionEdits)
        .values({
          sessionId,
          sectionId: section.id,
          headingText: section.headingText,
          headingLevel: section.headingLevel,
          orderIndex: section.orderIndex,
          baseMarkdown,
          proposedMarkdown: trimmed,
          baseHtml,
          proposedHtml,
          status: "proposed",
        })
        .returning();

      await db
        .update(schema.agentSessions)
        .set({ updatedAt: new Date() })
        .where(eq(schema.agentSessions.id, sessionId));

      return {
        status: "awaiting_review" as const,
        sectionId: section.id,
        editId: row!.id,
        headingText: section.headingText,
        baseHtml,
        proposedHtml,
        instruction:
          "Stop and wait for the user to Accept or Reject this section edit before proposing another change to the same section.",
      };
    },
  });

  return {
    ...createResearchTools(args),
    list_page_sections: listPageSections,
    read_page_section: readPageSection,
    propose_section_edit: proposeSectionEdit,
  };
}

/** Fresh per-turn status recap for the edit-mode system prompt. */
export async function buildSectionEditsStatusContext(
  db: Database,
  sessionId: string,
  snapshot: SectionSplitResult,
): Promise<string> {
  if (snapshot.sections.length === 0) {
    return "\n\n## Page section edit status\n\nThis page has no headings — section-by-section editing is not available.";
  }

  const edits = await loadLatestEdits(db, sessionId);
  const lines = snapshot.sections.map((section) => {
    const status = sectionStatus(section, edits);
    return `- ${section.id} ("${section.headingText}"): ${status}`;
  });

  return `\n\n## Page section edit status\n\nCurrent state of each section (do not re-propose a section still marked proposed):\n${lines.join("\n")}`;
}

/** Resolve accepted overrides for assembleDocument. */
export async function loadAcceptedSectionOverrides(
  db: Database,
  sessionId: string,
): Promise<Map<string, string>> {
  const edits = await db.query.agentSectionEdits.findMany({
    where: and(
      eq(schema.agentSectionEdits.sessionId, sessionId),
      eq(schema.agentSectionEdits.status, "accepted"),
    ),
    orderBy: desc(schema.agentSectionEdits.createdAt),
  });

  const overrides = new Map<string, string>();
  for (const edit of edits) {
    if (!overrides.has(edit.sectionId)) {
      overrides.set(edit.sectionId, edit.proposedMarkdown);
    }
  }
  return overrides;
}

/** Snapshot + latest accepted section overrides → full page markdown. */
export async function buildEffectiveDocumentMarkdown(
  db: Database,
  sessionId: string,
  snapshotMarkdown: string,
): Promise<string> {
  const overrides = await loadAcceptedSectionOverrides(db, sessionId);
  return assembleDocument(splitIntoSections(snapshotMarkdown), overrides);
}

/** Build the sections array for GET session (rendered HTML for the viewer). */
export async function buildSessionSectionsView(
  db: Database,
  sessionId: string,
  snapshotMarkdown: string,
): Promise<
  Array<{
    id: string;
    headingText: string;
    headingLevel: number;
    orderIndex: number;
    status: SectionEditStatus;
    html: string;
    editId: string | null;
    baseHtml: string | null;
    proposedHtml: string | null;
  }>
> {
  const snapshot = splitIntoSections(snapshotMarkdown);
  const edits = await loadLatestEdits(db, sessionId);

  return Promise.all(
    snapshot.sections.map(async (section) => {
      const status = sectionStatus(section, edits);
      const accepted = latestAccepted(edits, section.id);
      const pending = edits.find((e) => e.sectionId === section.id && e.status === "proposed");
      const effective = effectiveMarkdown(section, edits);

      // Pending proposals preview the proposed HTML; accepted show the new body;
      // otherwise render the effective (accepted-or-original) markdown.
      let viewerHtml: string;
      if (status === "proposed" && pending) {
        viewerHtml = pending.proposedHtml;
      } else if (status === "accepted" && accepted) {
        viewerHtml = accepted.proposedHtml;
      } else {
        viewerHtml = await renderMarkdownToHtml(effective);
      }

      return {
        id: section.id,
        headingText: section.headingText,
        headingLevel: section.headingLevel,
        orderIndex: section.orderIndex,
        status,
        html: viewerHtml,
        editId: pending?.id ?? (status === "accepted" ? (accepted?.id ?? null) : null),
        baseHtml: pending?.baseHtml ?? accepted?.baseHtml ?? null,
        proposedHtml: pending?.proposedHtml ?? accepted?.proposedHtml ?? null,
      };
    }),
  );
}
