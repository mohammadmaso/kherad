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
import { Select } from "@kherad/ui/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@kherad/ui/components/ui/table";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import {
  createMcpServer,
  deleteMcpServer,
  fetchAdminMcpServers,
  resetMcpOauthClient,
  startAdminMcpOauth,
  testMcpServer,
  updateMcpServer,
  type McpAuthType,
  type McpServerAdmin,
  type McpTransport,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

type HeaderRow = { name: string; value: string };

type EditorState = {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  url: string;
  transport: McpTransport;
  authType: McpAuthType;
  enabled: boolean;
  headers: HeaderRow[];
  clearHeaders: boolean;
  savedHeaderNames: string[];
  oauthUseDcr: boolean;
  oauthClientId: string;
  oauthClientSecret: string;
  clearClientSecret: boolean;
  hasClientSecret: boolean;
  oauthScopes: string;
};

const EMPTY_EDITOR: EditorState = {
  id: null,
  name: "",
  slug: "",
  description: "",
  url: "",
  transport: "auto",
  authType: "none",
  enabled: true,
  headers: [{ name: "", value: "" }],
  clearHeaders: false,
  savedHeaderNames: [],
  oauthUseDcr: true,
  oauthClientId: "",
  oauthClientSecret: "",
  clearClientSecret: false,
  hasClientSecret: false,
  oauthScopes: "",
};

function statusVariant(
  status: McpServerAdmin["status"],
): "secondary" | "success" | "warning" | "outline" {
  switch (status) {
    case "ok":
      return "success";
    case "error":
      return "warning";
    case "needs_auth":
      return "outline";
    default:
      return "secondary";
  }
}

function AdminMcpPageInner() {
  const { t } = useI18n();
  const a = t.adminMcp;
  const router = useRouter();
  const searchParams = useSearchParams();

  const [servers, setServers] = useState<McpServerAdmin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const connectedId = searchParams.get("connected");
  const oauthError = searchParams.get("oauthError");
  const banner = connectedId ? a.connectedBanner : null;
  const oauthBannerError = oauthError ? a.oauthErrorBanner : null;
  const displayError = error ?? oauthBannerError;
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    id: string;
    ok: boolean;
    tools?: string[];
    error?: string;
    needsAuth?: boolean;
  } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function reload() {
    const rows = await fetchAdminMcpServers();
    setServers(rows);
    setLoaded(true);
  }

  useEffect(() => {
    void (async () => {
      try {
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : a.loadFailed);
        setLoaded(true);
      }
    })();
  }, [a.loadFailed]);

  useEffect(() => {
    if (!connectedId && !oauthError) return;
    // Defer so we don't setState synchronously inside the effect body.
    const reloadTimer = window.setTimeout(() => {
      if (connectedId) void reload().catch(() => undefined);
    }, 0);
    const clearTimer = window.setTimeout(() => {
      router.replace("/admin/mcp");
    }, 2500);
    return () => {
      window.clearTimeout(reloadTimer);
      window.clearTimeout(clearTimer);
    };
  }, [connectedId, oauthError, router]);

  function openCreate() {
    setEditor(EMPTY_EDITOR);
    setDialogOpen(true);
  }

  function openEdit(row: McpServerAdmin) {
    setEditor({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description ?? "",
      url: row.url,
      transport: row.transport,
      authType: row.authType,
      enabled: row.enabled,
      headers: [{ name: "", value: "" }],
      clearHeaders: false,
      savedHeaderNames: row.headerNames,
      oauthUseDcr: row.oauthUseDcr,
      oauthClientId: row.oauthClientId ?? "",
      oauthClientSecret: "",
      clearClientSecret: false,
      hasClientSecret: row.hasClientSecret,
      oauthScopes: row.oauthScopes ?? "",
    });
    setDialogOpen(true);
  }

  function statusLabel(status: McpServerAdmin["status"]): string {
    switch (status) {
      case "ok":
        return a.statusOk;
      case "error":
        return a.statusError;
      case "needs_auth":
        return a.statusNeedsAuth;
      default:
        return a.statusUnknown;
    }
  }

  function authLabel(authType: McpAuthType): string {
    switch (authType) {
      case "headers":
        return a.authHeaders;
      case "oauth2_auth_code":
        return a.authOauthCode;
      case "oauth2_client_credentials":
        return a.authOauthClient;
      default:
        return a.authNone;
    }
  }

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      for (const row of editor.headers) {
        const name = row.name.trim();
        const value = row.value.trim();
        if (name && value) headers[name] = value;
      }

      const base = {
        name: editor.name.trim(),
        slug: editor.slug.trim() || undefined,
        description: editor.description.trim() || null,
        url: editor.url.trim(),
        transport: editor.transport,
        authType: editor.authType,
        enabled: editor.enabled,
        oauthUseDcr: editor.oauthUseDcr,
        oauthClientId: editor.oauthClientId.trim() || null,
        oauthScopes: editor.oauthScopes.trim() || null,
      };

      if (editor.id) {
        await updateMcpServer(editor.id, {
          ...base,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
          ...(editor.clearHeaders ? { clearHeaders: true } : {}),
          ...(editor.oauthClientSecret.trim()
            ? { oauthClientSecret: editor.oauthClientSecret.trim() }
            : {}),
          ...(editor.clearClientSecret ? { clearClientSecret: true } : {}),
        });
      } else {
        await createMcpServer({
          ...base,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
          ...(editor.oauthClientSecret.trim()
            ? { oauthClientSecret: editor.oauthClientSecret.trim() }
            : {}),
        });
      }
      setDialogOpen(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveFailed);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    setTestResult(null);
    setError(null);
    try {
      const result = await testMcpServer(id);
      setTestResult({ id, ...result });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : a.testFailedGeneric);
    } finally {
      setTestingId(null);
    }
  }

  async function handleConnect(id: string) {
    setError(null);
    try {
      const result = await startAdminMcpOauth(id);
      if (result.alreadyAuthorized || !result.authorizationUrl) {
        router.replace(`/admin/mcp?connected=${id}`);
        await reload();
        return;
      }
      window.location.assign(result.authorizationUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : a.connectFailed);
    }
  }

  async function handleResetOauthClient(id: string) {
    setError(null);
    try {
      await resetMcpOauthClient(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : a.resetOauthFailed);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    setError(null);
    try {
      await deleteMcpServer(deleteId);
      setDeleteId(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : a.deleteFailed);
    }
  }

  if (!loaded) {
    return <p className="text-muted-foreground text-sm">{t.common.loading}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{a.title}</h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{a.subtitle}</p>
          <p className="text-muted-foreground mt-1 max-w-2xl text-xs">{a.perUserHint}</p>
        </div>
        <Button onClick={openCreate} className="shrink-0">
          <PlusIcon className="size-4" />
          {a.newServer}
        </Button>
      </div>

      {banner ? (
        <Alert>
          <AlertTitle>{t.common.saved}</AlertTitle>
          <AlertDescription>{banner}</AlertDescription>
        </Alert>
      ) : null}

      {displayError ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{displayError}</AlertDescription>
        </Alert>
      ) : null}

      {testResult ? (
        <Alert variant={testResult.ok ? "default" : "destructive"}>
          <AlertTitle>{testResult.ok ? a.testOk : a.testFailed}</AlertTitle>
          <AlertDescription>
            {testResult.ok
              ? (testResult.tools ?? []).join(", ") || a.toolsCount(0)
              : testResult.needsAuth
                ? a.needsAuthPrompt
                : (testResult.error ?? a.testFailedGeneric)}
          </AlertDescription>
        </Alert>
      ) : null}

      {servers.length === 0 ? (
        <p className="text-muted-foreground text-sm">{a.noServers}</p>
      ) : (
        <div className="border-border overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{a.nameLabel}</TableHead>
                <TableHead>{a.urlLabel}</TableHead>
                <TableHead>{a.transportLabel}</TableHead>
                <TableHead>{a.authLabel}</TableHead>
                <TableHead>{t.common.status}</TableHead>
                <TableHead>{a.toolsCount(0).replace(/\d+/, "").trim() || "Tools"}</TableHead>
                <TableHead>{a.enabledLabel}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {servers.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="max-w-[12rem] truncate font-mono text-xs" dir="ltr">
                    {row.url}
                  </TableCell>
                  <TableCell className="text-xs">{row.transport}</TableCell>
                  <TableCell className="text-xs">{authLabel(row.authType)}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{a.toolsCount(row.toolNames.length)}</TableCell>
                  <TableCell>
                    <Badge variant={row.enabled ? "success" : "secondary"}>
                      {row.enabled ? a.enabledLabel : "—"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => openEdit(row)}>
                        {t.common.edit}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={testingId === row.id}
                        onClick={() => void handleTest(row.id)}
                      >
                        {testingId === row.id ? a.testing : a.test}
                      </Button>
                      {row.authType === "oauth2_auth_code" ? (
                        <>
                          <Button variant="outline" size="sm" onClick={() => void handleConnect(row.id)}>
                            {a.connect}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title={a.resetOauthClientHint}
                            onClick={() => void handleResetOauthClient(row.id)}
                          >
                            {a.resetOauthClient}
                          </Button>
                        </>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteId(row.id)}
                        aria-label={t.common.remove}
                      >
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    </div>
                    {row.authType === "oauth2_auth_code" && row.oauthRedirectUri ? (
                      <p className="text-muted-foreground mt-1 max-w-xs truncate font-mono text-[11px]" title={row.oauthRedirectUri} dir="ltr">
                        {row.oauthRedirectUri}
                      </p>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editor.id ? a.editServer : a.newServer}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-1">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-name">{a.nameLabel}</Label>
              <Input
                id="mcp-name"
                value={editor.name}
                onChange={(e) => setEditor((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-slug">{a.slugLabel}</Label>
              <Input
                id="mcp-slug"
                value={editor.slug}
                onChange={(e) => setEditor((p) => ({ ...p, slug: e.target.value }))}
                dir="ltr"
              />
              <p className="text-muted-foreground text-xs">{a.slugHint}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-desc">{a.descriptionLabel}</Label>
              <Input
                id="mcp-desc"
                value={editor.description}
                onChange={(e) => setEditor((p) => ({ ...p, description: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-url">{a.urlLabel}</Label>
              <Input
                id="mcp-url"
                value={editor.url}
                onChange={(e) => setEditor((p) => ({ ...p, url: e.target.value }))}
                placeholder={a.urlPlaceholder}
                dir="ltr"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-transport">{a.transportLabel}</Label>
                <Select
                  id="mcp-transport"
                  value={editor.transport}
                  onChange={(e) =>
                    setEditor((p) => ({ ...p, transport: e.target.value as McpTransport }))
                  }
                >
                  <option value="auto">{a.transportAuto}</option>
                  <option value="http">{a.transportHttp}</option>
                  <option value="sse">{a.transportSse}</option>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-auth">{a.authLabel}</Label>
                <Select
                  id="mcp-auth"
                  value={editor.authType}
                  onChange={(e) =>
                    setEditor((p) => ({ ...p, authType: e.target.value as McpAuthType }))
                  }
                >
                  <option value="none">{a.authNone}</option>
                  <option value="headers">{a.authHeaders}</option>
                  <option value="oauth2_auth_code">{a.authOauthCode}</option>
                  <option value="oauth2_client_credentials">{a.authOauthClient}</option>
                </Select>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={editor.enabled}
                onCheckedChange={(v) => setEditor((p) => ({ ...p, enabled: !!v }))}
              />
              {a.enabledLabel}
            </label>

            {editor.authType === "headers" ? (
              <div className="flex flex-col gap-2">
                <Label>{a.headersLabel}</Label>
                {editor.savedHeaderNames.length > 0 && !editor.clearHeaders ? (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-muted-foreground text-xs">{a.savedHeaders}:</span>
                    {editor.savedHeaderNames.map((name) => (
                      <Badge key={name} variant="secondary">
                        {name} · {a.valueSaved}
                      </Badge>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditor((p) => ({ ...p, clearHeaders: true }))}
                    >
                      {a.clearHeaders}
                    </Button>
                  </div>
                ) : null}
                {editor.headers.map((row, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input
                      placeholder={a.headerName}
                      value={row.name}
                      onChange={(e) =>
                        setEditor((p) => {
                          const headers = [...p.headers];
                          headers[idx] = { ...headers[idx]!, name: e.target.value };
                          return { ...p, headers };
                        })
                      }
                      dir="ltr"
                    />
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder={a.headerValue}
                      value={row.value}
                      onChange={(e) =>
                        setEditor((p) => {
                          const headers = [...p.headers];
                          headers[idx] = { ...headers[idx]!, value: e.target.value };
                          return { ...p, headers };
                        })
                      }
                      dir="ltr"
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() =>
                    setEditor((p) => ({
                      ...p,
                      headers: [...p.headers, { name: "", value: "" }],
                    }))
                  }
                >
                  {a.addHeader}
                </Button>
              </div>
            ) : null}

            {editor.authType === "oauth2_auth_code" ||
            editor.authType === "oauth2_client_credentials" ? (
              <div className="flex flex-col gap-3">
                {editor.authType === "oauth2_auth_code" ? (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={editor.oauthUseDcr}
                      onCheckedChange={(v) => setEditor((p) => ({ ...p, oauthUseDcr: !!v }))}
                    />
                    {a.oauthUseDcr}
                  </label>
                ) : null}
                {(editor.authType === "oauth2_client_credentials" || !editor.oauthUseDcr) && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="mcp-client-id">{a.oauthClientId}</Label>
                      <Input
                        id="mcp-client-id"
                        value={editor.oauthClientId}
                        onChange={(e) =>
                          setEditor((p) => ({ ...p, oauthClientId: e.target.value }))
                        }
                        dir="ltr"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="mcp-client-secret" className="flex items-center gap-2">
                        {a.oauthClientSecret}
                        {editor.hasClientSecret && !editor.clearClientSecret ? (
                          <Badge variant="success">{a.secretSaved}</Badge>
                        ) : null}
                      </Label>
                      <Input
                        id="mcp-client-secret"
                        type="password"
                        autoComplete="off"
                        value={editor.oauthClientSecret}
                        onChange={(e) =>
                          setEditor((p) => ({ ...p, oauthClientSecret: e.target.value }))
                        }
                        placeholder={
                          editor.hasClientSecret ? a.leaveBlankSecret : undefined
                        }
                        dir="ltr"
                      />
                      {editor.hasClientSecret ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-fit"
                          onClick={() =>
                            setEditor((p) => ({ ...p, clearClientSecret: true, hasClientSecret: false }))
                          }
                        >
                          {a.clearSecret}
                        </Button>
                      ) : null}
                    </div>
                  </>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mcp-scopes">{a.oauthScopes}</Label>
                  <Input
                    id="mcp-scopes"
                    value={editor.oauthScopes}
                    onChange={(e) => setEditor((p) => ({ ...p, oauthScopes: e.target.value }))}
                    dir="ltr"
                  />
                </div>
                {editor.id && editor.authType === "oauth2_auth_code"
                  ? (() => {
                      const redirect = servers.find((s) => s.id === editor.id)?.oauthRedirectUri;
                      if (!redirect) return null;
                      return (
                        <div className="flex flex-col gap-1.5">
                          <Label>{a.oauthRedirectUri}</Label>
                          <code className="bg-muted rounded-md px-2 py-1.5 text-xs break-all" dir="ltr">
                            {redirect}
                          </code>
                          <p className="text-muted-foreground text-xs">{a.oauthRedirectHint}</p>
                        </div>
                      );
                    })()
                  : null}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={() => void handleSave()} disabled={submitting}>
              {submitting ? t.common.saving : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.common.remove}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">{a.deleteConfirm}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              {t.common.cancel}
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>
              {t.common.remove}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminMcpPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">…</p>}>
      <AdminMcpPageInner />
    </Suspense>
  );
}
