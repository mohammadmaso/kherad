"use client";

import { useParams } from "next/navigation";

import { IngestWizard } from "@/components/ingest/ingest-wizard";

export default function BundleIngestPage() {
  const { bundleId } = useParams<{ bundleId: string }>();
  return <IngestWizard bundleId={bundleId} />;
}
