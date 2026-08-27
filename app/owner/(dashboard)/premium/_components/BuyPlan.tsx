"use client";

import { useState, useTransition } from "react";
import { CreditCard } from "lucide-react";
import { startPlanPurchaseAction } from "@/app/owner/(dashboard)/actions";

// ─────────────────────────────────────────────────────────────────────────────
// Buys a Premium/Pro listing plan through Cashfree — the same gateway (and the
// same SDK) customers use for booking advances.
//
// The button sends ONLY a hall id and a plan slug. The price is read on the
// server from the premium_plans catalogue, so the figure rendered here is
// display-only and cannot influence what is charged.
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

export type BuyableHall = { id: string; name: string; tier: string | null };

export function BuyPlan({
  planSlug,
  amountLabel,
  halls,
  accent,
}: {
  planSlug: "premium" | "pro";
  amountLabel: string;
  halls: BuyableHall[];
  accent: "gold" | "maroon";
}) {
  const [hallId, setHallId] = useState(halls[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "creating" | "opening">("idle");

  // Nothing to promote — say so rather than showing a button that cannot work.
  if (halls.length === 0) {
    return (
      <p className="rounded-lg bg-charcoal-100 px-3 py-2 text-center text-xs font-medium text-charcoal-600">
        Add and get a hall approved first
      </p>
    );
  }

  const selected = halls.find((h) => h.id === hallId);
  const alreadyOnThisPlan = selected?.tier === planSlug;

  function pay() {
    setError(null);
    setStage("creating");
    start(async () => {
      const result = await startPlanPurchaseAction(hallId, planSlug);

      if ("error" in result) {
        setError(result.error);
        setStage("idle");
        return;
      }

      setStage("opening");
      try {
        const Cashfree = await loadSdk();
        // redirectTarget "_self" sends the browser to our own status page after
        // checkout, where the payment is verified SERVER-SIDE before the plan is
        // shown as active.
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
    : alreadyOnThisPlan ? `Renew — ${amountLabel}`
    : `Pay ${amountLabel}`;

  return (
    <div className="flex flex-col gap-2">
      {halls.length > 1 && (
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-charcoal-500">
            Which hall?
          </span>
          <select
            value={hallId}
            onChange={(e) => setHallId(e.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-border bg-white px-2.5 text-sm"
          >
            {halls.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}{h.tier ? ` — currently ${h.tier}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <button
        type="button"
        onClick={pay}
        disabled={pending || stage !== "idle" || !hallId}
        className={[
          "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white",
          "transition-colors disabled:opacity-60 active:scale-[0.99] motion-reduce:active:scale-100",
          accent === "maroon"
            ? "bg-maroon-600 hover:bg-maroon-700"
            : "bg-gold-600 hover:bg-gold-700",
        ].join(" ")}
      >
        <CreditCard className="h-4 w-4" />
        {label}
      </button>

      {alreadyOnThisPlan && (
        <p className="text-center text-[10px] text-charcoal-500">
          Renewing adds to the days you already have — you lose nothing.
        </p>
      )}
      <p className="text-center text-[10px] text-charcoal-500">
        UPI · Card · Net banking · Wallet — secured by Cashfree
      </p>
      {error && <p className="text-center text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
