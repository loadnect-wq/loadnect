"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Settles ONE lead commission through Cashfree.
//
// The button sends a COMMISSION ID and nothing else. The amount rendered beside
// it is display-only — startCommissionPaymentAction reads the real figure from
// the commission row, which the server computed at confirmation from a rate it
// resolved from the hall. Editing the DOM changes the label and nothing else.
//
// WHY THERE IS NO "MARK AS PAID". The owner returns from Cashfree to
// /owner/commissions/status, which re-reads the ORDER from Cashfree's API and
// compares the amount before anything is marked settled. A redirect is not
// evidence, and neither is this component.
//
// Double-click is stopped three deep: the button disables on `pending`, the
// server reuses an in-flight order rather than opening a second, and
// uq_ocp_open_per_commission makes a second open attempt a unique violation.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useTransition } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { startCommissionPaymentAction } from "@/app/owner/(dashboard)/actions";

const SDK_SRC = "https://sdk.cashfree.com/js/v3/cashfree.js";

function loadSdk(): Promise<NonNullable<Window["Cashfree"]>> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("Not in a browser"));
    if (window.Cashfree) return resolve(window.Cashfree);

    const done = () =>
      window.Cashfree ? resolve(window.Cashfree) : reject(new Error("Cashfree SDK unavailable"));

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", done, { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Cashfree")), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = SDK_SRC;
    s.async = true;
    s.onload = done;
    s.onerror = () => reject(new Error("Failed to load Cashfree"));
    document.head.appendChild(s);
  });
}

export function PayCommission({
  commissionId,
  amountLabel,
}: {
  commissionId: string;
  amountLabel: string;
}) {
  const [stage, setStage] = useState<"idle" | "creating" | "opening">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function pay() {
    setError(null);
    setStage("creating");
    start(async () => {
      const result = await startCommissionPaymentAction(commissionId);
      if ("error" in result) {
        setError(result.error);
        setStage("idle");
        return;
      }

      setStage("opening");
      try {
        const Cashfree = await loadSdk();
        // redirectTarget "_self" brings the owner back to our own status page,
        // which verifies the payment server-side before showing it as settled.
        Cashfree({ mode: result.mode }).checkout({
          paymentSessionId: result.paymentSessionId,
          redirectTarget: "_self",
        });
      } catch {
        setError("Could not open the payment window. Please try again.");
        setStage("idle");
      }
    });
  }

  const busy = pending || stage !== "idle";
  const label =
    stage === "creating" ? "Preparing…"
    : stage === "opening" ? "Opening checkout…"
    : `Pay ${amountLabel}`;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={pay}
        disabled={busy}
        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-maroon-700 px-3.5 text-xs font-semibold text-white transition active:scale-[0.97] disabled:opacity-60 motion-reduce:active:scale-100"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CreditCard className="h-3.5 w-3.5" aria-hidden />}
        {label}
      </button>
      {error && (
        <p role="alert" className="max-w-[16rem] text-right text-[11px] font-semibold text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
