import { schema, type Database } from "@kherad/db";
import { eq } from "drizzle-orm";

export type SessionSkill = { name: string; content: string };

/** Skills attached to a session (via agent_session_skills), for prompt building. */
export async function loadSessionSkills(db: Database, sessionId: string): Promise<SessionSkill[]> {
  const rows = await db.query.agentSessionSkills.findMany({
    where: eq(schema.agentSessionSkills.sessionId, sessionId),
    with: { skill: { columns: { name: true, content: true } } },
  });
  return rows
    .map((row) => row.skill)
    .filter((skill): skill is { name: string; content: string } => skill !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
