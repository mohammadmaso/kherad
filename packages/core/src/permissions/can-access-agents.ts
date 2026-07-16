import type { Database } from "@kherad/db";
import { schema } from "@kherad/db";
import { and, eq, isNull } from "drizzle-orm";

import type { AuthedUser } from "../auth";

/**
 * Managers (bundle role `manager`) and admins may use the `/agents` hub.
 * Authors and viewers cannot — interviewing produces wiki imports that go
 * through the manager review path.
 */
export async function canAccessAgents(
  db: Database,
  user: AuthedUser | null,
): Promise<boolean> {
  if (!user) return false;
  if (user.isAdmin) return true;

  const grants = await db
    .select({ id: schema.permissions.id })
    .from(schema.permissions)
    .innerJoin(schema.bundles, eq(schema.permissions.bundleId, schema.bundles.id))
    .where(
      and(
        eq(schema.permissions.userId, user.id),
        eq(schema.permissions.role, "manager"),
        isNull(schema.bundles.archivedAt),
      ),
    )
    .limit(1);

  return grants.length > 0;
}
