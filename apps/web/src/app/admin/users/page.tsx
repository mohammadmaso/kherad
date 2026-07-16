"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { Checkbox } from "@kherad/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kherad/ui/components/ui/dialog";
import { Input } from "@kherad/ui/components/ui/input";
import { Label } from "@kherad/ui/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@kherad/ui/components/ui/table";
import { useCallback, useEffect, useState } from "react";

import { createUser, fetchUsers, updateUser, type AdminUser } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function AdminUsersPage() {
  const { t } = useI18n();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editIsAdmin, setEditIsAdmin] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const load = useCallback(() => {
    return fetchUsers().then(setUsers);
  }, []);

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : t.admin.loadUsersFailed),
    );
  }, [load, t.admin.loadUsersFailed]);

  function resetForm() {
    setEmail("");
    setPassword("");
    setDisplayName("");
    setIsAdmin(false);
  }

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    try {
      await createUser({ email, password, displayName, isAdmin });
      setDialogOpen(false);
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.createUserFailed);
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(user: AdminUser) {
    setEditingUser(user);
    setEditEmail(user.email);
    setEditDisplayName(user.displayName);
    setEditIsAdmin(user.isAdmin);
  }

  async function handleEditSave() {
    if (!editingUser) return;
    setEditSubmitting(true);
    setError(null);
    try {
      await updateUser(editingUser.id, {
        email: editEmail,
        displayName: editDisplayName,
        isAdmin: editIsAdmin,
      });
      setEditingUser(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.updateUserFailed);
    } finally {
      setEditSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t.admin.users}</h2>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            {t.admin.newUser}
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t.admin.createUser}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">{t.common.email}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alice@company.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="displayName">{t.admin.displayName}</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Alice"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">{t.admin.temporaryPassword}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Label htmlFor="isAdmin">
                <Checkbox
                  id="isAdmin"
                  checked={isAdmin}
                  onCheckedChange={(checked) => setIsAdmin(checked === true)}
                />
                {t.admin.adminCheckbox}
              </Label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button
                disabled={submitting || !email || !password || !displayName}
                onClick={handleCreate}
              >
                {t.common.create}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {users === null ? (
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      ) : users.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.admin.noUsers}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.common.email}</TableHead>
              <TableHead>{t.common.name}</TableHead>
              <TableHead>{t.common.role}</TableHead>
              <TableHead>{t.common.created}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.displayName}</TableCell>
                <TableCell>
                  {user.isAdmin ? (
                    <Badge>{t.admin.roleAdmin}</Badge>
                  ) : (
                    <Badge variant="outline">{t.admin.roleUser}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatTimestamp(user.createdAt)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button variant="ghost" size="xs" onClick={() => openEdit(user)}>
                      {t.common.edit}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={editingUser !== null} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.admin.editUser}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-email">{t.common.email}</Label>
              <Input
                id="edit-email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-displayName">{t.admin.displayName}</Label>
              <Input
                id="edit-displayName"
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
              />
            </div>
            <Label htmlFor="edit-isAdmin">
              <Checkbox
                id="edit-isAdmin"
                checked={editIsAdmin}
                onCheckedChange={(checked) => setEditIsAdmin(checked === true)}
              />
              {t.admin.adminCheckbox}
            </Label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>
              {t.common.cancel}
            </Button>
            <Button
              disabled={editSubmitting || !editEmail.trim() || !editDisplayName.trim()}
              onClick={handleEditSave}
            >
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
