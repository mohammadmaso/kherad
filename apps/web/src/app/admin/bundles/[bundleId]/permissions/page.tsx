"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { Input } from "@kherad/ui/components/ui/input";
import { Select } from "@kherad/ui/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@kherad/ui/components/ui/table";
import { ArrowLeftIcon } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createPermission,
  deletePermission,
  fetchBundles,
  fetchPermissions,
  fetchUsers,
  type AdminBundle,
  type AdminUser,
  type PermissionGrant,
  type PermissionRole,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

const ROLES: PermissionRole[] = ["manager", "author", "viewer"];

export default function AdminPermissionsPage() {
  const { bundleId } = useParams<{ bundleId: string }>();
  const router = useRouter();
  const { t } = useI18n();

  const roleLabel: Record<PermissionRole, string> = {
    manager: t.dashboard.role.manager,
    author: t.dashboard.role.author,
    viewer: t.dashboard.role.viewer,
  };

  const [bundle, setBundle] = useState<AdminBundle | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [grants, setGrants] = useState<PermissionGrant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<PermissionRole>("viewer");
  const [pathPrefix, setPathPrefix] = useState("");

  const load = useCallback(async () => {
    const [bundleRows, userRows, grantRows] = await Promise.all([
      fetchBundles(),
      fetchUsers(),
      fetchPermissions(bundleId),
    ]);
    setBundle(bundleRows.find((b) => b.id === bundleId) ?? null);
    setUsers(userRows);
    setGrants(grantRows);
  }, [bundleId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : t.admin.loadPermissionsFailed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, t.admin.loadPermissionsFailed]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const effectiveUserId = userId || users[0]?.id || "";

  async function handleCreate() {
    if (!effectiveUserId) return;
    setSubmitting(true);
    setError(null);
    try {
      await createPermission(bundleId, {
        userId: effectiveUserId,
        role,
        pathPrefix: pathPrefix.trim() || null,
      });
      setPathPrefix("");
      const grantRows = await fetchPermissions(bundleId);
      setGrants(grantRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.addGrantFailed);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(permissionId: string) {
    setError(null);
    try {
      await deletePermission(bundleId, permissionId);
      setGrants((prev) => prev?.filter((g) => g.id !== permissionId) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.removeGrantFailed);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button
          type="button"
          onClick={() => router.push("/admin/bundles")}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeftIcon className="size-3.5 rtl:rotate-180" />
          {t.admin.backBundles}
        </button>
        <h2 className="mt-1 text-lg font-semibold">
          {t.admin.permissions}
          {bundle ? ` — ${bundle.title}` : ""}
        </h2>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="border-border flex flex-wrap items-end gap-2 rounded-lg border p-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">{t.admin.user}</span>
          <Select value={effectiveUserId} onChange={(e) => setUserId(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} ({u.email})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">{t.common.role}</span>
          <Select value={role} onChange={(e) => setRole(e.target.value as PermissionRole)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel[r]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">{t.admin.pathPrefix}</span>
          <Input
            value={pathPrefix}
            onChange={(e) => setPathPrefix(e.target.value)}
            placeholder="team/onboarding"
            className="w-48"
          />
        </div>
        <Button size="sm" disabled={submitting || !effectiveUserId} onClick={handleCreate}>
          {t.admin.addGrant}
        </Button>
      </div>

      {grants === null ? (
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      ) : grants.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.admin.noGrants}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.admin.user}</TableHead>
              <TableHead>{t.common.role}</TableHead>
              <TableHead>{t.admin.scope}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {grants.map((grant) => (
              <TableRow key={grant.id}>
                <TableCell>
                  {grant.user?.displayName ??
                    usersById.get(grant.userId)?.displayName ??
                    grant.userId}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{roleLabel[grant.role]}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">
                  {grant.pathPrefix ?? t.admin.wholeBundle}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button variant="destructive" size="xs" onClick={() => handleDelete(grant.id)}>
                      {t.common.remove}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
