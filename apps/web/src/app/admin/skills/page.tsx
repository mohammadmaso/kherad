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
import { Textarea } from "@kherad/ui/components/ui/textarea";
import { PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  createSkill,
  deleteSkill,
  fetchSkillDetail,
  fetchSkills,
  updateSkill,
  type Skill,
} from "@/lib/api-client";
import { AGENT_ROLE_PRESETS, agentRoleLabel } from "@/lib/agent-roles";
import { useI18n } from "@/lib/i18n/provider";

type EditorState = {
  id: string | null;
  name: string;
  description: string;
  content: string;
  roleKeys: Set<string>;
};

const EMPTY_EDITOR: EditorState = {
  id: null,
  name: "",
  description: "",
  content: "",
  roleKeys: new Set(),
};

export default function AdminSkillsPage() {
  const { t, locale } = useI18n();
  const a = t.adminSkills;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [skills, setSkills] = useState<Skill[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [submitting, setSubmitting] = useState(false);

  async function reload() {
    try {
      const rows = await fetchSkills();
      setSkills(rows);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : a.loadFailed);
      setLoaded(true);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const rows = await fetchSkills();
        setSkills(rows);
        setLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : a.loadFailed);
        setLoaded(true);
      }
    })();
  }, [a.loadFailed]);

  function openCreate() {
    setEditor(EMPTY_EDITOR);
    setDialogOpen(true);
  }

  async function openEdit(skill: Skill) {
    setError(null);
    try {
      const detail = await fetchSkillDetail(skill.id);
      setEditor({
        id: detail.id,
        name: detail.name,
        description: detail.description ?? "",
        content: detail.content,
        roleKeys: new Set(detail.roleKeys),
      });
      setDialogOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : a.loadFailed);
    }
  }

  function toggleRole(key: string) {
    setEditor((prev) => {
      const next = new Set(prev.roleKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, roleKeys: next };
    });
  }

  async function handleFilePick(file: File) {
    const text = await file.text();
    setEditor((prev) => ({
      ...prev,
      content: text,
      name: prev.name || file.name.replace(/\.(md|markdown|txt)$/i, ""),
    }));
  }

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      const input = {
        name: editor.name.trim(),
        description: editor.description.trim() || null,
        content: editor.content,
        roleKeys: [...editor.roleKeys],
      };
      if (editor.id) {
        await updateSkill(editor.id, input);
      } else {
        await createSkill(input);
      }
      setDialogOpen(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveFailed);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deleteSkill(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : a.deleteFailed);
    }
  }

  const canSave = editor.name.trim().length > 0 && editor.content.trim().length > 0;

  if (!loaded) {
    return <p className="text-muted-foreground text-sm">{t.common.loading}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{a.title}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{a.subtitle}</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <PlusIcon className="size-3.5" />
          {a.newSkill}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {skills.length === 0 ? (
        <p className="text-muted-foreground text-sm">{a.noSkills}</p>
      ) : (
        <ul className="border-border divide-border divide-y overflow-hidden rounded-xl border">
          {skills.map((skill) => (
            <li key={skill.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => void openEdit(skill)}
                className="min-w-0 flex-1 text-start"
              >
                <p className="truncate text-sm font-medium">{skill.name}</p>
                {skill.description ? (
                  <p className="text-muted-foreground truncate text-xs">{skill.description}</p>
                ) : null}
                {skill.roleKeys.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {skill.roleKeys.map((key) => (
                      <Badge key={key} variant="secondary">
                        {agentRoleLabel(key, locale)}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </button>
              <button
                type="button"
                aria-label={t.common.remove}
                className="text-muted-foreground hover:text-destructive shrink-0 rounded-md p-1.5 transition-colors duration-150"
                onClick={() => void handleDelete(skill.id)}
              >
                <Trash2Icon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editor.id ? a.editSkill : a.newSkill}</DialogTitle>
          </DialogHeader>
          <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skill-name">{t.common.name}</Label>
              <Input
                id="skill-name"
                value={editor.name}
                onChange={(e) => setEditor((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skill-description">{a.descriptionLabel}</Label>
              <Input
                id="skill-description"
                value={editor.description}
                onChange={(e) => setEditor((prev) => ({ ...prev, description: e.target.value }))}
                placeholder={a.descriptionPlaceholder}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{a.rolesLabel}</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {AGENT_ROLE_PRESETS.map((preset) => (
                  <label
                    key={preset.key}
                    className="flex cursor-pointer items-center gap-1.5 text-sm"
                  >
                    <Checkbox
                      checked={editor.roleKeys.has(preset.key)}
                      onCheckedChange={() => toggleRole(preset.key)}
                    />
                    {preset[locale]}
                  </label>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">{a.rolesHint}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="skill-content">{a.contentLabel}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadIcon className="size-3.5" />
                  {a.uploadFile}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown,.txt,text/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void handleFilePick(file);
                  }}
                />
              </div>
              <Textarea
                id="skill-content"
                value={editor.content}
                onChange={(e) => setEditor((prev) => ({ ...prev, content: e.target.value }))}
                className="min-h-56 font-mono text-xs"
                placeholder={a.contentPlaceholder}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button disabled={!canSave || submitting} onClick={() => void handleSave()}>
              {submitting ? t.common.saving : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
