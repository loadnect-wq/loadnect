"use client";

import { useState, useTransition } from "react";
import { Banknote, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { connectPayoutAccount } from "@/app/owner/(dashboard)/actions";

// ─────────────────────────────────────────────────────────────────────────────
// Automatic payout setup.
//
// Once connected, the customer's advance is split the moment the owner ACCEPTS
// a booking: Hallnect keeps its 5% commission and the rest settles here. Until
// Cashfree has cleared the owner's KYC, no money can move — so this card states
// the real status rather than implying it is ready.
// ─────────────────────────────────────────────────────────────────────────────

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

  const missing = [
    !hasBank && "payout bank account + IFSC",
    !hasPan && "PAN",
    !hasPhone && "business phone",
  ].filter(Boolean) as string[];

  const verified = kycStatus === "VERIFIED";
  const pendingKyc = !!vendorId && !verified;

  function connect() {
    setError(null);
    start(async () => {
      const result = await connectPayoutAccount();
      if ("error" in result) setError(result.error);
      else setDone(true);
    });
  }

  const tone = verified
    ? "border-green-200 bg-green-50"
    : pendingKyc
      ? "border-amber-200 bg-amber-50"
      : "border-border bg-white";

  return (
    <div className={`rounded-2xl border-2 p-5 ${tone}`}>
      <div className="flex items-start gap-3">
        {verified ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
          : pendingKyc ? <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          : <Banknote className="mt-0.5 h-5 w-5 shrink-0 text-charcoal-400" />}

        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-sm font-semibold text-charcoal-900">
            Automatic payouts
          </h3>

          <p className="mt-0.5 text-xs leading-relaxed text-charcoal-600">
            {verified
              ? "Connected. When you accept a booking, the customer's advance is paid to you automatically — minus Hallnect's 5% commission, which is deducted at the same time. You never receive a separate commission bill."
              : pendingKyc
                ? "Your payout account is registered and awaiting verification by Cashfree. Once verified, accepted bookings pay out automatically."
                : "Connect a payout account so accepted bookings pay you automatically. Hallnect's 5% commission is deducted from the advance, so you never get a separate bill."}
          </p>

          {missing.length > 0 && !verified && (
            <p className="mt-2 rounded-lg bg-white/70 p-2 text-[11px] text-charcoal-700">
              Add your <strong>{missing.join(", ")}</strong> in Business Details below first —
              Cashfree requires these to verify a payout account.
            </p>
          )}

          {lastError && !verified && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 p-2 text-[11px] text-red-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {lastError}
            </p>
          )}

          {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
          {done && !error && (
            <p className="mt-2 text-[11px] font-semibold text-green-700">
              Submitted — reload to see the latest verification status.
            </p>
          )}

          {!verified && (
            <button
              type="button"
              onClick={connect}
              disabled={pending || missing.length > 0}
              className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-maroon-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-maroon-700 disabled:opacity-50"
            >
              <Banknote className="h-4 w-4" />
              {pending ? "Connecting…" : vendorId ? "Refresh payout status" : "Connect payout account"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
