"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { dirFor, persistLocaleCookie, type Locale } from "./config";
import { DICTIONARIES, type Dictionary } from "./dictionaries";

type I18nContextValue = {
  locale: Locale;
  dir: "ltr" | "rtl";
  t: Dictionary;
  /**
   * Applies a language client-side without a reload: persists the cookie
   * (so SSR renders match on the next full load) and updates `<html lang dir>`
   * in place. Callers that also want the choice on the user's account go
   * through `updateMyPreferences` in the api-client separately.
   */
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocaleCookie(next);
    document.documentElement.lang = next;
    document.documentElement.dir = dirFor(next);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, dir: dirFor(locale), t: DICTIONARIES[locale], setLocale }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside <LocaleProvider>");
  }
  return context;
}
