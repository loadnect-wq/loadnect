"use client";

// ─────────────────────────────────────────────────────────────────────────────
// "Reminders on this phone" on an event plan (0116). One tap asks for
// notification permission, subscribes this browser to push and records it
// against this plan for the signed-in person. Every member chooses for their
// own phone. What is sent, and when, is lib/plan-reminders.ts.
//
// Nothing happens on page load beyond reading this browser's state: the
// service worker is registered only when the person taps the button.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { subscribePlanReminders, unsubscribePlanReminders } from "@/app/plan/reminder-actions";
import { REMINDER_LEAD_DAYS, REMINDERS_STORAGE_KEY } from "@/lib/plan-reminders";
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

const readStored = () => readStoredList(REMINDERS_STORAGE_KEY);
const writeStored = (list: string[]) => writeStoredList(REMINDERS_STORAGE_KEY, list);

export function PlanReminders({ planId, publicKey }: { planId: string; publicKey: string }) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const settle = (s: State) => { if (!cancelled) setState(s); };
    const support = browserPushSupport();
    if (support !== "supported") settle(support);
    else if (Notification.permission === "denied") settle("blocked");
    else if (!readStored().includes(planId)) settle("idle");
    else currentPushSubscription().then((sub) => settle(sub ? "on" : "idle")).catch(() => settle("idle"));
    return () => { cancelled = true; };
  }, [planId]);

  async function turnOn() {
    setState("working");
    setError("");
    try {
      const sub = await subscribeThisBrowser(publicKey);
      if (!sub.ok) {
        setState(sub.permission === "denied" ? "blocked" : "idle");
        return;
      }
      const res = await subscribePlanReminders({ planId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth });
      if (!res.ok) {
        setError(res.error);
        setState("error");
        return;
      }
      writeStored([...readStored().filter((k) => k !== planId), planId]);
      setState("on");
    } catch {
      setError("Could not turn reminders on in this browser.");
      setState("error");
    }
  }

  async function turnOff() {
    setState("working");
    try {
      const sub = await currentPushSubscription();
      // Only this plan's row. The browser's push subscription stays: it may be
      // carrying other plans' reminders or a date alert.
      if (sub) await unsubscribePlanReminders({ planId, endpoint: sub.endpoint });
    } catch {
      /* removed with the plan, or after the function, anyway */
    }
    writeStored(readStored().filter((k) => k !== planId));
    setState("idle");
  }

  return (
    <section aria-labelledby="reminders-heading" className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border" aria-live="polite">
      <h2 id="reminders-heading" className="text-base font-bold text-charcoal-900">Reminders</h2>

      {state === "on" ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="flex items-center gap-1.5 text-sm text-charcoal-700">
            <BellRing className="h-4 w-4 shrink-0 text-maroon-700" aria-hidden />
            On for this phone. You&apos;ll get a notification the morning something is due.
          </p>
          <button type="button" onClick={turnOff} className="min-h-[44px] text-sm font-semibold text-maroon-700 hover:underline">
            Turn off
          </button>
        </div>
      ) : (
        <>
          <p className="mt-0.5 text-xs text-charcoal-600">
            A notification on this phone the morning a payment or a checklist task is due, and {REMINDER_LEAD_DAYS} days
            before a payment. Nothing on quiet days. Only you get it; each person in the family turns it on for their own
            phone.
          </p>

          {state === "ios-add-to-home-screen" ? (
            <div className="mt-2 text-xs text-charcoal-700">
              <p className="font-semibold text-charcoal-900">On iPhone, reminders work from your Home Screen:</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                <li>Open this page in Safari.</li>
                <li>Tap Share, then Add to Home Screen.</li>
                <li>Open Hallnect from your Home Screen, open this plan and turn reminders on.</li>
              </ol>
            </div>
          ) : state === "ios-update" ? (
            <p className="mt-2 text-xs text-charcoal-600">
              Reminders on iPhone need iOS 16.4 or later. Update your iPhone in Settings, then try again.
            </p>
          ) : state === "unsupported" ? (
            <p className="mt-2 text-xs text-charcoal-600">
              This browser can&apos;t receive Hallnect reminders. Chrome on Android or on a computer can.
            </p>
          ) : state === "blocked" ? (
            <p className="mt-2 text-xs text-charcoal-600">
              Notifications are blocked for Hallnect in this browser. Allow them in the site settings to turn reminders on.
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
                {state === "working" ? "Turning on…" : "Turn on reminders"}
              </button>
              {state === "error" && <p className="mt-2 text-xs text-red-700">{error}</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}
