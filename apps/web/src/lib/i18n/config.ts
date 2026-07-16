export const LOCALES = ["en", "fa"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/**
 * Readable (non-httpOnly) cookie mirroring the viewer's language, so Server
 * Components can set `<html lang dir>` before hydration and anonymous
 * visitors keep their choice. Signed-in users' source of truth is
 * `users.locale` in Postgres; the cookie is synced from it on login and on
 * every preference change.
 */
export const LOCALE_COOKIE = "kherad_locale";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  fa: "فارسی",
};

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

export function dirFor(locale: Locale): "ltr" | "rtl" {
  return locale === "fa" ? "rtl" : "ltr";
}

export function persistLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}
