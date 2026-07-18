import { redirect } from "next/navigation";

/** Legacy path used briefly by Edit-with-agent; sessions live at /agents/:id. */
export default async function AgentSessionAliasPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  redirect(`/agents/${sessionId}`);
}
