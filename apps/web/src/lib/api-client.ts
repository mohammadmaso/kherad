export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const TOKEN_STORAGE_KEY = "kherad.token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

/**
 * Stores the bearer token for client-side API calls, and mirrors it into the
 * httpOnly session cookie (`/api/session`) so Server Components — which
 * never see localStorage — can identify the viewer too (SSR wiki rendering,
 * branch preview gating). Also required for `<img src="/api/assets/...">`,
 * which can send cookies but not the Bearer header.
 */
export async function setToken(token: string): Promise<void> {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

export async function clearToken(): Promise<void> {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  await fetch("/api/session", { method: "DELETE" });
}

/** Returns true only when a stored token still resolves to a live session. */
export async function hasValidSession(): Promise<boolean> {
  if (!getToken()) return false;
  try {
    await fetchCurrentUser();
    return true;
  } catch {
    await clearToken();
    return false;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request to ${url} failed with ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type AuthedUser = {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  locale: "en" | "fa";
};

export function login(
  email: string,
  password: string,
): Promise<{ user: AuthedUser; token: string }> {
  return request(`${API_URL}/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function logout(): Promise<void> {
  return request(`${API_URL}/auth/logout`, { method: "POST" });
}

export function fetchCurrentUser(): Promise<AuthedUser> {
  return request(`${API_URL}/auth/me`);
}

/** Persists per-user UI preferences (language) on the caller's own account. */
export function updateMyPreferences(input: { locale: "en" | "fa" }): Promise<AuthedUser> {
  return request(`${API_URL}/auth/me/preferences`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export type PageContent = {
  id: string;
  bundleId: string;
  path: string;
  title: string;
  branch: string;
  content: string;
  lastCommitAt: string | null;
};

export function fetchPageContent(bundleId: string, pageId: string): Promise<PageContent> {
  return request(`${API_URL}/bundles/${bundleId}/pages/${pageId}`);
}

export function savePageContent(
  bundleId: string,
  pageId: string,
  content: string,
): Promise<{ commitOid: string; branch: string; updatedAt: string }> {
  return request(`${API_URL}/bundles/${bundleId}/pages/${pageId}/content`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

export type PageSummary = {
  id: string;
  bundleId: string;
  path: string;
  title: string;
  isDeleted: boolean;
  redirectTo: string | null;
};

export function fetchBundlePages(bundleId: string): Promise<PageSummary[]> {
  return request(`${API_URL}/bundles/${bundleId}/pages`);
}

export type OkfDocSummary = { path: string; title: string; readonly: boolean };

/** Folder-tree listing of a `llm_compiled` bundle's compiled OKF docs. */
export function fetchOkfDocs(bundleId: string): Promise<OkfDocSummary[]> {
  return request(`${API_URL}/bundles/${bundleId}/okf-docs`);
}

export type OkfDocContent = {
  path: string;
  content: string;
  branch: string;
  canEdit: boolean;
  lastCommitAt: string | null;
};

export function fetchOkfDocContent(bundleId: string, path: string): Promise<OkfDocContent> {
  return request(`${API_URL}/bundles/${bundleId}/okf-docs/content?path=${encodeURIComponent(path)}`);
}

export function saveOkfDocContent(
  bundleId: string,
  path: string,
  content: string,
): Promise<{ commitOid: string; branch: string; updatedAt: string }> {
  return request(
    `${API_URL}/bundles/${bundleId}/okf-docs/content?path=${encodeURIComponent(path)}`,
    { method: "PUT", body: JSON.stringify({ content }) },
  );
}

export function createPage(
  bundleId: string,
  input: { path: string; title: string; content?: string },
): Promise<PageSummary> {
  return request(`${API_URL}/bundles/${bundleId}/pages`, {
    method: "POST",
    body: JSON.stringify({ content: "", ...input }),
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads an image into the bundle's git subtree (committed on the caller's
 * user branch). The returned `src` is the same-origin `/api/assets/...` URL
 * to embed in markdown — plain `<img>` tags can load it via the session cookie.
 */
export async function uploadBundleAsset(
  bundleId: string,
  file: File,
): Promise<{ path: string; src: string }> {
  const dataBase64 = await fileToBase64(file);
  return request(`${API_URL}/bundles/${bundleId}/assets`, {
    method: "POST",
    body: JSON.stringify({ filename: file.name, dataBase64 }),
  });
}

export type BundleGraph = {
  nodes: { id: string; title: string; path: string }[];
  edges: { from: string; to: string }[];
};

export function fetchBundleGraph(bundleId: string): Promise<BundleGraph> {
  return request(`${API_URL}/bundles/${bundleId}/graph`);
}

export type PresenceEntry = { userId: string; displayName: string; lastSeenAt: string };

export function sendPresenceHeartbeat(bundleId: string, pageId: string): Promise<void> {
  return request(`${API_URL}/bundles/${bundleId}/pages/${pageId}/presence`, { method: "POST" });
}

export function fetchPresence(bundleId: string, pageId: string): Promise<PresenceEntry[]> {
  return request(`${API_URL}/bundles/${bundleId}/pages/${pageId}/presence`);
}

export type AutosaveDraft = { id: string; contentJson: unknown; updatedAt: string };

export function fetchAutosaveDraft(pageId: string): Promise<{ draft: AutosaveDraft | null }> {
  return request(`/api/autosave?pageId=${encodeURIComponent(pageId)}`);
}

export function saveAutosaveDraft(
  pageId: string,
  contentJson: unknown,
): Promise<{ draft: AutosaveDraft }> {
  return request(`/api/autosave`, {
    method: "POST",
    body: JSON.stringify({ pageId, contentJson }),
  });
}

export type MrUser = { id: string; displayName: string; email: string };

export type MergeRequestStatus = "draft" | "open" | "conflict" | "merged" | "rejected";

export type MergeRequestSummary = {
  id: string;
  bundleId: string;
  authorId: string;
  branchName: string;
  /** "okf" = authored by the indexer agent against the compiled knowledge bundle. */
  scope: "wiki" | "okf";
  status: MergeRequestStatus;
  baseCommit: string;
  headCommit: string;
  createdAt: string;
  updatedAt: string;
  author: MrUser;
};

export type MrFileDiff =
  | {
      path: string;
      status: "added" | "modified" | "deleted";
      kind: "text";
      before: string | null;
      after: string | null;
    }
  | {
      path: string;
      status: "added" | "modified" | "deleted";
      kind: "asset";
      beforeUrl: string | null;
      afterUrl: string | null;
    };

export type MrReviewerDecision = {
  id: string;
  userId: string;
  decision: "pending" | "approved" | "rejected";
  decidedAt: string | null;
  user: MrUser;
};

export type MergeRequestDetail = MergeRequestSummary & {
  files: MrFileDiff[];
  reviewers: MrReviewerDecision[];
};

export type MrComment = {
  id: string;
  mrId: string;
  authorId: string;
  body: string;
  path: string | null;
  line: number | null;
  createdAt: string;
  author: MrUser;
};

/**
 * Opens or updates the merge request for the caller's own branch on this
 * bundle. `scope: "okf"` submits compiled-doc edits (okf-docs.ts)
 * independently of any in-flight `"wiki"` MR on the same branch.
 */
export function submitForReview(
  bundleId: string,
  scope: "wiki" | "okf" = "wiki",
): Promise<MergeRequestSummary> {
  return request(`${API_URL}/bundles/${bundleId}/merge-requests`, {
    method: "POST",
    body: JSON.stringify({ scope }),
  });
}

export function fetchMergeRequests(
  bundleId: string,
  status?: MergeRequestStatus,
): Promise<MergeRequestSummary[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return request(`${API_URL}/bundles/${bundleId}/merge-requests${qs}`);
}

export function fetchMergeRequest(bundleId: string, mrId: string): Promise<MergeRequestDetail> {
  return request(`${API_URL}/bundles/${bundleId}/merge-requests/${mrId}`);
}

export function approveMergeRequest(bundleId: string, mrId: string): Promise<MergeRequestSummary> {
  return request(`${API_URL}/bundles/${bundleId}/merge-requests/${mrId}/approve`, {
    method: "POST",
  });
}

export function rejectMergeRequest(bundleId: string, mrId: string): Promise<MergeRequestSummary> {
  return request(`${API_URL}/bundles/${bundleId}/merge-requests/${mrId}/reject`, {
    method: "POST",
  });
}

export type Notification = {
  id: string;
  type: "mr_submitted";
  bundleId: string;
  mrId: string | null;
  body: string;
  readAt: string | null;
  createdAt: string;
  bundle: { id: string; slug: string; title: string };
};

export function fetchNotifications(): Promise<Notification[]> {
  return request(`${API_URL}/notifications`);
}

export function markNotificationRead(notificationId: string): Promise<Notification> {
  return request(`${API_URL}/notifications/${notificationId}/read`, { method: "POST" });
}

export function markAllNotificationsRead(): Promise<{ ok: true }> {
  return request(`${API_URL}/notifications/read-all`, { method: "POST" });
}

export function fetchMrComments(bundleId: string, mrId: string): Promise<MrComment[]> {
  return request(`${API_URL}/bundles/${bundleId}/merge-requests/${mrId}/comments`);
}

export function addMrComment(
  bundleId: string,
  mrId: string,
  body: string,
  path?: string,
  line?: number,
): Promise<MrComment> {
  return request(`${API_URL}/bundles/${bundleId}/merge-requests/${mrId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, path, line }),
  });
}

export function mrAssetUrl(
  bundleId: string,
  mrId: string,
  path: string,
  side: "before" | "after",
): string {
  return `${API_URL}/bundles/${bundleId}/merge-requests/${mrId}/asset?path=${encodeURIComponent(path)}&side=${side}`;
}

/**
 * Fetches an authed asset (image diff preview) as a blob URL. Plain `<img
 * src>` can't carry the bearer Authorization header the API requires, so the
 * caller fetches it manually and hands the resulting object URL to `<img>`.
 *
 * The MR detail endpoint returns API-relative paths (`/bundles/.../asset?...`);
 * resolve those against `NEXT_PUBLIC_API_URL` so the browser doesn't hit the
 * Next.js origin (where that route doesn't exist).
 */
export async function fetchAssetBlobUrl(url: string): Promise<string> {
  const resolved = /^https?:\/\//i.test(url)
    ? url
    : `${API_URL}${url.startsWith("/") ? url : `/${url}`}`;
  const token = getToken();
  const res = await fetch(resolved, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Failed to load asset (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ---- Conflict resolution (manager-only, Prompt 9) ----

export type MrConflictFile = { id: string; mrId: string; path: string; markerText: string };

export function fetchMrConflicts(
  bundleId: string,
  mrId: string,
): Promise<{ mr: MergeRequestSummary; conflicts: MrConflictFile[] }> {
  return request(`${API_URL}/bundles/${bundleId}/merge-requests/${mrId}/conflicts`);
}

export function resolveMrConflict(
  bundleId: string,
  mrId: string,
  files: { path: string; content: string }[],
): Promise<MergeRequestSummary> {
  return request(`${API_URL}/bundles/${bundleId}/merge-requests/${mrId}/resolve-conflict`, {
    method: "POST",
    body: JSON.stringify({ files }),
  });
}

// ---- Admin panel (Prompt 10) ----

export type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: string;
};

export function fetchUsers(): Promise<AdminUser[]> {
  return request(`${API_URL}/admin/users`);
}

export function createUser(input: {
  email: string;
  password: string;
  displayName: string;
  isAdmin?: boolean;
}): Promise<AdminUser> {
  return request(`${API_URL}/admin/users`, { method: "POST", body: JSON.stringify(input) });
}

export function updateUser(
  userId: string,
  input: { displayName?: string; email?: string; isAdmin?: boolean },
): Promise<AdminUser> {
  return request(`${API_URL}/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export type BundleMode = "raw" | "llm_compiled";

export type AdminBundle = {
  id: string;
  slug: string;
  title: string;
  isPublic: boolean;
  mode: BundleMode;
  defaultBranch: string;
  archivedAt: string | null;
  createdAt: string;
};

export function fetchBundles(): Promise<AdminBundle[]> {
  return request(`${API_URL}/bundles`);
}

export function createBundle(input: {
  slug: string;
  title: string;
  isPublic?: boolean;
}): Promise<AdminBundle> {
  return request(`${API_URL}/bundles`, { method: "POST", body: JSON.stringify(input) });
}

export function archiveBundle(bundleId: string): Promise<AdminBundle> {
  return request(`${API_URL}/bundles/${bundleId}/archive`, { method: "POST" });
}

export function unarchiveBundle(bundleId: string): Promise<AdminBundle> {
  return request(`${API_URL}/bundles/${bundleId}/unarchive`, { method: "POST" });
}

/** Admin-only. Requires typing the bundle slug as `confirmSlug`. */
export function deleteBundle(
  bundleId: string,
  confirmSlug: string,
): Promise<{ deleted: true }> {
  return request(`${API_URL}/bundles/${bundleId}`, {
    method: "DELETE",
    body: JSON.stringify({ confirmSlug }),
  });
}

export function updateBundle(
  bundleId: string,
  input: { title?: string; isPublic?: boolean },
): Promise<AdminBundle> {
  return request(`${API_URL}/bundles/${bundleId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** Managers (review permission) and admins can flip a bundle between raw and LLM-compiled. */
export function setBundleMode(bundleId: string, mode: BundleMode): Promise<AdminBundle> {
  return request(`${API_URL}/bundles/${bundleId}/mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export type AdminMergeRequestSummary = MergeRequestSummary & {
  bundle: { id: string; slug: string; title: string };
};

/** Cross-bundle merge-request queue for the admin section. */
export function fetchAdminMergeRequests(
  status?: MergeRequestStatus,
): Promise<AdminMergeRequestSummary[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return request(`${API_URL}/admin/merge-requests${qs}`);
}

export function fetchBundle(bundleId: string): Promise<AdminBundle> {
  return request(`${API_URL}/bundles/${bundleId}`);
}

export type MyBundle = AdminBundle & { role: PermissionRole };

/** Bundles the signed-in user has at least view access to — the "my documents" dashboard. */
export function fetchMyBundles(): Promise<MyBundle[]> {
  return request(`${API_URL}/bundles/mine`);
}

export type PermissionRole = "manager" | "author" | "viewer";

export type PermissionGrant = {
  id: string;
  userId: string;
  bundleId: string;
  pathPrefix: string | null;
  role: PermissionRole;
  user: MrUser;
};

export function fetchPermissions(bundleId: string): Promise<PermissionGrant[]> {
  return request(`${API_URL}/bundles/${bundleId}/permissions`);
}

export function createPermission(
  bundleId: string,
  input: { userId: string; role: PermissionRole; pathPrefix?: string | null },
): Promise<PermissionGrant> {
  return request(`${API_URL}/bundles/${bundleId}/permissions`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deletePermission(bundleId: string, permissionId: string): Promise<void> {
  return request(`${API_URL}/bundles/${bundleId}/permissions/${permissionId}`, {
    method: "DELETE",
  });
}

// ---- Document remote mirroring (admin-only) ----

export type DocumentRemoteConfig = {
  connected: boolean;
  url: string | null;
  branch: string | null;
  lastPushedAt: string | null;
  lastPushedOid: string | null;
  lastPulledAt: string | null;
  lastPulledOid: string | null;
  updatedAt: string | null;
};

export function fetchDocumentRemote(): Promise<DocumentRemoteConfig> {
  return request(`${API_URL}/admin/document-remote`);
}

export function saveDocumentRemote(input: {
  url: string;
  branch: string;
  token?: string;
}): Promise<DocumentRemoteConfig> {
  return request(`${API_URL}/admin/document-remote`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function disconnectDocumentRemote(): Promise<DocumentRemoteConfig> {
  return request(`${API_URL}/admin/document-remote`, { method: "DELETE" });
}

export function pushDocumentRemote(): Promise<DocumentRemoteConfig & { commitCount: number }> {
  return request(`${API_URL}/admin/document-remote/push`, { method: "POST" });
}

export function pullDocumentRemote(): Promise<
  DocumentRemoteConfig & { changed: boolean; createdBundles: number }
> {
  return request(`${API_URL}/admin/document-remote/pull`, { method: "POST" });
}

// ---- Per-bundle wiki versions (bundle managers + admins) ----

export type WikiVersion = {
  name: string;
  oid: string;
  createdAt: string;
};

export type WikiCommit = {
  oid: string;
  summary: string;
  authorName: string;
  committedAt: string;
};

export function fetchWikiVersions(bundleId: string): Promise<WikiVersion[]> {
  return request(`${API_URL}/bundles/${bundleId}/versions`);
}

export function fetchWikiCommits(bundleId: string, limit = 50): Promise<WikiCommit[]> {
  return request(`${API_URL}/bundles/${bundleId}/versions/commits?limit=${limit}`);
}

export function createWikiVersion(
  bundleId: string,
  name: string,
  fromOid?: string,
): Promise<WikiVersion> {
  return request(`${API_URL}/bundles/${bundleId}/versions`, {
    method: "POST",
    body: JSON.stringify(fromOid ? { name, fromOid } : { name }),
  });
}

export function restoreWikiVersion(
  bundleId: string,
  name: string,
): Promise<{ restored: boolean; pagesUpserted: number; pagesDeleted: number }> {
  return request(`${API_URL}/bundles/${bundleId}/versions/${encodeURIComponent(name)}/restore`, {
    method: "POST",
  });
}

export function deleteWikiVersion(bundleId: string, name: string): Promise<{ deleted: boolean }> {
  return request(`${API_URL}/bundles/${bundleId}/versions/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

// ---- Per-bundle git remote (admin-only) ----

export type BundleRemoteConfig = {
  connected: boolean;
  url: string | null;
  branch: string | null;
  hasToken: boolean;
  lastPushedAt: string | null;
  lastPushedOid: string | null;
  lastPulledAt: string | null;
  lastPulledOid: string | null;
  updatedAt: string | null;
};

export function fetchBundleRemote(bundleId: string): Promise<BundleRemoteConfig> {
  return request(`${API_URL}/bundles/${bundleId}/remote`);
}

export function saveBundleRemote(
  bundleId: string,
  input: { url: string; branch: string; token?: string },
): Promise<BundleRemoteConfig> {
  return request(`${API_URL}/bundles/${bundleId}/remote`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function disconnectBundleRemote(bundleId: string): Promise<BundleRemoteConfig> {
  return request(`${API_URL}/bundles/${bundleId}/remote`, { method: "DELETE" });
}

export function pushBundleRemote(
  bundleId: string,
): Promise<BundleRemoteConfig & { commitCount: number }> {
  return request(`${API_URL}/bundles/${bundleId}/remote/push`, { method: "POST" });
}

export function pullBundleRemote(
  bundleId: string,
): Promise<BundleRemoteConfig & { changed: boolean; pagesUpserted: number; pagesDeleted: number }> {
  return request(`${API_URL}/bundles/${bundleId}/remote/pull`, { method: "POST" });
}

// ---- AI settings (admin-only) ----

export type AiProvider = "anthropic" | "openai_compatible";

export type AiSettings = {
  provider: AiProvider;
  baseUrl: string | null;
  /** The key itself is write-only; only its presence is reported. */
  hasApiKey: boolean;
  indexerModel: string;
  chatModel: string;
  updatedAt: string | null;
};

export function fetchAiSettings(): Promise<AiSettings> {
  return request(`${API_URL}/admin/ai-settings`);
}

export function saveAiSettings(input: {
  provider: AiProvider;
  baseUrl?: string | null;
  apiKey?: string;
  indexerModel?: string;
  chatModel?: string;
}): Promise<AiSettings> {
  return request(`${API_URL}/admin/ai-settings`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

// ---- OCR settings (admin-only; dedicated VLM for document ingest) ----

export type OcrSettings = {
  baseUrl: string | null;
  hasApiKey: boolean;
  model: string;
  updatedAt: string | null;
};

export function fetchOcrSettings(): Promise<OcrSettings> {
  return request(`${API_URL}/admin/ocr-settings`);
}

export function saveOcrSettings(input: {
  baseUrl: string;
  apiKey?: string;
  model?: string;
}): Promise<OcrSettings> {
  return request(`${API_URL}/admin/ocr-settings`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function fetchOcrStatus(): Promise<{ configured: boolean }> {
  return request(`${API_URL}/ingest/ocr-status`);
}

// ---- STT settings (admin-only; dedicated speech-to-text for voice ingest) ----

export type SttSettings = {
  baseUrl: string | null;
  hasApiKey: boolean;
  model: string;
  updatedAt: string | null;
};

export function fetchSttSettings(): Promise<SttSettings> {
  return request(`${API_URL}/admin/stt-settings`);
}

export function saveSttSettings(input: {
  baseUrl: string;
  apiKey?: string;
  model?: string;
}): Promise<SttSettings> {
  return request(`${API_URL}/admin/stt-settings`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function fetchSttStatus(): Promise<{ configured: boolean }> {
  return request(`${API_URL}/ingest/stt-status`);
}

// ---- Document ingest ----

export type IngestPageImage = {
  page: number;
  mime: string;
  base64: string;
};

export type IngestConvertResult = {
  jobId: string;
  markdown: string;
  pageImages: IngestPageImage[];
  titleHint: string;
  format: string;
  filename: string;
};

export async function convertIngestDocument(
  bundleId: string,
  file: File,
): Promise<IngestConvertResult> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/bundles/${bundleId}/ingest/convert`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Convert failed with ${res.status}`);
  }
  return res.json() as Promise<IngestConvertResult>;
}

export function ocrIngestDocument(
  bundleId: string,
  jobId: string,
): Promise<{ jobId: string; markdown: string }> {
  return request(`${API_URL}/bundles/${bundleId}/ingest/ocr`, {
    method: "POST",
    body: JSON.stringify({ jobId }),
  });
}

export async function transcribeIngestAudio(
  bundleId: string,
  file: File,
): Promise<IngestConvertResult & { kind: "audio" }> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/bundles/${bundleId}/ingest/transcribe`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Transcription failed with ${res.status}`);
  }
  return res.json() as Promise<IngestConvertResult & { kind: "audio" }>;
}

export function suggestIngestPlacement(
  bundleId: string,
  input: { markdown: string; filename?: string },
): Promise<{ title: string; path: string }> {
  return request(`${API_URL}/bundles/${bundleId}/ingest/suggest-placement`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function commitIngestDocument(
  bundleId: string,
  input: { title: string; path: string; markdown: string; jobId?: string },
): Promise<PageSummary> {
  return request(`${API_URL}/bundles/${bundleId}/ingest/commit`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ---- Knowledge-base compilation (indexer agent) ----

export type IndexerRun = {
  id: string;
  status: "running" | "succeeded" | "failed";
  error: string | null;
  mrId: string | null;
  stats: {
    sourcePages: number;
    docsWritten: number;
    docsDeleted: number;
    changedFiles: number;
    skippedUnchanged?: number;
  } | null;
  startedAt: string;
  finishedAt: string | null;
  triggeredBy: { displayName: string } | null;
};

export function compileBundle(bundleId: string): Promise<{ runId: string }> {
  return request(`${API_URL}/bundles/${bundleId}/compile`, { method: "POST" });
}

export function fetchCompileRuns(bundleId: string, limit = 10): Promise<IndexerRun[]> {
  return request(`${API_URL}/bundles/${bundleId}/compile/runs?limit=${limit}`);
}

export function fetchCompileRun(bundleId: string, runId: string): Promise<IndexerRun> {
  return request(`${API_URL}/bundles/${bundleId}/compile/runs/${runId}`);
}

// ---- Knowledge chat ----

export type ChatThreadSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export function fetchChatThreads(bundleId: string): Promise<ChatThreadSummary[]> {
  return request(`${API_URL}/bundles/${bundleId}/chat/threads`);
}

export function fetchChatThread(
  bundleId: string,
  threadId: string,
): Promise<{
  thread: { id: string; title: string };
  messages: { id: string; role: string; parts: unknown[] }[];
}> {
  return request(`${API_URL}/bundles/${bundleId}/chat/threads/${threadId}`);
}

export function deleteChatThread(bundleId: string, threadId: string): Promise<{ deleted: string }> {
  return request(`${API_URL}/bundles/${bundleId}/chat/threads/${threadId}`, { method: "DELETE" });
}

// ---- Agents (Specialist) ----

export type AgentAggressiveness = "relaxed" | "balanced" | "aggressive";

export type AgentSessionMode = "create" | "edit";

export type AgentSectionStatus =
  | "proposed"
  | "accepted"
  | "rejected"
  | "superseded"
  | "original";

export type AgentPageSection = {
  id: string;
  headingText: string;
  headingLevel: number;
  orderIndex: number;
  status: AgentSectionStatus;
  html: string;
  editId: string | null;
  baseHtml: string | null;
  proposedHtml: string | null;
};

export type AgentSessionSummary = {
  id: string;
  title: string;
  goal: string | null;
  role: string | null;
  aggressiveness: AgentAggressiveness;
  status: "active" | "draft_ready" | "imported" | "archived";
  bundleId: string | null;
  updatedAt: string;
  createdAt: string;
};

export type AgentSession = AgentSessionSummary & {
  draftMarkdown: string | null;
  uploadCount: number;
  bundle: { id: string; slug: string; title: string; mode: string } | null;
  skills: Array<{ id: string; name: string }>;
  mcpServers: Array<{
    id: string;
    name: string;
    authType?: McpAuthType;
    status?: McpServerStatus;
  }>;
  mode: AgentSessionMode;
  targetPageId: string | null;
  sections: AgentPageSection[];
  /** Assembled body (snapshot + accepted edits). Edit mode only. */
  effectiveMarkdown: string | null;
};

export type AgentUpload = {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
};

export type AgentBundleOption = {
  id: string;
  slug: string;
  title: string;
  mode: string;
  canEdit: boolean;
};

export type AgentImportResult = {
  page: PageSummary;
  branch: string;
  compile:
    | { status: "started"; runId: string }
    | { status: "skipped"; reason: string }
    | { status: "failed"; reason: string };
};

export function fetchAgentsHub(): Promise<{ sessions: AgentSessionSummary[] }> {
  return request(`${API_URL}/agents`);
}

export function fetchAgentBundles(): Promise<AgentBundleOption[]> {
  return request(`${API_URL}/agents/bundles`);
}

export function createAgentSession(input: {
  goal?: string;
  bundleId?: string | null;
  role?: string;
  aggressiveness?: AgentAggressiveness;
  skillIds?: string[];
  mcpServerIds?: string[];
  mode?: AgentSessionMode;
  targetPageId?: string;
}): Promise<AgentSession> {
  return request(`${API_URL}/agents/sessions`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function decideSectionEdit(
  sessionId: string,
  editId: string,
  decision: "accept" | "reject",
): Promise<{ id: string; sectionId: string; status: string; decidedAt: string | null }> {
  return request(`${API_URL}/agents/sessions/${sessionId}/section-edits/${editId}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

export function saveAgentPageEdit(
  sessionId: string,
  content?: string,
): Promise<{ commitOid: string; branch: string }> {
  return request(`${API_URL}/agents/sessions/${sessionId}/save`, {
    method: "POST",
    body: JSON.stringify(content !== undefined ? { content } : {}),
  });
}

export function fetchAgentSession(sessionId: string): Promise<{
  session: AgentSession;
  uploads: AgentUpload[];
  messages: { id: string; role: string; parts: unknown[] }[];
}> {
  return request(`${API_URL}/agents/sessions/${sessionId}`);
}

export function updateAgentSession(
  sessionId: string,
  input: {
    goal?: string | null;
    bundleId?: string | null;
    draftMarkdown?: string | null;
    title?: string;
    role?: string | null;
    aggressiveness?: AgentAggressiveness;
    status?: AgentSession["status"];
  },
): Promise<AgentSession> {
  return request(`${API_URL}/agents/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function uploadAgentFile(sessionId: string, file: File): Promise<AgentUpload> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/agents/sessions/${sessionId}/uploads`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Upload failed with ${res.status}`);
  }
  return res.json() as Promise<AgentUpload>;
}

export function deleteAgentUpload(
  sessionId: string,
  uploadId: string,
): Promise<{ deleted: string }> {
  return request(`${API_URL}/agents/sessions/${sessionId}/uploads/${uploadId}`, {
    method: "DELETE",
  });
}

export function importAgentDraft(
  sessionId: string,
  input: { bundleId: string; path?: string; title: string },
): Promise<AgentImportResult> {
  return request(`${API_URL}/agents/sessions/${sessionId}/import`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ---- Skills ----

export type Skill = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  roleKeys: string[];
  createdAt: string;
  updatedAt: string;
};

export type SkillDetail = Skill & { content: string };

export function fetchSkills(): Promise<Skill[]> {
  return request(`${API_URL}/skills`);
}

export function fetchSkillDetail(id: string): Promise<SkillDetail> {
  return request(`${API_URL}/admin/skills/${id}`);
}

export function createSkill(input: {
  name: string;
  description?: string | null;
  content: string;
  roleKeys?: string[];
}): Promise<SkillDetail> {
  return request(`${API_URL}/admin/skills`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateSkill(
  id: string,
  input: { name?: string; description?: string | null; content?: string; roleKeys?: string[] },
): Promise<SkillDetail> {
  return request(`${API_URL}/admin/skills/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteSkill(id: string): Promise<{ deleted: string }> {
  return request(`${API_URL}/admin/skills/${id}`, { method: "DELETE" });
}

// ---- MCP servers ----

export type McpTransport = "auto" | "http" | "sse";
export type McpAuthType =
  | "none"
  | "headers"
  | "oauth2_auth_code"
  | "oauth2_client_credentials";
export type McpServerStatus = "unknown" | "ok" | "error" | "needs_auth";

export type McpServer = {
  id: string;
  name: string;
  description: string | null;
  authType: McpAuthType;
  status: McpServerStatus;
  toolNames: string[];
};

export type McpServerAdmin = McpServer & {
  slug: string;
  url: string;
  transport: McpTransport;
  authType: McpAuthType;
  enabled: boolean;
  headerNames: string[];
  hasHeaders: boolean;
  oauthUseDcr: boolean;
  oauthClientId: string | null;
  hasClientSecret: boolean;
  oauthScopes: string | null;
  oauthRedirectUri: string | null;
  hasTokens: boolean;
  oauthTokenExpiresAt: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type McpServerInput = {
  name: string;
  slug?: string;
  description?: string | null;
  url: string;
  transport?: McpTransport;
  authType?: McpAuthType;
  enabled?: boolean;
  headers?: Record<string, string>;
  clearHeaders?: boolean;
  oauthUseDcr?: boolean;
  oauthClientId?: string | null;
  oauthClientSecret?: string | null;
  clearClientSecret?: boolean;
  oauthScopes?: string | null;
};

export function fetchMcpServers(): Promise<McpServer[]> {
  return request(`${API_URL}/mcp-servers`);
}

export function fetchAdminMcpServers(): Promise<McpServerAdmin[]> {
  return request(`${API_URL}/admin/mcp-servers`);
}

export function createMcpServer(input: McpServerInput): Promise<McpServerAdmin> {
  return request(`${API_URL}/admin/mcp-servers`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateMcpServer(id: string, input: Partial<McpServerInput>): Promise<McpServerAdmin> {
  return request(`${API_URL}/admin/mcp-servers/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteMcpServer(id: string): Promise<{ deleted: string }> {
  return request(`${API_URL}/admin/mcp-servers/${id}`, { method: "DELETE" });
}

export function testMcpServer(
  id: string,
): Promise<{ ok: boolean; tools?: string[]; error?: string; needsAuth?: boolean }> {
  return request(`${API_URL}/admin/mcp-servers/${id}/test`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** Per-user OAuth start (any agent-accessible user). */
export function startMcpOauth(
  id: string,
  returnTo?: string,
): Promise<{ authorizationUrl: string | null; alreadyAuthorized?: boolean }> {
  return request(`${API_URL}/mcp-servers/${id}/oauth/start`, {
    method: "POST",
    body: JSON.stringify({ returnTo }),
  });
}

/** Admin alias that returns to /admin/mcp after consent. */
export function startAdminMcpOauth(
  id: string,
): Promise<{ authorizationUrl: string | null; alreadyAuthorized?: boolean }> {
  return request(`${API_URL}/admin/mcp-servers/${id}/oauth/start`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** Clear DCR client + all user tokens so the next Connect re-registers. */
export function resetMcpOauthClient(id: string): Promise<McpServerAdmin> {
  return request(`${API_URL}/admin/mcp-servers/${id}/oauth/reset-client`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// ---- Search ----

export type SearchMode = "keyword" | "semantic" | "hybrid";

export type SearchResult = {
  pageId: string;
  bundleId: string;
  bundleSlug: string;
  bundleTitle: string;
  path: string;
  title: string;
  rank: number;
  scores?: {
    keyword: number | null;
    semantic: number | null;
    combined: number;
  };
  snippet?: string | null;
  source: "raw" | "okf";
};

export type SearchResponse = {
  results: SearchResult[];
  mode: SearchMode;
  semanticAvailable: boolean;
};

export function searchWiki(q: string, mode?: SearchMode): Promise<SearchResponse> {
  const params = new URLSearchParams({ q });
  if (mode) params.set("mode", mode);
  return request(`${API_URL}/search?${params}`);
}

// ---- Embedding settings (admin-only) ----

export type EmbeddingReindexStatus = {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  finishedAt: string | null;
};

export type EmbeddingSettings = {
  baseUrl: string | null;
  hasApiKey: boolean;
  model: string;
  updatedAt: string | null;
  reindex: EmbeddingReindexStatus;
  modelChanged?: boolean;
};

export function fetchEmbeddingSettings(): Promise<EmbeddingSettings> {
  return request(`${API_URL}/admin/embedding-settings`);
}

export function saveEmbeddingSettings(input: {
  baseUrl: string;
  apiKey?: string;
  model?: string;
}): Promise<EmbeddingSettings> {
  return request(`${API_URL}/admin/embedding-settings`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function startEmbeddingReindex(): Promise<EmbeddingReindexStatus> {
  return request(`${API_URL}/admin/embedding-settings/reindex`, {
    method: "POST",
  });
}
