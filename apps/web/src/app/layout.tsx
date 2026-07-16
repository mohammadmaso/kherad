import type { Metadata } from "next";
import { Geist, Geist_Mono, Vazirmatn } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

import { Header } from "@/components/layout/header";
import {
  ACCENT_COOKIE,
  DEFAULT_APPEARANCE,
  FONT_COOKIE,
  isAccent,
  isTextSize,
  isThemeMode,
  isUiFont,
  SYSTEM_THEME_NO_FLASH_SCRIPT,
  TEXT_SIZE_COOKIE,
  THEME_COOKIE,
  type Appearance,
} from "@/lib/appearance/config";
import { AppearanceProvider } from "@/lib/appearance/provider";
import { DEFAULT_LOCALE, dirFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";
import { LocaleProvider } from "@/lib/i18n/provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Persian UI font — Geist has no Arabic-script glyphs. Loaded for both
// locales so Persian page content renders properly inside the English UI too.
const vazirmatn = Vazirmatn({
  variable: "--font-vazirmatn",
  subsets: ["arabic", "latin"],
});

export const metadata: Metadata = {
  title: "Kherad",
  description: "An internal, git-backed wiki.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  const cookieTheme = cookieStore.get(THEME_COOKIE)?.value;
  const cookieAccent = cookieStore.get(ACCENT_COOKIE)?.value;
  const cookieFont = cookieStore.get(FONT_COOKIE)?.value;
  const cookieTextSize = cookieStore.get(TEXT_SIZE_COOKIE)?.value;
  const appearance: Appearance = {
    themeMode: isThemeMode(cookieTheme) ? cookieTheme : DEFAULT_APPEARANCE.themeMode,
    accent: isAccent(cookieAccent) ? cookieAccent : DEFAULT_APPEARANCE.accent,
    font: isUiFont(cookieFont) ? cookieFont : DEFAULT_APPEARANCE.font,
    textSize: isTextSize(cookieTextSize) ? cookieTextSize : DEFAULT_APPEARANCE.textSize,
  };

  return (
    <html
      lang={locale}
      dir={dirFor(locale)}
      // The pre-paint script (and later the provider) mutates class/data-*
      // on <html> client-side; SSR can't know the OS theme in "system" mode.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${vazirmatn.variable} h-full antialiased${
        appearance.themeMode === "dark" ? " dark" : ""
      }`}
      data-accent={appearance.accent === "default" ? undefined : appearance.accent}
      data-font={appearance.font === "geist" ? undefined : appearance.font}
      data-text-size={appearance.textSize === "default" ? undefined : appearance.textSize}
    >
      <body className="flex min-h-full flex-col">
        <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_NO_FLASH_SCRIPT }} />
        <AppearanceProvider initialAppearance={appearance}>
          <LocaleProvider initialLocale={locale}>
            <Header />
            {children}
          </LocaleProvider>
        </AppearanceProvider>
      </body>
    </html>
  );
}
