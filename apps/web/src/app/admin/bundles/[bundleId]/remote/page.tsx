"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kherad/ui/components/ui/dialog";
import { Input } from "@kherad/ui/components/ui/input";
import { Label } from "@kherad/ui/components/ui/label";
import { ArrowLeftIcon } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  disconnectBundleRemote,
  fetchBundle,
  fetchBundleRemote,
  pullBundleRemote,
  pushBundleRemote,
  saveBundleRemote,
  type AdminBundle,
  type BundleRemoteConfig,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

export default function AdminBundleRemotePage() {
  const { bundleId } = useParams<{ bundleId: string }>();
  const router = useRouter();
  const { t } = useI18n();

  const [bundle, setBundle] = useState<AdminBundle | null>(null);
  const [remote, setRemote] = useState<BundleRemoteConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [pullDialogOpen, setPullDialogOpen] = useState(false);

  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [token, setToken] = useState("");

  function formatTimestamp(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString() : t.admin.never;
  }

  const load = useCallback(async () => {
    const [bundleRow, remoteConfig] = await Promise.all([
      fetchBundle(bundleId),
      fetchBundleRemote(bundleId),
    ]);
    setBundle(bundleRow);
    setRemote(remoteConfig);
    setUrl(remoteConfig.url ?? "");
    setBranch(remoteConfig.branch ?? "main");
  }, [bundleId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : t.admin.loadRemoteFailed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, t.admin.loadRemoteFailed]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await saveBundleRemote(bundleId, {
        url: url.trim(),
        branch: branch.trim() || "main",
        token: token.trim() || undefined,
      });
      setRemote(updated);
      setToken("");
      setNotice(t.admin.remoteSaved);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.saveRemoteFailed);
    } finally {
      setSaving(false);
    }
  }

  async function handlePush() {
    setPushing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await pushBundleRemote(bundleId);
      setRemote(result);
      setNotice(
        result.commitCount > 0
          ? t.admin.pushSuccess(result.commitCount, result.branch ?? branch)
          : t.admin.remoteUpToDate,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.pushFailed);
    } finally {
      setPushing(false);
    }
  }

  async function handlePull() {
    setPulling(true);
    setError(null);
    setNotice(null);
    try {
      const result = await pullBundleRemote(bundleId);
      setRemote(result);
      setNotice(
        result.changed
          ? t.admin.pullSuccess(result.pagesUpserted, result.pagesDeleted)
          : t.admin.pullUpToDate,
      );
      setPullDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.pullFailed);
      setPullDialogOpen(false);
    } finally {
      setPulling(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await disconnectBundleRemote(bundleId);
      setRemote(updated);
      setUrl("");
      setBranch("main");
      setToken("");
      setNotice(t.admin.remoteDisconnected);
      setDisconnectDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.disconnectFailed);
    } finally {
      setDisconnecting(false);
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
          {t.admin.bundleRemote}
          {bundle ? ` — ${bundle.title}` : ""}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{t.admin.bundleRemoteDesc}</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertTitle>{notice}</AlertTitle>
        </Alert>
      ) : null}

      {remote === null ? (
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      ) : (
        <>
          <div className="border-border flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={remote.connected ? "success" : "outline"}>
                {remote.connected ? t.admin.connected : t.admin.notConnected}
              </Badge>
              {remote.connected ? (
                <span className="text-muted-foreground text-xs">
                  {t.admin.lastPushed} {formatTimestamp(remote.lastPushedAt)}
                  {remote.lastPushedOid ? ` (${remote.lastPushedOid.slice(0, 7)})` : ""}
                  {" · "}
                  {t.admin.lastPulled} {formatTimestamp(remote.lastPulledAt)}
                  {remote.lastPulledOid ? ` (${remote.lastPulledOid.slice(0, 7)})` : ""}
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="remote-url">{t.admin.remoteUrl}</Label>
              <Input
                id="remote-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/org/wiki.git"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="remote-branch">{t.admin.remoteBranch}</Label>
              <Input
                id="remote-branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                className="w-48"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="remote-token">{t.admin.accessToken}</Label>
              <Input
                id="remote-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={remote.hasToken ? t.admin.leaveBlankToken : t.admin.personalToken}
                autoComplete="off"
              />
              <p className="text-muted-foreground text-xs">{t.admin.tokenOptionalHint}</p>
            </div>

            <div className="flex gap-2">
              <Button size="sm" disabled={saving || !url.trim()} onClick={handleSave}>
                {saving ? t.common.saving : t.common.save}
              </Button>
              {remote.connected ? (
                <Dialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={disconnecting}
                    onClick={() => setDisconnectDialogOpen(true)}
                  >
                    {t.admin.disconnect}
                  </Button>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t.admin.disconnectTitle}</DialogTitle>
                      <DialogDescription>{t.admin.bundleDisconnectBody}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setDisconnectDialogOpen(false)}>
                        {t.common.cancel}
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={disconnecting}
                        onClick={handleDisconnect}
                      >
                        {disconnecting ? t.admin.disconnecting : t.admin.disconnect}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              ) : null}
            </div>
          </div>

          <div className="border-border flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!remote.connected || !remote.hasToken || pushing || pulling}
                onClick={handlePush}
              >
                {pushing ? t.admin.pushing : t.admin.pushNow}
              </Button>
              <span className="text-muted-foreground text-xs">{t.admin.bundlePushHint}</span>
            </div>
            <div className="flex items-center gap-2">
              <Dialog open={pullDialogOpen} onOpenChange={setPullDialogOpen}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!remote.connected || pushing || pulling}
                  onClick={() => setPullDialogOpen(true)}
                >
                  {pulling ? t.admin.pulling : t.admin.pullNow}
                </Button>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t.admin.pullConfirmTitle}</DialogTitle>
                    <DialogDescription>{t.admin.pullConfirmBody}</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setPullDialogOpen(false)}>
                      {t.common.cancel}
                    </Button>
                    <Button variant="destructive" disabled={pulling} onClick={handlePull}>
                      {pulling ? t.admin.pulling : t.admin.pullConfirm}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <span className="text-muted-foreground text-xs">{t.admin.bundlePullHint}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
