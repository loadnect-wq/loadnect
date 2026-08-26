"use client";

import { useState, useTransition } from "react";
import { Banknote, CheckCircle2, Clock, AlertTriangle, ArrowDown } from "lucide-react";
import { connectPayoutAccount, refreshPayoutStatus } from "@/app/owner/(dashboard)/actions";

// ─────────────────────────────────────────────────────────────────────────────
// Automatic payout setup.
//
// Once connected, the customer's advance is split the moment the owner ACCEPTS
// a booking: Hallnect keeps its commission on that advance and the rest settles
// here. Until Cashfree has verified the owner's account, no money can move — so
// this card states the real status rather than implying it is ready.
//
// UX NOTE: the button used to be DISABLED whenever a required field was
// missing, with prose telling the owner to look "below". Owners reasonably read
// a greyed-out button as broken software. It is now always clickable: it either
// starts onboarding, or scrolls to the exact field that is missing and
// highlights it. A control that explains itself beats one that refuses to
// respond.
// ─────────────────────────────────────────────────────────────────────────────

/** id of the Business Details section — the scroll target for missing fields. */
export const BUSINESS_DETAILS_ID = "business-details";

export function PayoutSetup({
  vendorId,
  kycStatus,
  lastError,
  hasBank,
  hasPan,
  hasPhone,
}: {
  vendorId: string | null;
  kycStatus: string | null;
  lastError: string | null;
  hasBank: boolean;
  hasPan: boolean;
  hasPhone: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const checklist = [
    { label: "Payout bank account + IFSC", ok: hasBank },
    { label: "PAN",                        ok: hasPan },
    { label: "Business phone",             ok: hasPhone },
  ];
  const missing = checklist.filter((c) => !c.ok);

  const verified = kycStatus === "VERIFIED";
  const awaitingKyc = !!vendorId && !verified;

  function jumpToDetails() {
    const el = document.getElementById(BUSINESS_DETAILS_ID);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Briefly outline the section so it is obvious where to type.
    el.classList.add("ring-2", "ring-maroon-400", "ring-offset-2");
    window.setTimeout(
      () => el.classList.remove("ring-2", "ring-maroon-400", "ring-offset-2"),
      2200,
    );
    el.querySelector<HTMLInputElement>("input:not([disabled])")?.focus({ preventScroll: true });
  }

  function handleClick() {
    if (missing.length > 0) { jumpToDetails(); return; }
    setError(null);
    start(async () => {
      // Already registered → this is a status check, not a re-registration.
      // Reading a verification status must not resend PAN and bank details.
      const result = vendorId ? await refreshPayoutStatus() : await connectPayoutAccount();
      if ("error" in result) setError(result.error);
      else setDone(true);
    });
  }

  const tone = verified
    ? "border-green-200 bg-green-50"
    : awaitingKyc
      ? "border-amber-200 bg-amber-50"
      : "border-border bg-white";

  return (
    <div className={`rounded-2xl border-2 p-5 ${tone}`}>
      <div className="flex items-start gap-3">
        {verified ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
          : awaitingKyc ? <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          : <Banknote className="mt-0.5 h-5 w-5 shrink-0 text-charcoal-400" />}

        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-sm font-semibold text-charcoal-900">Automatic payouts</h3>

          <p className="mt-0.5 text-xs leading-relaxed text-charcoal-600">
            {verified
              ? "Connected. When you accept a booking, the customer's advance is paid to you automatically — minus Hallnect's commission (a percentage of the hall price), which is deducted at the same time. You never receive a separate commission bill."
              : awaitingKyc
                ? "Your payout account is registered and awaiting verification by Cashfree. Once verified, accepted bookings pay out automatically."
                : "Connect a payout account so accepted bookings pay you automatically. Hallnect's commission (a percentage of the hall price) is deducted from the advance, so you never get a separate bill."}
          </p>

          {/* Explicit checklist: what is done and what is not, at a glance. */}
          {!verified && (
            <ul className="mt-3 space-y-1">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-center gap-2 text-[11px]">
                  {c.ok
                    ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />
                    : <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-charcoal-300" />}
                  <span className={c.ok ? "text-charcoal-500 line-through" : "font-medium text-charcoal-800"}>
                    {c.label}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* One error, not two. `error` is this attempt's result; `lastError`
              is the stored outcome of the previous one — when an attempt has
              just failed they are the same string, and rendering both made the
              card look broken. Show the live one when present. */}
          {(error ?? (verified ? null : lastError)) && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 p-2 text-[11px] text-red-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error ?? lastError}
            </p>
          )}
          {done && !error && (
            <p className="mt-2 text-[11px] font-semibold text-green-700">
              {vendorId
                ? "Status checked — reload to see the latest verification status."
                : "Submitted — reload to see the latest verification status."}
            </p>
          )}

          {!verified && (
            <button
              type="button"
              onClick={handleClick}
              disabled={pending}
              className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-maroon-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-maroon-700 disabled:opacity-60"
            >
              {missing.length > 0 ? (
                <><ArrowDown className="h-4 w-4" /> Add {missing[0].label.toLowerCase()}</>
              ) : (
                <><Banknote className="h-4 w-4" />
                  {pending ? "Connecting…" : vendorId ? "Refresh payout status" : "Connect payout account"}</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
