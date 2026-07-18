"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { Checkbox } from "@kherad/ui/components/ui/checkbox";
import { Input } from "@kherad/ui/components/ui/input";
import { Label } from "@kherad/ui/components/ui/label";
import { Select } from "@kherad/ui/components/ui/select";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import {
  createAgentSession,
  fetchAgentBundles,
  fetchMcpServers,
  fetchSkills,
  getToken,
  startMcpOauth,
  type AgentAggressiveness,
  type AgentBundleOption,
  type McpServer,
  type Skill,
} from "@/lib/api-client";
import { AGENT_ROLE_PRESETS, agentRoleLabel } from "@/lib/agent-roles";
import { useI18n } from "@/lib/i18n/provider";

const CUSTOM_ROLE = "__custom__";
const AGGRESSIVENESS_OPTIONS: AgentAggressiveness[] = ["relaxed", "balanced", "aggressive"];

function NewAgentSessionPageInner() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [roleKey, setRoleKey] = useState("");
  const [customRole, setCustomRole] = useState("");
  const [goal, setGoal] = useState("");
  const [bundleId, setBundleId] = useState("");
  const [aggressiveness, setAggressiveness] = useState<AgentAggressiveness>("balanced");
  const [bundles, setBundles] = useState<AgentBundleOption[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [manualSkillIds, setManualSkillIds] = useState<Set<string> | null>(null);
  const [selectedMcpIds, setSelectedMcpIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const resolvedRole = roleKey === CUSTOM_ROLE ? customRole.trim() : agentRoleLabel(roleKey, locale);
  const connectedId = searchParams.get("connected");
  const oauthError = searchParams.get("oauthError");
  const oauthBanner = connectedId ? t.agents.mcpConnectedBanner : null;
  const oauthBannerError = oauthError ? t.agents.mcpOauthErrorBanner : null;
  const displayError = error ?? oauthBannerError;

  async function reloadMcp() {
    const mcpRows = await fetchMcpServers();
    setMcpServers(mcpRows);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getToken()) {
        router.replace("/login");
        return;
      }
      try {
        const [bundleRows, skillRows, mcpRows] = await Promise.all([
          fetchAgentBundles(),
          fetchSkills(),
          fetchMcpServers(),
        ]);
        if (cancelled) return;
        setBundles(bundleRows);
        setSkills(skillRows);
        setMcpServers(mcpRows);
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : t.agents.loadFailed;
        if (message.includes("Unauthorized")) {
          router.replace("/login");
          return;
        }
        setError(message.includes("Forbidden") ? t.agents.forbidden : message);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, t.agents.forbidden, t.agents.loadFailed]);

  useEffect(() => {
    if (!connectedId && !oauthError) return;
    const reloadTimer = window.setTimeout(() => {
      if (connectedId) void reloadMcp().catch(() => undefined);
    }, 0);
    const clearTimer = window.setTimeout(() => {
      router.replace("/agents/new");
    }, 2500);
    return () => {
      window.clearTimeout(reloadTimer);
      window.clearTimeout(clearTimer);
    };
  }, [connectedId, oauthError, router]);

  const defaultSkillIds = useMemo(
    () =>
      new Set(
        roleKey && roleKey !== CUSTOM_ROLE
          ? skills.filter((s) => s.roleKeys.includes(roleKey)).map((s) => s.id)
          : [],
      ),
    [roleKey, skills],
  );

  const selectedSkillIds = manualSkillIds ?? defaultSkillIds;

  function toggleSkill(id: string) {
    const next = new Set(selectedSkillIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setManualSkillIds(next);
  }

  function toggleMcp(id: string) {
    setSelectedMcpIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConnect(id: string) {
    setConnectingId(id);
    setError(null);
    try {
      const result = await startMcpOauth(id, "/agents/new");
      if (result.alreadyAuthorized || !result.authorizationUrl) {
        await reloadMcp();
        return;
      }
      window.location.assign(result.authorizationUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.agents.mcpOauthErrorBanner);
      setConnectingId(null);
    }
  }

  async function handleStart() {
    setSubmitting(true);
    setError(null);
    try {
      const session = await createAgentSession({
        role: resolvedRole || undefined,
        goal: goal.trim() || undefined,
        bundleId: bundleId || null,
        aggressiveness,
        skillIds: [...selectedSkillIds],
        mcpServerIds: [...selectedMcpIds],
      });
      router.push(`/agents/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.agents.loadFailed);
      setSubmitting(false);
    }
  }

  if (!loaded) {
    return (
      <div className="mx-auto w-full max-w-xl p-6">
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 p-6">
      <div>
        <Link
          href="/agents"
          className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm transition-colors duration-150 active:scale-[0.98]"
        >
          <ArrowLeft className="size-3.5" />
          {t.agents.title}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t.agents.newSpecialist}</h1>
        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
          {t.agents.specialistDesc}
        </p>
      </div>

      {oauthBanner ? (
        <Alert>
          <AlertTitle>{t.common.saved}</AlertTitle>
          <AlertDescription>{oauthBanner}</AlertDescription>
        </Alert>
      ) : null}

      {displayError ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{displayError}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{t.agents.taskLabel}</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">{t.agents.taskPlaceholder}</p>
        </div>
        <Input
          id="specialist-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder={t.agents.taskPlaceholder}
          className="transition-[box-shadow,border-color] duration-150"
        />
      </section>

      <section className="flex flex-col gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{t.agents.bundleLabel}</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">{t.agents.specialistBundleHint}</p>
        </div>
        <Select
          id="specialist-bundle"
          value={bundleId}
          onChange={(e) => setBundleId(e.target.value)}
        >
          <option value="">{t.agents.specialistBundleNone}</option>
          {bundles.map((bundle) => (
            <option key={bundle.id} value={bundle.id}>
              {bundle.title}
            </option>
          ))}
        </Select>
      </section>

      <section className="flex flex-col gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{t.agents.roleLabel}</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">{t.agents.roleHint}</p>
        </div>
        <Select id="specialist-role" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
          <option value="">{t.agents.rolePick}</option>
          {AGENT_ROLE_PRESETS.map((preset) => (
            <option key={preset.key} value={preset.key}>
              {preset[locale]}
            </option>
          ))}
          <option value={CUSTOM_ROLE}>{t.agents.roleCustom}</option>
        </Select>
        {roleKey === CUSTOM_ROLE ? (
          <Input
            value={customRole}
            onChange={(e) => setCustomRole(e.target.value)}
            placeholder={t.agents.roleCustomPlaceholder}
          />
        ) : null}
      </section>

      {(skills.length > 0 || mcpServers.length > 0) && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t.agents.capabilitiesLabel}</h2>
            <p className="text-muted-foreground mt-0.5 text-xs">{t.agents.capabilitiesHint}</p>
          </div>

          {skills.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {t.agents.skillsLabel}
              </Label>
              <div className="border-border divide-border flex flex-col divide-y overflow-hidden rounded-xl border">
                {skills.map((skill) => (
                  <label
                    key={skill.id}
                    className="hover:bg-muted/40 flex cursor-pointer items-start gap-2.5 px-3 py-2.5 transition-colors duration-150 active:bg-muted/50"
                  >
                    <Checkbox
                      checked={selectedSkillIds.has(skill.id)}
                      onCheckedChange={() => toggleSkill(skill.id)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        {skill.name}
                        {defaultSkillIds.has(skill.id) ? (
                          <span className="text-primary bg-primary/10 rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium">
                            {t.agents.skillDefaultBadge}
                          </span>
                        ) : null}
                      </span>
                      {skill.description ? (
                        <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
                          {skill.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">{t.agents.skillsHint}</p>
            </div>
          ) : null}

          {mcpServers.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {t.agents.mcpServersLabel}
              </Label>
              <div className="border-border divide-border flex flex-col divide-y overflow-hidden rounded-xl border">
                {mcpServers.map((server) => (
                  <div
                    key={server.id}
                    className="hover:bg-muted/40 flex items-start gap-2.5 px-3 py-2.5 transition-colors duration-150"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                      <Checkbox
                        checked={selectedMcpIds.has(server.id)}
                        onCheckedChange={() => toggleMcp(server.id)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                          {server.name}
                          {server.status === "needs_auth" ? (
                            <Badge variant="outline">{t.agents.mcpNeedsAuthBadge}</Badge>
                          ) : null}
                          {server.status === "error" ? (
                            <Badge variant="warning">{t.agents.mcpErrorBadge}</Badge>
                          ) : null}
                        </span>
                        {server.description ? (
                          <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
                            {server.description}
                          </span>
                        ) : null}
                        {server.authType === "oauth2_auth_code" &&
                        server.status === "needs_auth" ? (
                          <span className="text-muted-foreground mt-1 block text-xs">
                            {t.agents.mcpNeedsAuthHint}
                          </span>
                        ) : null}
                      </span>
                    </label>
                    {server.authType === "oauth2_auth_code" && server.status === "needs_auth" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        disabled={connectingId === server.id}
                        onClick={() => void handleConnect(server.id)}
                      >
                        {connectingId === server.id ? t.common.loading : t.agents.mcpConnect}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">{t.agents.mcpServersHint}</p>
            </div>
          ) : null}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{t.agents.aggressivenessLabel}</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t.agents.aggressivenessHints[aggressiveness]}
          </p>
        </div>
        <div className="bg-muted/50 inline-flex w-fit gap-1 rounded-xl p-1">
          {AGGRESSIVENESS_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setAggressiveness(option)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-[color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] ${
                aggressiveness === option
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.agents.aggressivenessOptions[option]}
            </button>
          ))}
        </div>
      </section>

      <Button
        onClick={() => void handleStart()}
        disabled={submitting}
        className="w-full sm:w-auto"
      >
        {submitting ? t.common.loading : t.agents.startSpecialist}
      </Button>
    </div>
  );
}

export default function NewAgentSessionPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-xl p-6">
          <p className="text-muted-foreground text-sm">…</p>
        </div>
      }
    >
      <NewAgentSessionPageInner />
    </Suspense>
  );
}
