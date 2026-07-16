"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ACCENT_COOKIE,
  applyAppearanceToRoot,
  FONT_COOKIE,
  persistAppearanceCookie,
  TEXT_SIZE_COOKIE,
  THEME_COOKIE,
  type Appearance,
} from "./config";

type AppearanceContextValue = {
  appearance: Appearance;
  /**
   * Applies a change client-side without a reload: updates `<html>` in place
   * and persists the cookie so the next SSR render matches. `system` mode
   * additionally tracks the OS theme live via `matchMedia`.
   */
  setAppearance: (patch: Partial<Appearance>) => void;
};

const COOKIE_FOR_KEY: Record<keyof Appearance, string> = {
  themeMode: THEME_COOKIE,
  accent: ACCENT_COOKIE,
  font: FONT_COOKIE,
  textSize: TEXT_SIZE_COOKIE,
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function AppearanceProvider({
  initialAppearance,
  children,
}: {
  initialAppearance: Appearance;
  children: React.ReactNode;
}) {
  const [appearance, setAppearanceState] = useState<Appearance>(initialAppearance);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ease the dark↔light brightness jump: enable color transitions on the root
  // just for the flip, then remove them so normal interactions stay snappy.
  // The CSS side is gated behind `prefers-reduced-motion: no-preference`.
  const easeThemeFlip = useCallback(() => {
    const root = document.documentElement;
    root.classList.add("theme-transitioning");
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    transitionTimer.current = setTimeout(() => {
      root.classList.remove("theme-transitioning");
    }, 300);
  }, []);

  const setAppearance = useCallback(
    (patch: Partial<Appearance>) => {
      setAppearanceState((previous) => {
        const next = { ...previous, ...patch };
        const wasDark = document.documentElement.classList.contains("dark");
        const willBeDark =
          next.themeMode === "dark" || (next.themeMode === "system" && prefersDark());
        if (wasDark !== willBeDark) easeThemeFlip();
        applyAppearanceToRoot(next, prefersDark());
        for (const key of Object.keys(patch) as (keyof Appearance)[]) {
          persistAppearanceCookie(COOKIE_FOR_KEY[key], next[key]);
        }
        return next;
      });
    },
    [easeThemeFlip],
  );

  // In `system` mode, follow the OS theme while the app is open.
  useEffect(() => {
    if (appearance.themeMode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      easeThemeFlip();
      applyAppearanceToRoot(appearance, media.matches);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [appearance, easeThemeFlip]);

  const value = useMemo<AppearanceContextValue>(
    () => ({ appearance, setAppearance }),
    [appearance, setAppearance],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) {
    throw new Error("useAppearance must be used inside <AppearanceProvider>");
  }
  return context;
}
