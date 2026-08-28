"use client";

import { useState, useTransition } from "react";
import { CreditCard, RefreshCw } from "lucide-react";
import { startPlanSubscriptionAction } from "@/app/owner/(dashboard)/actions";

// ─────────────────────────────────────────────────────────────────────────────
// Subscribes a hall to a monthly Premium/Pro plan through Cashfree.
//
// This used to be a one-off purchase: pay ₹4,999, get 30 days, and the boost
// went dark unless the owner remembered to buy again. It is now a MANDATE —
// authorised once, debited monthly by Cashfree — so the listing renews on its
// own and the owner can stop it whenever they like.
//
// The button sends ONLY a hall id and a plan slug. Price and the Cashfree plan
// id are resolved on the server, so the figure rendered here is display-only
// and cannot influence what is charged.
// ─────────────────────────────────────────────────────────────────────────────


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

export type BuyableHall = {
  id: string;
  name: string;
  tier: string | null;
  /** A LIVE mandate — the owner is genuinely being billed for this plan. */
  subscribedTo?: string | null;
  /** Started but NEVER AUTHORISED. Nothing charged; not a subscription. */
  pendingPlan?: string | null;
};

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
  // ONLY a live mandate counts. A 'created' subscription means the owner opened
  // the mandate screen and did not finish — they must still be able to.
  const alreadyOnThisPlan = selected?.subscribedTo === planSlug;
  const halfFinished      = selected?.pendingPlan  === planSlug;

  function subscribe() {
    setError(null);
    setStage("creating");
    start(async () => {
      const result = await startPlanSubscriptionAction(hallId, planSlug);

      if ("error" in result) {
        setError(result.error);
        setStage("idle");
        return;
      }

      setStage("opening");
      try {
        const Cashfree = await loadSdk();
        // subscriptionsCheckout collects the MANDATE (UPI AutoPay or card), not
        // a one-off payment. redirectTarget "_self" brings the owner back to our
        // status page, where the subscription is verified server-side before it
        // is shown as active.
        Cashfree({ mode: result.mode }).subscriptionsCheckout({
          subsSessionId: result.subsSessionId,
          redirectTarget: "_self",
        });
      } catch {
        setError("Could not open the payment window. Please try again.");
        setStage("idle");
      }
    });
  }

  if (alreadyOnThisPlan) {
    return (
      <p className="rounded-lg bg-green-50 px-3 py-2 text-center text-xs font-semibold text-green-800">
        Subscribed — renews monthly
      </p>
    );
  }

  const label =
    stage === "creating" ? "Preparing…"
    : stage === "opening" ? "Opening checkout…"
    : halfFinished ? "Finish setting up"
    : `Subscribe — ${amountLabel}/month`;

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
                {h.name}{h.subscribedTo ? ` — on ${h.subscribedTo}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <button
        type="button"
        onClick={subscribe}
        disabled={pending || stage !== "idle" || !hallId}
        className={[
          "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white",
          "transition-colors disabled:opacity-60 active:scale-[0.99] motion-reduce:active:scale-100",
          accent === "maroon"
            ? "bg-maroon-600 hover:bg-maroon-700"
            : "bg-gold-600 hover:bg-gold-700",
        ].join(" ")}
      >
        {stage === "idle" ? <RefreshCw className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
        {label}
      </button>

      {halfFinished ? (
        <p className="text-center text-[10px] text-amber-700">
          You started this but did not finish approving the monthly payment.
          Nothing has been charged.
        </p>
      ) : (
        <p className="text-center text-[10px] text-charcoal-500">
          Renews automatically every month. Cancel any time — you keep the month
          you have paid for.
        </p>
      )}
      {error && <p className="text-center text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
