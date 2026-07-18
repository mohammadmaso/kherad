"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";

import { AgentSessionWorkspace } from "@/components/agents/agent-session-workspace";

export default function AgentSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <Suspense fallback={null}>
      <AgentSessionWorkspace sessionId={sessionId} />
    </Suspense>
  );
}
