/**
 * - "view": read page content (viewer role or higher, or a public bundle)
 * - "edit": create/edit pages on one's own branch, submit for review (author role or higher)
 * - "review": review/approve/merge MRs, resolve conflicts (manager role or higher)
 * - "manage": archive the bundle, assign permissions — global admin only, no
 *   per-bundle role ever satisfies this (matches PRD §1: only Admin assigns roles)
 */
export type PermissionAction = "view" | "edit" | "review" | "manage";

export type PermissionBundle = {
  id: string;
  isPublic: boolean;
};
