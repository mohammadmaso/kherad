/**
 * Conflict-marker parsing/reassembly lives in `@kherad/core/conflict-markers`
 * (pure, browser-safe — the format is produced by the core git engine and its
 * tests live next to it). This module re-exports it for the resolver UI.
 */
export * from "@kherad/core/conflict-markers";
