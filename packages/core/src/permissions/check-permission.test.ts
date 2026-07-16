import { createDb, schema, type Database } from "@kherad/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { isUserLocale, type AuthedUser } from "../auth";
import { checkPermission } from "./check-permission";

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

function toAuthedUser(user: typeof schema.users.$inferSelect): AuthedUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    locale: isUserLocale(user.locale) ? user.locale : "en",
  };
}

describe("checkPermission", () => {
  let db: Database;
  let privateBundle: typeof schema.bundles.$inferSelect;
  let publicBundle: typeof schema.bundles.$inferSelect;
  let grantedUser: AuthedUser;
  let ungrantedUser: AuthedUser;
  let adminUser: AuthedUser;

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    db = createDb(connectionString);

    const suffix = randomSuffix();

    const [privateBundleRow] = await db
      .insert(schema.bundles)
      .values({ slug: `test-private-${suffix}`, title: "Private", isPublic: false })
      .returning();
    const [publicBundleRow] = await db
      .insert(schema.bundles)
      .values({ slug: `test-public-${suffix}`, title: "Public", isPublic: true })
      .returning();
    privateBundle = privateBundleRow!;
    publicBundle = publicBundleRow!;

    const [grantedRow] = await db
      .insert(schema.users)
      .values({
        email: `granted-${suffix}@test.local`,
        passwordHash: "x",
        displayName: "Granted",
        isAdmin: false,
      })
      .returning();
    const [ungrantedRow] = await db
      .insert(schema.users)
      .values({
        email: `ungranted-${suffix}@test.local`,
        passwordHash: "x",
        displayName: "Ungranted",
        isAdmin: false,
      })
      .returning();
    const [adminRow] = await db
      .insert(schema.users)
      .values({
        email: `admin-${suffix}@test.local`,
        passwordHash: "x",
        displayName: "Admin",
        isAdmin: true,
      })
      .returning();

    grantedUser = toAuthedUser(grantedRow!);
    ungrantedUser = toAuthedUser(ungrantedRow!);
    adminUser = toAuthedUser(adminRow!);
  });

  afterEach(async () => {
    await db.delete(schema.permissions).where(eq(schema.permissions.bundleId, privateBundle.id));
  });

  afterAll(async () => {
    await db.delete(schema.bundles).where(eq(schema.bundles.id, privateBundle.id));
    await db.delete(schema.bundles).where(eq(schema.bundles.id, publicBundle.id));
    await db.delete(schema.users).where(eq(schema.users.id, grantedUser.id));
    await db.delete(schema.users).where(eq(schema.users.id, ungrantedUser.id));
    await db.delete(schema.users).where(eq(schema.users.id, adminUser.id));
  });

  it("denies a user with no grant on a private bundle", async () => {
    expect(await checkPermission(db, ungrantedUser, privateBundle, "page.md", "view")).toBe(false);
    expect(await checkPermission(db, null, privateBundle, "page.md", "view")).toBe(false);
  });

  it("allows anonymous/no-grant view access on a public bundle, but nothing more", async () => {
    expect(await checkPermission(db, null, publicBundle, "page.md", "view")).toBe(true);
    expect(await checkPermission(db, ungrantedUser, publicBundle, "page.md", "edit")).toBe(false);
  });

  it("honors a bundle-level (NULL path prefix) grant", async () => {
    await db
      .insert(schema.permissions)
      .values({
        userId: grantedUser.id,
        bundleId: privateBundle.id,
        pathPrefix: null,
        role: "author",
      });

    expect(await checkPermission(db, grantedUser, privateBundle, "any/page.md", "view")).toBe(true);
    expect(await checkPermission(db, grantedUser, privateBundle, "any/page.md", "edit")).toBe(true);
    expect(await checkPermission(db, grantedUser, privateBundle, "any/page.md", "review")).toBe(
      false,
    );
  });

  it("a path-prefix grant takes precedence over a bundle-level grant for matching paths", async () => {
    await db.insert(schema.permissions).values([
      { userId: grantedUser.id, bundleId: privateBundle.id, pathPrefix: null, role: "viewer" },
      { userId: grantedUser.id, bundleId: privateBundle.id, pathPrefix: "team", role: "manager" },
    ]);

    // Under the "team" prefix, the more specific "manager" grant wins outright.
    expect(await checkPermission(db, grantedUser, privateBundle, "team/page.md", "review")).toBe(
      true,
    );

    // Outside that prefix, only the bundle-level "viewer" grant applies.
    expect(await checkPermission(db, grantedUser, privateBundle, "other/page.md", "review")).toBe(
      false,
    );
    expect(await checkPermission(db, grantedUser, privateBundle, "other/page.md", "view")).toBe(
      true,
    );
  });

  it("denies a per-bundle role for the admin-only 'manage' action, but admins bypass everything", async () => {
    await db
      .insert(schema.permissions)
      .values({
        userId: grantedUser.id,
        bundleId: privateBundle.id,
        pathPrefix: null,
        role: "manager",
      });

    expect(await checkPermission(db, grantedUser, privateBundle, null, "manage")).toBe(false);
    expect(await checkPermission(db, adminUser, privateBundle, null, "manage")).toBe(true);
    expect(await checkPermission(db, adminUser, privateBundle, "anything", "edit")).toBe(true);
  });
});
