import { cookies } from "next/headers";

import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from "./config";
import { DICTIONARIES, type Dictionary } from "./dictionaries";

/** Resolve the active locale dictionary for Server Components. */
export async function getDictionary(): Promise<Dictionary> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  return DICTIONARIES[locale];
}
