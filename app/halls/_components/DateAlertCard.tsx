"use client";

// ─────────────────────────────────────────────────────────────────────────────
// "Tell me if one frees up." Shown on a date search when some halls are hidden
// because they already have that date booked. One tap asks the browser for
// permission, subscribes it to push, and saves the alert — no account, no
// phone number. See lib/date-alerts.ts for the rules and what is stored.
//
// Nothing happens on page load: the service worker is registered only when the
// family taps the button, so a visitor who never asks for an alert never gets
// a worker installed.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { subscribeDateAlert, unsubscribeDateAlert } from "../date-alert-actions";
import { ALERTS_STORAGE_KEY, alertKey } from "@/lib/date-alerts";

type State = "checking" | "unsupported" | "blocked" | "idle" | "working" | "on" | "error";

function base64UrlToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Which alerts this browser set, for the button's state only. The server row
// is the truth; this just lets the page say "Alert on" without a round trip.
function readStored(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(ALERTS_STORAGE_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function writeStored(list: string[]) {
  try {
    localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(list.slice(-20)));
  } catch {
    /* private window: the alert still works, the button just forgets */
  }
}

function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export function DateAlertCard({
  date,
  city,
  sentence,
  dateLabel,
  publicKey,
}: {
  date: string;
  city: string | null;
  /** "2 halls in Madurai already have Thu, 12 Nov booked." */
  sentence: string;
  dateLabel: string;
  publicKey: string;
}) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState("");
  const key = alertKey(date, city);

  useEffect(() => {
    let cancelled = false;
    const settle = (s: State) => { if (!cancelled) setState(s); };
    if (!pushSupported()) settle("unsupported");
    else if (Notification.permission === "denied") settle("blocked");
    else if (!readStored().includes(key)) settle("idle");
    else currentSubscription().then((sub) => settle(sub ? "on" : "idle")).catch(() => settle("idle"));
    return () => { cancelled = true; };
  }, [key]);

  async function turnOn() {
    setState("working");
    setError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "idle");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const options = { userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) };
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe(options);
      } else {
        // A subscription made under an older key cannot be reused once the
        // key changes; replace it.
        try {
          sub = await reg.pushManager.subscribe(options);
        } catch {
          await sub.unsubscribe();
          sub = await reg.pushManager.subscribe(options);
        }
      }
      const json = sub.toJSON();
      const res = await subscribeDateAlert({
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
        date,
        city,
      });
      if (!res.ok) {
        setError(res.error);
        setState("error");
        return;
      }
      writeStored([...readStored().filter((k) => k !== key), key]);
      setState("on");
    } catch {
      setError("Could not set the alert in this browser.");
      setState("error");
    }
  }

  async function turnOff() {
    setState("working");
    try {
      const sub = await currentSubscription();
      // Only this date's row. The browser's push subscription stays: it may be
      // carrying alerts for other dates.
      if (sub) await unsubscribeDateAlert({ endpoint: sub.endpoint, date, city });
    } catch {
      /* the row expires with the date anyway */
    }
    writeStored(readStored().filter((k) => k !== key));
    setState("idle");
  }

  return (
    <div className="mt-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-border" aria-live="polite">
      <p className="text-sm text-charcoal-800">
        <span className="font-semibold">{sentence}</span>{" "}
        {state === "on" ? null : "Want to know if one frees up?"}
      </p>

      {state === "on" ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="flex items-center gap-1.5 text-sm text-charcoal-700">
            <BellRing className="h-4 w-4 shrink-0 text-maroon-700" aria-hidden />
            Alert on. This browser will be told if one frees up on {dateLabel}.
          </p>
          <button
            type="button"
            onClick={turnOff}
            className="min-h-[44px] text-sm font-semibold text-maroon-700 hover:underline"
          >
            Turn off
          </button>
        </div>
      ) : state === "unsupported" ? (
        <p className="mt-2 text-xs text-charcoal-600">
          This browser can&apos;t receive Hallnect alerts. Chrome on Android or on a computer can.
        </p>
      ) : state === "blocked" ? (
        <p className="mt-2 text-xs text-charcoal-600">
          Notifications are blocked for Hallnect in this browser. Allow them in the site settings to set an alert.
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={turnOn}
            disabled={state === "checking" || state === "working"}
            className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white hover:bg-maroon-800 disabled:opacity-60"
          >
            <Bell className="h-4 w-4" aria-hidden />
            {state === "working" ? "Setting the alert…" : "Alert me if one frees up"}
          </button>
          <p className="mt-2 text-xs text-charcoal-600">
            {state === "error"
              ? error
              : "A notification in this browser. No sign-up and no phone number."}
          </p>
        </>
      )}
    </div>
  );
}
