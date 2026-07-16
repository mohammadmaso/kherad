/**
 * Well-known identity of the machine account that authors OKF compile merge
 * requests. Seeded by `pnpm db:seed` and lazily re-created by apps/api on
 * first indexer run (for deployments that never re-ran the seed). The row has
 * `isSystem: true`, which blocks login regardless of password.
 */
export const SYSTEM_INDEXER_EMAIL = "indexer@kherad.system";
export const SYSTEM_INDEXER_DISPLAY_NAME = "Kherad Indexer";
