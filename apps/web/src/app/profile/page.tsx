"use client";

import { Alert, AlertDescription } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Label } from "@kherad/ui/components/ui/label";
import { Select } from "@kherad/ui/components/ui/select";
import { CheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { fetchCurrentUser, getToken, updateMyPreferences, type AuthedUser } from "@/lib/api-client";
import {
  ACCENT_SWATCHES,
  ACCENTS,
  TEXT_SIZES,
  THEME_MODES,
  UI_FONTS,
  type TextSize,
  type ThemeMode,
  type UiFont,
} from "@/lib/appearance/config";
import { useAppearance } from "@/lib/appearance/provider";
import { isLocale, LOCALE_LABELS, LOCALES, type Locale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";

/* Specimen stacks for the font picker — each option renders in the face it
   selects, independent of the currently applied UI font. */
const FONT_PREVIEW_STACKS: Record<UiFont, string> = {
  geist: "var(--font-geist-sans), ui-sans-serif, sans-serif",
  system: "ui-sans-serif, system-ui, -apple-system, sans-serif",
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
};

/* Exaggerated relative to the real 15/16/17px steps so the scale is legible. */
const TEXT_SIZE_SPECIMEN: Record<TextSize, string> = {
  compact: "text-sm",
  default: "text-lg",
  comfortable: "text-2xl",
};

/* Fixed light/dark colors on purpose: each pane depicts a color scheme (a
   miniature page with a card on it); it doesn't follow the active theme. */
function ThemePreviewPane({ dark }: { dark: boolean }) {
  return (
    <span
      className={`flex flex-1 items-center justify-center ${dark ? "bg-zinc-900" : "bg-zinc-100"}`}
    >
      <span
        className={`flex w-3/4 min-w-0 flex-col gap-1 rounded-[4px] p-1.5 shadow-sm ${
          dark ? "bg-zinc-800" : "bg-white"
        }`}
      >
        <span className={`h-1 w-4/5 rounded-full ${dark ? "bg-zinc-500" : "bg-zinc-400"}`} />
        <span className={`h-1 w-3/5 rounded-full ${dark ? "bg-zinc-700" : "bg-zinc-200"}`} />
      </span>
    </span>
  );
}

function ThemePreview({ mode }: { mode: ThemeMode }) {
  return (
    <span
      aria-hidden
      className="border-border flex h-14 w-full overflow-hidden rounded-md border"
    >
      {mode === "light" ? <ThemePreviewPane dark={false} /> : null}
      {mode === "dark" ? <ThemePreviewPane dark /> : null}
      {mode === "system" ? (
        <>
          <ThemePreviewPane dark={false} />
          <ThemePreviewPane dark />
        </>
      ) : null}
    </span>
  );
}

function OptionTile({
  selected,
  onSelect,
  label,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`ease-out-spring focus-visible:border-ring focus-visible:ring-ring/50 flex flex-col items-stretch gap-1.5 rounded-lg border p-1.5 pb-2 outline-none transition-[border-color,background-color,color,box-shadow,transform] duration-150 focus-visible:ring-3 active:scale-[0.98] ${
        selected
          ? "border-primary/70 bg-accent/40 shadow-sm"
          : "border-input hover:border-ring/40 hover:bg-muted/40"
      }`}
    >
      {children}
      <span
        className={`flex items-center justify-center gap-1 text-xs ${
          selected ? "text-accent-foreground font-medium" : "text-muted-foreground"
        }`}
      >
        {selected ? <CheckIcon aria-hidden className="size-3" /> : null}
        {label}
      </span>
    </button>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { t, locale, setLocale } = useI18n();
  const { appearance, setAppearance } = useAppearance();

  const [user, setUser] = useState<AuthedUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login?next=/profile");
      return;
    }
    let cancelled = false;
    fetchCurrentUser()
      .then((current) => {
        if (!cancelled) setUser(current);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t.profile.saveFailed);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleLanguageChange(next: string) {
    if (!isLocale(next) || next === locale) return;
    const previous: Locale = locale;
    // Apply immediately — the page flips language/direction as feedback —
    // then persist; on failure, roll back and say so.
    setLocale(next);
    setSaveState("saving");
    try {
      const updated = await updateMyPreferences({ locale: next });
      setUser(updated);
      setSaveState("saved");
    } catch {
      setLocale(previous);
      setSaveState("error");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-1.5">
        <h1>{t.profile.title}</h1>
        <p className="text-muted-foreground text-sm">{t.profile.subtitle}</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {user === null && !error ? (
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      ) : null}

      {user ? (
        <>
          <section className="surface-card flex flex-col gap-4 rounded-xl p-5">
            <h3>{t.profile.account}</h3>
            <dl className="grid grid-cols-[max-content_1fr] items-baseline gap-x-6 gap-y-3 text-sm">
              <dt className="text-muted-foreground">{t.profile.displayName}</dt>
              <dd className="font-medium">{user.displayName}</dd>
              <dt className="text-muted-foreground">{t.profile.email}</dt>
              <dd dir="ltr" className="text-start font-mono text-xs">
                {user.email}
              </dd>
              <dt className="text-muted-foreground">{t.profile.roleLabel}</dt>
              <dd>
                <Badge variant={user.isAdmin ? "default" : "secondary"}>
                  {user.isAdmin ? t.profile.roleAdmin : t.profile.roleMember}
                </Badge>
              </dd>
            </dl>
          </section>

          <section className="surface-card flex flex-col gap-4 rounded-xl p-5">
            <h3>{t.profile.preferences}</h3>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="language">{t.profile.language}</Label>
                <span
                  aria-live="polite"
                  className={`flex items-center gap-1 text-xs transition-opacity duration-300 ${
                    saveState === "idle" ? "opacity-0" : "opacity-100"
                  } ${saveState === "error" ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {saveState === "saving" ? t.common.loading : null}
                  {saveState === "saved" ? (
                    <>
                      <CheckIcon className="size-3" />
                      {t.profile.saved}
                    </>
                  ) : null}
                  {saveState === "error" ? t.profile.saveFailed : null}
                </span>
              </div>
              <Select
                id="language"
                value={locale}
                disabled={saveState === "saving"}
                onChange={(e) => void handleLanguageChange(e.target.value)}
                className="w-full sm:w-56"
              >
                {LOCALES.map((candidate) => (
                  <option key={candidate} value={candidate} lang={candidate}>
                    {LOCALE_LABELS[candidate]}
                  </option>
                ))}
              </Select>
              <p className="text-muted-foreground text-xs">{t.profile.languageHint}</p>
            </div>
          </section>

          <section className="surface-card flex flex-col gap-5 rounded-xl p-5">
            <div className="flex flex-col gap-1">
              <h3>{t.profile.appearance}</h3>
              <p className="text-muted-foreground text-xs">{t.profile.appearanceHint}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>{t.profile.theme}</Label>
              <div className="grid grid-cols-3 gap-2">
                {THEME_MODES.map((mode) => (
                  <OptionTile
                    key={mode}
                    selected={appearance.themeMode === mode}
                    onSelect={() => setAppearance({ themeMode: mode })}
                    label={t.profile.themeModes[mode]}
                  >
                    <ThemePreview mode={mode} />
                  </OptionTile>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>{t.profile.accent}</Label>
              <div className="flex items-center gap-2.5 py-1">
                {ACCENTS.map((accent) => {
                  const selected = appearance.accent === accent;
                  return (
                    <button
                      key={accent}
                      type="button"
                      title={t.profile.accentNames[accent]}
                      aria-label={t.profile.accentNames[accent]}
                      aria-pressed={selected}
                      onClick={() => setAppearance({ accent })}
                      className={`ease-out-spring border-foreground/10 focus-visible:ring-ring/50 flex size-8 items-center justify-center rounded-full border outline-none transition-[transform,box-shadow] duration-150 focus-visible:ring-3 active:scale-95 ${
                        selected
                          ? "ring-ring ring-offset-card ring-2 ring-offset-2"
                          : "hover:scale-110"
                      }`}
                      style={{ backgroundColor: ACCENT_SWATCHES[accent] }}
                    >
                      {selected ? <CheckIcon className="size-3.5 text-white" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>{t.profile.font}</Label>
              <div className="grid grid-cols-3 gap-2">
                {UI_FONTS.map((font) => (
                  <OptionTile
                    key={font}
                    selected={appearance.font === font}
                    onSelect={() => setAppearance({ font })}
                    label={t.profile.fontNames[font]}
                  >
                    <span
                      aria-hidden
                      className="text-foreground flex h-14 items-center justify-center text-2xl leading-none font-medium"
                      style={{ fontFamily: FONT_PREVIEW_STACKS[font] }}
                    >
                      Ag
                    </span>
                  </OptionTile>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>{t.profile.textSize}</Label>
              <div className="grid grid-cols-3 gap-2">
                {TEXT_SIZES.map((size) => (
                  <OptionTile
                    key={size}
                    selected={appearance.textSize === size}
                    onSelect={() => setAppearance({ textSize: size })}
                    label={t.profile.textSizeNames[size]}
                  >
                    {/* items-end so the three As share a baseline and read as a scale */}
                    <span
                      aria-hidden
                      className={`text-foreground flex h-14 items-end justify-center pb-3 leading-none font-medium ${TEXT_SIZE_SPECIMEN[size]}`}
                    >
                      A
                    </span>
                  </OptionTile>
                ))}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
