// ─────────────────────────────────────────────────────────────────────────────
// lib/push-client.ts — the browser half of web push, shared by date alerts
// (app/halls/_components/DateAlertCard.tsx) and event plan reminders
// (components/plan/PlanReminders.tsx). CLIENT-ONLY: call these from event
// handlers and effects, never during render.
//
// One service worker (public/sw.js, scope "/") and one push subscription per
// browser carry every Hallnect notification. Turning one feature off removes
// that feature's server row and never unsubscribes the browser, because the
// same subscription may be carrying the other feature's notifications.
// ─────────────────────────────────────────────────────────────────────────────

import { isIosDevice, pushSupportFor, type PushSupport } from "@/lib/date-alerts";

export function base64UrlToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** What this browser can do: push, or which iPhone step stands in the way. */
export function browserPushSupport(): PushSupport {
  return pushSupportFor({
    hasPush: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    ios: isIosDevice(navigator.userAgent, navigator.platform ?? "", navigator.maxTouchPoints ?? 0),
    standalone:
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  });
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Asks for permission, registers the worker and returns this browser's push
 * subscription under `publicKey`. "denied" or "default" when the person did not
 * allow notifications. Throws on any other failure.
 */
export async function subscribeThisBrowser(
  publicKey: string,
): Promise<{ ok: true; endpoint: string; p256dh?: string; auth?: string } | { ok: false; permission: NotificationPermission }> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, permission };
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const options = { userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) };
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe(options);
  } else {
    // A subscription made under an older key cannot be reused once the key
    // changes; replace it.
    try {
      sub = await reg.pushManager.subscribe(options);
    } catch {
      await sub.unsubscribe();
      sub = await reg.pushManager.subscribe(options);
    }
  }
  const json = sub.toJSON();
  return { ok: true, endpoint: json.endpoint ?? sub.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth };
}

/** A small list in localStorage, for a card's on/off state only. The server row is the truth. */
export function readStoredList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export function writeStoredList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(-20)));
  } catch {
    /* private window: notifications still work, the card just forgets */
  }
}
