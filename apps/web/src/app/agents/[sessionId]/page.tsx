"use client";

import { useParams } from "next/navigation";

import { AgentSessionWorkspace } from "@/components/agents/agent-session-workspace";

export default function AgentSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <AgentSessionWorkspace sessionId={sessionId} />;
}
