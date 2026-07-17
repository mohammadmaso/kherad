/**
 * In-memory LRU cache for rendered wiki-page HTML, keyed by
 * (version, bundle, path, branch, commitHash) per PRD §6. Fine for the
 * single-instance v1 deployment — no Redis. A `Map` already preserves
 * insertion order, so "touching" an entry (delete + re-insert) is enough to
 * track recency without a dedicated linked-list structure.
 *
 * Bump `RENDER_CACHE_VERSION` whenever the HTML shape changes (e.g. adding the
 * OKF frontmatter panel) so stale entries aren't served after deploy/HMR.
 */
type RenderCacheEntry = { html: string; markdown: string };

class RenderCache {
  private readonly entries = new Map<string, RenderCacheEntry>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): RenderCacheEntry | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: RenderCacheEntry): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
  }
}

/** Increment when wiki render output changes without a new git commit. */
export const RENDER_CACHE_VERSION = 4;

export type RenderCacheKey = {
  bundleId: string;
  path: string;
  branch: string;
  commitOid: string;
};

function toKeyString({ bundleId, path, branch, commitOid }: RenderCacheKey): string {
  return [RENDER_CACHE_VERSION, bundleId, path, branch, commitOid].join("\0");
}

const MAX_CACHE_ENTRIES = 500;

// Next.js dev's hot-reload re-evaluates modules on every edit; stash the
// cache on `globalThis` (like the shared Drizzle client) so it survives that
// and the LRU keeps doing its job instead of silently resetting.
const globalStore = globalThis as unknown as {
  __kheradRenderCache?: RenderCache;
  __kheradRenderCacheVersion?: number;
};

if (globalStore.__kheradRenderCacheVersion !== RENDER_CACHE_VERSION) {
  globalStore.__kheradRenderCache = new RenderCache(MAX_CACHE_ENTRIES);
  globalStore.__kheradRenderCacheVersion = RENDER_CACHE_VERSION;
}

export const renderCache = globalStore.__kheradRenderCache!;

export function getCachedRender(key: RenderCacheKey): RenderCacheEntry | undefined {
  return renderCache.get(toKeyString(key));
}

export function setCachedRender(key: RenderCacheKey, value: RenderCacheEntry): void {
  renderCache.set(toKeyString(key), value);
}
