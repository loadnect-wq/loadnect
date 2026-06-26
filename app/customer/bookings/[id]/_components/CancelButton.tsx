"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { cancelBooking } from "@/app/customer/actions";

export function CancelButton({ bookingId }: { bookingId: string }) {
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
        <p className="mt-1 text-xs text-red-700 leading-relaxed">
          This action cannot be undone. Refunds, if applicable, are processed per
          our cancellation policy (usually 5–7 business days).
        </p>
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
