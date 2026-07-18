/**
 * Build-time app metadata. Values are injected by `next.config.ts` (and
 * optionally overridden via Docker build args / env). Fallbacks keep the
 * About page usable in plain `next dev` without a git checkout.
 */

export type AppInfo = {
  name: string;
  version: string;
  gitSha: string;
  gitCommitDate: string | null;
  repositoryUrl: string;
  repositoryLabel: string;
  license: string;
  licenseUrl: string;
};

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

const repositoryUrl = env(
  "NEXT_PUBLIC_GIT_REPO_URL",
  "https://github.com/mohammadmaso/kherad",
);

function repositoryLabelFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\//, "").replace(/\.git$/, "") || url;
  } catch {
    return url;
  }
}

const rawCommitDate = env("NEXT_PUBLIC_GIT_COMMIT_DATE", "");

export const APP_INFO: AppInfo = {
  name: "Kherad",
  version: env("NEXT_PUBLIC_APP_VERSION", "0.1.0"),
  gitSha: env("NEXT_PUBLIC_GIT_SHA", "dev"),
  gitCommitDate: rawCommitDate.length > 0 ? rawCommitDate : null,
  repositoryUrl,
  repositoryLabel: repositoryLabelFromUrl(repositoryUrl),
  license: "Apache-2.0",
  licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
};

/** Stack labels shown on the About page — keep short and recognizable. */
export const APP_STACK = [
  "Next.js",
  "Fastify",
  "isomorphic-git",
  "Postgres",
  "Lexical",
  "Turborepo",
] as const;
