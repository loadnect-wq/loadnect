"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { cancelBooking } from "@/app/customer/actions";
import { customerRefundPercent, daysUntilEventFromToday } from "@/lib/refund-schedule";
import { formatPrice } from "@/lib/mock-data";

export function CancelButton({
  bookingId,
  eventDate,
  todayIso,
  advancePaid,
  platformFeePaid,
}: {
  bookingId: string;
  /** YYYY-MM-DD. Omit and the dialog simply says nothing about the amount. */
  eventDate?: string | null;
  todayIso?: string | null;
  advancePaid?: number | null;
  platformFeePaid?: number | null;
}) {
  const router = useRouter();
  const [phase, setPhase]   = useState<"idle" | "confirm" | "loading">("idle");
  const [error, setError]   = useState<string | null>(null);

  async function handleConfirm() {
    setPhase("loading");
    setError(null);
    const result = await cancelBooking(bookingId);
    if ("error" in result) {
      setError(result.error);
      setPhase("confirm");
    } else {
      router.refresh();
    }
  }

  // null when the caller did not pass enough to compute it — say nothing
  // rather than guess at someone's money.
  const refund = (() => {
    if (!eventDate || !todayIso || advancePaid == null) return null;
    const days    = daysUntilEventFromToday(eventDate, todayIso);
    const percent = customerRefundPercent(days);
    const advance = Number(advancePaid) || 0;
    const fee     = Number(platformFeePaid) || 0;
    return { days, percent, advance, fee, amount: Math.floor((advance * percent) / 100) };
  })();

  if (phase === "idle") {
    return (
      <button
        type="button"
        onClick={() => setPhase("confirm")}
        className="text-sm font-medium text-red-600 underline underline-offset-2 hover:text-red-700"
      >
        Cancel this booking
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-red-800">Cancel this booking?</p>
        {/* THE AMOUNT, NOT "if applicable". /cancellation-policy promises in
            writing: "You will be shown the expected refund amount before you
            confirm." Cancelling six days out returns ZERO, and the booking page
            then HIDES the refund row (it renders only refund_amount > 0), so
            the forfeiture was invisible before and after. Computed from the
            same table the server applies, so the two cannot disagree. */}
        {refund === null ? (
          <p className="mt-1 text-xs text-red-700 leading-relaxed">
            This action cannot be undone. Any refund follows our cancellation policy and
            reaches you within 5–7 business days.
          </p>
        ) : refund.amount > 0 ? (
          <p className="mt-1 text-xs text-red-700 leading-relaxed">
            You will get back <strong>{formatPrice(refund.amount)}</strong> — {refund.percent}% of
            your {formatPrice(refund.advance)} advance, because your event is {refund.days} day
            {refund.days === 1 ? "" : "s"} away.
            {refund.fee > 0 && <> The {formatPrice(refund.fee)} platform fee is not refunded.</>}{" "}
            It reaches you within 5–7 business days. This cannot be undone.
          </p>
        ) : (
          <p className="mt-1 text-xs font-semibold text-red-800 leading-relaxed">
            You will get back nothing. Your event is {refund.days} day
            {refund.days === 1 ? "" : "s"} away, and cancellations inside 7 days refund 0% of the
            advance{refund.fee > 0 ? " and the platform fee is not refunded" : ""}. This cannot be
            undone.
          </p>
        )}
      </div>
      {error && (
        <p className="text-xs font-medium text-red-700 bg-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          onClick={handleConfirm}
          disabled={phase === "loading"}
          isLoading={phase === "loading"}
        >
          Yes, cancel
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setPhase("idle"); setError(null); }}
          disabled={phase === "loading"}
        >
          Keep booking
        </Button>
      </div>
    </div>
  );
}
