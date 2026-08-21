"use client";

import { useState, useTransition } from "react";
import { CreditCard } from "lucide-react";
import { startCommissionPaymentAction } from "@/app/owner/(dashboard)/actions";

// ─────────────────────────────────────────────────────────────────────────────
// Opens Cashfree checkout so the owner can settle their commission by UPI,
// card, net-banking or wallet — the same gateway (and the same SDK) customers
// use for booking advances.
//
// The button sends ONLY the commission id. The amount is recomputed on the
// server from the commission row, so the figure rendered here is display-only
// and cannot influence what is charged.
// ─────────────────────────────────────────────────────────────────────────────

type CashfreeCheckoutOptions = { paymentSessionId: string; redirectTarget?: string };
type CashfreeInstance = { checkout: (o: CashfreeCheckoutOptions) => Promise<unknown> | void };
declare global {
  interface Window {
    Cashfree?: (opts: { mode: "sandbox" | "production" }) => CashfreeInstance;
  }
}

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

export function PayCommissionOnline({
  commissionId,
  amountLabel,
}: {
  commissionId: string;
  amountLabel: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "creating" | "opening">("idle");

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
        // redirectTarget "_self" sends the browser to our own status page after
        // checkout, where the payment is verified SERVER-SIDE before anything is
        // shown as paid.
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

  const label =
    stage === "creating" ? "Preparing payment…"
    : stage === "opening" ? "Opening checkout…"
    : `Pay ${amountLabel}`;

  return (
    <div className="flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={pay}
        disabled={pending || stage !== "idle"}
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-maroon-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-maroon-700 disabled:opacity-60 active:scale-[0.99] motion-reduce:active:scale-100"
      >
        <CreditCard className="h-4 w-4" />
        {label}
      </button>
      <p className="text-center text-[10px] text-charcoal-500">
        UPI · Card · Net banking · Wallet — secured by Cashfree
      </p>
      {error && <p className="text-center text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
