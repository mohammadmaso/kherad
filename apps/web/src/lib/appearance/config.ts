/**
 * Per-device appearance preferences (theme mode, accent color, font, text
 * size). Unlike the language preference these are deliberately *not* stored
 * on the user's account — the right theme depends on the device and ambient
 * light, so each browser keeps its own choice. Persistence is readable
 * (non-httpOnly) cookies, mirroring the locale cookie, so Server Components
 * can stamp `<html class/data-*>` before hydration and avoid a flash.
 */

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const ACCENTS = ["default", "forest", "plum", "ember"] as const;
export type Accent = (typeof ACCENTS)[number];

export const UI_FONTS = ["geist", "system", "serif"] as const;
export type UiFont = (typeof UI_FONTS)[number];

export const TEXT_SIZES = ["compact", "default", "comfortable"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export type Appearance = {
  themeMode: ThemeMode;
  accent: Accent;
  font: UiFont;
  textSize: TextSize;
};

export const DEFAULT_APPEARANCE: Appearance = {
  themeMode: "system",
  accent: "default",
  font: "geist",
  textSize: "default",
};

export const THEME_COOKIE = "kherad_theme";
export const ACCENT_COOKIE = "kherad_accent";
export const FONT_COOKIE = "kherad_font";
export const TEXT_SIZE_COOKIE = "kherad_text_size";

export function isThemeMode(value: unknown): value is ThemeMode {
  return THEME_MODES.includes(value as ThemeMode);
}
export function isAccent(value: unknown): value is Accent {
  return ACCENTS.includes(value as Accent);
}
export function isUiFont(value: unknown): value is UiFont {
  return UI_FONTS.includes(value as UiFont);
}
export function isTextSize(value: unknown): value is TextSize {
  return TEXT_SIZES.includes(value as TextSize);
}

/** Swatch colors for the accent picker (light theme `--primary` of each). */
export const ACCENT_SWATCHES: Record<Accent, string> = {
  default: "oklch(0.49 0.16 262)",
  forest: "oklch(0.47 0.12 152)",
  plum: "oklch(0.5 0.15 320)",
  ember: "oklch(0.53 0.13 50)",
};

/**
 * Inline script rendered first in <body> so it runs before paint. SSR can
 * stamp `.dark` for an explicit "dark" cookie, but in "system" mode (or with
 * no cookie) only the browser knows the OS theme — this closes that gap
 * without a light-theme flash.
 */
export const SYSTEM_THEME_NO_FLASH_SCRIPT =
  `(function(){try{` +
  `var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);` +
  `var t=m?m[1]:"system";` +
  `if(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches){document.documentElement.classList.add("dark")}` +
  `}catch(e){}})();`;

export function persistAppearanceCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

/**
 * Applies one appearance value to `<html>` in place (class for dark, data
 * attributes for the rest). Defaults clear their attribute so the base
 * stylesheet applies untouched. Shared by the provider (live changes) and
 * kept in sync with the server render in `app/layout.tsx`.
 */
export function applyAppearanceToRoot(appearance: Appearance, systemPrefersDark: boolean): void {
  const root = document.documentElement;
  const dark =
    appearance.themeMode === "dark" || (appearance.themeMode === "system" && systemPrefersDark);
  root.classList.toggle("dark", dark);

  if (appearance.accent === "default") delete root.dataset.accent;
  else root.dataset.accent = appearance.accent;

  if (appearance.font === "geist") delete root.dataset.font;
  else root.dataset.font = appearance.font;

  if (appearance.textSize === "default") delete root.dataset.textSize;
  else root.dataset.textSize = appearance.textSize;
}
