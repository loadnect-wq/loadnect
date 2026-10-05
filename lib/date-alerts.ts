// ─────────────────────────────────────────────────────────────────────────────
// lib/date-alerts.ts — "tell me if a hall frees up on my date". Shared rules,
// safe for the client. The server half is lib/date-alerts.server.ts; the
// schema is supabase/migrations/0108_date_alerts.sql.
//
// A date search hides every hall with a full-day booking that day. When some
// are hidden, the search page offers a browser alert: if one of those
// bookings is removed, this browser hears which hall no longer has the date
// booked. Web push, not SMS — no account, no phone number, no DLT template.
//
// THE ALERT NEVER SAYS "FREE". It says the hall no longer has the date booked
// ON HALLNECT, and that the hall confirms the date — the same sentence the
// search page uses, because a hall that keeps part of its diary on paper may
// still be taken.
// ─────────────────────────────────────────────────────────────────────────────

import { formatDiaryDay } from "@/lib/diary";

/**
 * The push services a browser may hand us. The server will only ever POST to
 * these: without the allowlist, anyone could store an arbitrary https URL and
 * have the cron send requests to it.
 *
 *   fcm.googleapis.com                 Chrome, Edge on Android, Samsung Internet, Opera
 *   updates.push.services.mozilla.com  Firefox
 *   web.push.apple.com                 Safari (macOS, and iOS home-screen apps)
 *   *.notify.windows.com               Edge on Windows
 */
const PUSH_HOSTS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);
const PUSH_HOST_SUFFIXES = [".notify.windows.com", ".push.apple.com"];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s));
}

/** One browser can watch this many dates at once. */
export const MAX_ALERTS_PER_BROWSER = 10;

/** How far ahead an alert may be set: about eighteen months, the muhurtham list's reach. */
export const ALERT_HORIZON_DAYS = 550;

/** What the notification says. Kept short: Android truncates the body at about two lines. */
export function alertMessage(hall: { id: string; name: string; slug: string }, dateIso: string) {
  const day = formatDiaryDay("en", dateIso);
  return {
    title: `${hall.name} · ${day}`,
    body: "This hall no longer has your date booked on Hallnect. Tap to see it. The hall confirms your date with you.",
    url: `/halls/${hall.slug}`,
    // Same hall and date collapse into one notification if it is ever sent twice.
    tag: `date-alert-${hall.id}-${dateIso}`,
  };
}

/** The search page's sentence above the button. Booked, never "taken" or "full". */
export function bookedSentence(count: number, dateLabel: string, city: string | null): string {
  const where = city ? ` in ${city}` : "";
  return count === 1
    ? `1 hall${where} already has ${dateLabel} booked.`
    : `${count} halls${where} already have ${dateLabel} booked.`;
}

/** localStorage key holding the alerts this browser has set, for the button's state only. */
export const ALERTS_STORAGE_KEY = "hallnect:date-alerts";

export function alertKey(date: string, city: string | null): string {
  return `${date}|${city ?? ""}`;
}

/**
 * What this browser can do about an alert.
 *
 * iPHONE IS NOT "UNSUPPORTED". Safari on iPhone and iPad (iOS 16.4 and later)
 * delivers web push, but only to a site opened from the Home Screen — in a
 * browser tab PushManager simply does not exist. So an iPhone visitor is told
 * how to get there instead of being told it cannot work; /halls carries the
 * manifest that makes "Add to Home Screen" open as an app.
 */
export type PushSupport = "supported" | "ios-add-to-home-screen" | "ios-update" | "unsupported";

export function pushSupportFor(env: { hasPush: boolean; ios: boolean; standalone: boolean }): PushSupport {
  if (env.hasPush) return "supported";
  if (!env.ios) return "unsupported";
  // Already on the Home Screen and still no push: an iOS older than 16.4.
  return env.standalone ? "ios-update" : "ios-add-to-home-screen";
}

/** iPhone, iPod, or an iPad (which reports itself as a Mac with a touch screen). */
export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}
