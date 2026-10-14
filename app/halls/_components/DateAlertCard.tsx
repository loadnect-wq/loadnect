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
import {
  browserPushSupport,
  currentPushSubscription,
  readStoredList,
  subscribeThisBrowser,
  writeStoredList,
} from "@/lib/push-client";

type State =
  | "checking" | "unsupported" | "ios-add-to-home-screen" | "ios-update"
  | "blocked" | "idle" | "working" | "on" | "error";

// The browser half of push lives in lib/push-client.ts, shared with event plan
// reminders. Which alerts this browser set is kept in localStorage for the
// button's state only; the server row is the truth.
const readStored = () => readStoredList(ALERTS_STORAGE_KEY);
const writeStored = (list: string[]) => writeStoredList(ALERTS_STORAGE_KEY, list);

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
    const support = browserPushSupport();
    if (support !== "supported") settle(support);
    else if (Notification.permission === "denied") settle("blocked");
    else if (!readStored().includes(key)) settle("idle");
    else currentPushSubscription().then((sub) => settle(sub ? "on" : "idle")).catch(() => settle("idle"));
    return () => { cancelled = true; };
  }, [key]);

  async function turnOn() {
    setState("working");
    setError("");
    try {
      const sub = await subscribeThisBrowser(publicKey);
      if (!sub.ok) {
        setState(sub.permission === "denied" ? "blocked" : "idle");
        return;
      }
      const res = await subscribeDateAlert({
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
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
      const sub = await currentPushSubscription();
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
      ) : state === "ios-add-to-home-screen" ? (
        <div className="mt-2 text-xs text-charcoal-700">
          <p className="font-semibold text-charcoal-900">On iPhone, alerts work from your Home Screen:</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4">
            <li>Open this page in Safari.</li>
            <li>Tap Share, then Add to Home Screen.</li>
            <li>Open Hallnect from your Home Screen, search this date again and tap the alert button.</li>
          </ol>
        </div>
      ) : state === "ios-update" ? (
        <p className="mt-2 text-xs text-charcoal-600">
          Alerts on iPhone need iOS 16.4 or later. Update your iPhone in Settings, then try again.
        </p>
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
