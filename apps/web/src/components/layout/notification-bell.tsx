"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kherad/ui/components/ui/dropdown-menu";
import { BellIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

const POLL_INTERVAL_MS = 30_000;

function notificationHref(notification: Notification): string {
  return notification.mrId
    ? `/bundles/${notification.bundleId}/merge-requests/${notification.mrId}`
    : `/admin/merge-requests`;
}

export function NotificationBell() {
  const { t, locale } = useI18n();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const list = await fetchNotifications();
        if (!cancelled) setNotifications(list);
      } catch {
        // Best-effort — a failed poll just leaves the previous list showing.
      }
    }

    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  async function handleSelect(notification: Notification) {
    if (notification.readAt) return;
    setNotifications((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    try {
      await markNotificationRead(notification.id);
    } catch {
      // Best-effort — the next poll will reconcile if this failed.
    }
  }

  async function handleMarkAllRead() {
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    try {
      await markAllNotificationsRead();
    } catch {
      // Best-effort — the next poll will reconcile if this failed.
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t.header.notifications}
        className="text-muted-foreground hover:bg-muted/60 hover:text-foreground relative flex size-8 items-center justify-center rounded-full transition-colors duration-150"
      >
        <BellIcon className="size-4" />
        {unreadCount > 0 ? (
          <span className="bg-primary text-primary-foreground absolute -top-0.5 -end-0.5 flex size-4 items-center justify-center rounded-full text-[0.6rem] font-semibold tabular-nums">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80" align="end">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <p className="text-sm font-medium">{t.header.notifications}</p>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="text-primary hover:underline text-xs font-medium"
            >
              {t.header.markAllRead}
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <p className="text-muted-foreground px-2 py-3 text-center text-sm">
            {t.header.noNotifications}
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {notifications.map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                render={<Link href={notificationHref(notification)} />}
                onClick={() => void handleSelect(notification)}
                className="flex flex-col items-start gap-0.5 whitespace-normal"
              >
                <span className="flex w-full items-start gap-2">
                  {!notification.readAt ? (
                    <span className="bg-primary mt-1.5 size-1.5 shrink-0 rounded-full" aria-hidden />
                  ) : (
                    <span className="mt-1.5 size-1.5 shrink-0" aria-hidden />
                  )}
                  <span dir="auto">{notification.body}</span>
                </span>
                <span className="text-muted-foreground ps-3.5 text-xs">
                  {new Date(notification.createdAt).toLocaleString(locale)}
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
