import { randomUUID } from "node:crypto";

export type IngestPageImage = {
  page: number;
  mime: string;
  base64: string;
};

export type IngestJob = {
  id: string;
  bundleId: string;
  userId: string;
  markdown: string;
  pageImages: IngestPageImage[];
  titleHint: string;
  format: string;
  filename: string;
  createdAt: number;
};

const TTL_MS = 60 * 60 * 1000;
const jobs = new Map<string, IngestJob>();

function purgeExpired() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > TTL_MS) jobs.delete(id);
  }
}

export function createIngestJob(
  input: Omit<IngestJob, "id" | "createdAt">,
): IngestJob {
  purgeExpired();
  const job: IngestJob = {
    ...input,
    id: randomUUID(),
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getIngestJob(id: string): IngestJob | null {
  purgeExpired();
  return jobs.get(id) ?? null;
}

export function updateIngestJobMarkdown(id: string, markdown: string): IngestJob | null {
  const job = getIngestJob(id);
  if (!job) return null;
  job.markdown = markdown;
  return job;
}
