"use client";

import { Button } from "@kherad/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kherad/ui/components/ui/dropdown-menu";
import {
  CheckIcon,
  ChevronDownIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  SearchIcon,
  SparklesIcon,
  UploadIcon,
  UserCogIcon,
  UserIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { NotificationBell } from "@/components/layout/notification-bell";
import { SearchModal } from "@/components/search/search-modal";
import { clearToken, fetchCurrentUser, getToken, logout, type AuthedUser } from "@/lib/api-client";
import { LOCALE_LABELS, LOCALES } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Signed-out visitors still get a language switch (public bundles are readable anonymously). */
function LanguageMenu() {
  const { locale, setLocale, t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t.header.language}
        className="text-muted-foreground hover:bg-muted/60 hover:text-foreground flex size-8 items-center justify-center rounded-full transition-colors duration-150"
      >
        <GlobeIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {LOCALES.map((candidate) => (
          <DropdownMenuItem key={candidate} onClick={() => setLocale(candidate)}>
            <CheckIcon className={`size-3.5 ${candidate === locale ? "" : "invisible"}`} />
            <span lang={candidate}>{LOCALE_LABELS[candidate]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { t, locale, setLocale } = useI18n();
  const [user, setUser] = useState<AuthedUser | null>(null);
  // Must start `false` on both server and client — seeding this from
  // `getToken()` (localStorage) caused a hydration mismatch, since SSR always
  // sees no `window` while the client's first render already sees the real
  // token, so the two initial renders disagreed on this branch.
  const [loaded, setLoaded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // The account's saved language is applied once per mount — after that the
  // user's in-session choices (profile settings write straight to context)
  // must not be fought by re-fetches on navigation.
  const appliedAccountLocale = useRef(false);

  useEffect(() => {
    if (!user) return;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = getToken();
      if (!token) {
        if (!cancelled) setLoaded(true);
        return;
      }
      try {
        const current = await fetchCurrentUser();
        if (!cancelled) {
          setUser(current);
          if (!appliedAccountLocale.current) {
            appliedAccountLocale.current = true;
            if (current.locale !== locale) setLocale(current.locale);
          }
        }
      } catch {
        // Stale/expired token — treat as signed out rather than erroring the whole header.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  async function handleSignOut() {
    await logout().catch(() => undefined);
    await clearToken();
    setUser(null);
    router.push("/login");
  }

  const navLinks: Array<{ href: string; label: string; icon: LucideIcon }> = [
    { href: "/dashboard", label: t.header.dashboard, icon: LayoutDashboardIcon },
    { href: "/agents", label: t.header.agents, icon: SparklesIcon },
    { href: "/ingest", label: t.header.ingest, icon: UploadIcon },
    ...(user?.isAdmin
      ? [{ href: "/admin", label: t.header.admin, icon: UserCogIcon }]
      : []),
  ];

  return (
    <header className="border-border bg-background sticky top-0 z-40 flex h-14 items-center justify-between gap-4 border-b px-4 sm:px-6">
      <div className="flex items-center gap-4">
        <Link
          href={user ? "/dashboard" : "/"}
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <span className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md text-[0.7rem] font-bold shadow-sm">
            K
          </span>
          {t.common.appName}
        </Link>
        {user ? (
          <nav className="flex items-center gap-1 text-sm">
            {navLinks.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors duration-150 ${
                    active
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  {link.label}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </div>

      {loaded ? (
        user ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="border-input bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors duration-150"
            >
              <SearchIcon className="size-3.5" />
              <span className="hidden sm:inline">{t.header.search}</span>
              <kbd
                dir="ltr"
                className="border-border bg-muted text-muted-foreground hidden rounded border px-1.5 py-0.5 font-sans text-[0.65rem] sm:inline"
              >
                {IS_MAC ? "⌘K" : "Ctrl K"}
              </kbd>
            </button>

            <NotificationBell />

            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t.header.openMenu}
                className="hover:bg-muted/60 flex items-center gap-2 rounded-full py-1 pe-2 ps-1 text-sm transition-colors duration-150"
              >
                <span className="bg-primary/12 text-primary flex size-7 items-center justify-center rounded-full text-xs font-semibold">
                  {user.displayName.trim().charAt(0).toUpperCase() || "?"}
                </span>
                <span className="text-muted-foreground hidden max-w-36 truncate sm:inline">
                  {user.displayName}
                </span>
                <ChevronDownIcon className="text-muted-foreground size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-48">
                <div className="px-2 py-1.5">
                  <p className="truncate text-sm font-medium">{user.displayName}</p>
                  <p className="text-muted-foreground truncate text-xs" dir="ltr">
                    {user.email}
                  </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href="/profile" />}>
                  <UserIcon className="text-muted-foreground size-4" />
                  {t.header.profile}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
                  <LogOutIcon className="size-4" />
                  {t.common.signOut}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <LanguageMenu />
            <Button size="sm" nativeButton={false} render={<Link href="/login" />}>
              {t.common.signIn}
            </Button>
          </div>
        )
      ) : null}

      {user ? <SearchModal open={searchOpen} onOpenChange={setSearchOpen} /> : null}
    </header>
  );
}
