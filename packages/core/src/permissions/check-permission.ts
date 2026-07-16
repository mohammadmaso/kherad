import type { Database } from "@kherad/db";
import { schema } from "@kherad/db";
import { and, eq } from "drizzle-orm";

import type { AuthedUser } from "../auth";
import type { PermissionAction, PermissionBundle } from "./types";

type PermissionRole = (typeof schema.permissionRoleEnum.enumValues)[number];

const ROLE_RANK: Record<PermissionRole, number> = {
  viewer: 1,
  author: 2,
  manager: 3,
};

const ACTION_MIN_ROLE: Record<Exclude<PermissionAction, "manage">, PermissionRole> = {
  view: "viewer",
  edit: "author",
  review: "manager",
};

function roleSatisfiesAction(role: PermissionRole, action: PermissionAction): boolean {
  if (action === "manage") return false;
  return ROLE_RANK[role] >= ROLE_RANK[ACTION_MIN_ROLE[action]];
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * The single source of truth for "can `user` do `action` on `path` within
 * `bundle`?", per PRD §9 — called from both Fastify (before writes) and
 * Next.js (before renders) in the real app; here it guards every
 * bundle/page/permission endpoint.
 *
 * Precedence, per PRD §1 ("optional per-folder/per-page override that takes
 * precedence when present"): the most specific (longest) matching
 * `pathPrefix` grant wins outright over any bundle-level (NULL prefix) grant
 * — it is not merged with it.
 */
export async function checkPermission(
  db: Database,
  user: AuthedUser | null,
  bundle: PermissionBundle,
  path: string | null,
  action: PermissionAction,
): Promise<boolean> {
  if (user?.isAdmin) return true;
  if (action === "manage") return false;

  if (action === "view" && bundle.isPublic) return true;
  if (!user) return false;

  const grants = await db.query.permissions.findMany({
    where: and(eq(schema.permissions.userId, user.id), eq(schema.permissions.bundleId, bundle.id)),
  });
  if (grants.length === 0) return false;

  const matchingPathGrants = path
    ? grants.filter((g) => g.pathPrefix !== null && pathMatchesPrefix(path, g.pathPrefix))
    : [];

  if (matchingPathGrants.length > 0) {
    const mostSpecific = matchingPathGrants.reduce((best, candidate) =>
      candidate.pathPrefix!.length > best.pathPrefix!.length ? candidate : best,
    );
    return roleSatisfiesAction(mostSpecific.role, action);
  }

  const bundleGrants = grants.filter((g) => g.pathPrefix === null);
  if (bundleGrants.length === 0) return false;

  const mostPermissive = bundleGrants.reduce((best, candidate) =>
    ROLE_RANK[candidate.role] > ROLE_RANK[best.role] ? candidate : best,
  );
  return roleSatisfiesAction(mostPermissive.role, action);
}
