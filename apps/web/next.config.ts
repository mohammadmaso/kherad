import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const rootDir = dirname(fileURLToPath(import.meta.url));

function git(command: string): string {
  try {
    return execSync(command, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** First non-empty candidate wins. */
function pick(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    if (candidate && candidate.length > 0) return candidate;
  }
  return "";
}

const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as {
  version?: string;
};

const nextConfig: NextConfig = {
  transpilePackages: ["@kherad/core", "@kherad/ui"],
  env: {
    NEXT_PUBLIC_APP_VERSION: pick(
      process.env.NEXT_PUBLIC_APP_VERSION,
      process.env.APP_VERSION,
      packageJson.version,
      "0.1.0",
    ),
    NEXT_PUBLIC_GIT_SHA: pick(
      process.env.NEXT_PUBLIC_GIT_SHA,
      process.env.GIT_SHA,
      git("git rev-parse --short HEAD"),
      "dev",
    ),
    NEXT_PUBLIC_GIT_COMMIT_DATE: pick(
      process.env.NEXT_PUBLIC_GIT_COMMIT_DATE,
      process.env.GIT_COMMIT_DATE,
      git("git log -1 --format=%cI"),
    ),
    NEXT_PUBLIC_GIT_REPO_URL: pick(
      process.env.NEXT_PUBLIC_GIT_REPO_URL,
      process.env.GIT_REPO_URL,
      "https://github.com/mohammadmaso/kherad",
    ),
  },
};

export default nextConfig;
