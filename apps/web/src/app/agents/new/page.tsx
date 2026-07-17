"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Button } from "@kherad/ui/components/ui/button";
import { Checkbox } from "@kherad/ui/components/ui/checkbox";
import { Input } from "@kherad/ui/components/ui/input";
import { Label } from "@kherad/ui/components/ui/label";
import { Select } from "@kherad/ui/components/ui/select";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  createAgentSession,
  fetchAgentBundles,
  fetchSkills,
  getToken,
  type AgentAggressiveness,
  type AgentBundleOption,
  type Skill,
} from "@/lib/api-client";
import { AGENT_ROLE_PRESETS, agentRoleLabel } from "@/lib/agent-roles";
import { useI18n } from "@/lib/i18n/provider";

const CUSTOM_ROLE = "__custom__";
const AGGRESSIVENESS_OPTIONS: AgentAggressiveness[] = ["relaxed", "balanced", "aggressive"];

export default function NewAgentSessionPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [roleKey, setRoleKey] = useState("");
  const [customRole, setCustomRole] = useState("");
  const [goal, setGoal] = useState("");
  const [bundleId, setBundleId] = useState("");
  const [aggressiveness, setAggressiveness] = useState<AgentAggressiveness>("balanced");
  const [bundles, setBundles] = useState<AgentBundleOption[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [manualSkillIds, setManualSkillIds] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const resolvedRole = roleKey === CUSTOM_ROLE ? customRole.trim() : agentRoleLabel(roleKey, locale);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getToken()) {
        router.replace("/login");
        return;
      }
      try {
        const [bundleRows, skillRows] = await Promise.all([fetchAgentBundles(), fetchSkills()]);
        if (cancelled) return;
        setBundles(bundleRows);
        setSkills(skillRows);
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

  const defaultSkillIds = useMemo(
    () =>
      new Set(
        roleKey && roleKey !== CUSTOM_ROLE
          ? skills.filter((s) => s.roleKeys.includes(roleKey)).map((s) => s.id)
          : [],
      ),
    [roleKey, skills],
  );

  // A role's default skills are pre-checked automatically — until the user
  // manually toggles one, after which their choices take over entirely.
  const selectedSkillIds = manualSkillIds ?? defaultSkillIds;

  function toggleSkill(id: string) {
    const next = new Set(selectedSkillIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setManualSkillIds(next);
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
      });
      router.push(`/agents/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.agents.loadFailed);
      setSubmitting(false);
    }
  }

  if (!loaded) {
    return (
      <div className="mx-auto w-full max-w-lg p-6">
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 p-6">
      <div>
        <Link
          href="/agents"
          className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm transition-colors duration-150"
        >
          <ArrowLeft className="size-3.5" />
          {t.agents.title}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{t.agents.newSpecialist}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.agents.specialistDesc}</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="specialist-role">{t.agents.roleLabel}</Label>
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
          <p className="text-muted-foreground text-xs">{t.agents.roleHint}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="specialist-goal">{t.agents.taskLabel}</Label>
          <Input
            id="specialist-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={t.agents.taskPlaceholder}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="specialist-bundle">{t.agents.bundleLabel}</Label>
          <Select id="specialist-bundle" value={bundleId} onChange={(e) => setBundleId(e.target.value)}>
            <option value="">{t.agents.specialistBundleNone}</option>
            {bundles.map((bundle) => (
              <option key={bundle.id} value={bundle.id}>
                {bundle.title}
              </option>
            ))}
          </Select>
          <p className="text-muted-foreground text-xs">{t.agents.specialistBundleHint}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t.agents.aggressivenessLabel}</Label>
          <div className="bg-muted/50 inline-flex w-fit gap-1 rounded-lg p-1">
            {AGGRESSIVENESS_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setAggressiveness(option)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                  aggressiveness === option
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.agents.aggressivenessOptions[option]}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            {t.agents.aggressivenessHints[aggressiveness]}
          </p>
        </div>

        {skills.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label>{t.agents.skillsLabel}</Label>
            <div className="border-border flex flex-col divide-y rounded-lg border">
              {skills.map((skill) => (
                <label
                  key={skill.id}
                  className="hover:bg-muted/40 flex cursor-pointer items-start gap-2.5 px-3 py-2 transition-colors duration-150"
                >
                  <Checkbox
                    checked={selectedSkillIds.has(skill.id)}
                    onCheckedChange={() => toggleSkill(skill.id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {skill.name}
                      {defaultSkillIds.has(skill.id) ? (
                        <span className="text-primary bg-primary/10 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-medium">
                          {t.agents.skillDefaultBadge}
                        </span>
                      ) : null}
                    </span>
                    {skill.description ? (
                      <span className="text-muted-foreground block text-xs">{skill.description}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">{t.agents.skillsHint}</p>
          </div>
        ) : null}

        <Button onClick={() => void handleStart()} disabled={submitting}>
          {submitting ? t.common.loading : t.agents.startSpecialist}
        </Button>
      </div>
    </div>
  );
}
