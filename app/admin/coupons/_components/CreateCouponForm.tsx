"use client";

import { useState, useTransition } from "react";
import { TicketPercent } from "lucide-react";
import { createCoupon } from "../../actions";

/**
 * A suggested code, not a required one — the admin can type anything.
 *
 * The random suffix matters: an un-rate-limited preview action means a
 * guessable code (LAUNCH, OFFER, FREE) is worth guessing. Four random
 * characters over the 36-symbol alphabet the DB accepts push that out of reach
 * without making the code hard to read out over a phone.
 */
function suggestCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 — read aloud safely
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `LAUNCH${suffix}`;
}

export function CreateCouponForm() {
  const [code, setCode] = useState(suggestCode);
  const [description, setDescription] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const r = await createCoupon({
        code,
        description: description || undefined,
        maxRedemptions: maxRedemptions || undefined,
        expiresAt: expiresAt || undefined,
      });
      if ("error" in r) {
        setMsg({ ok: false, text: r.error });
      } else {
        setMsg({ ok: true, text: `${r.code} is live. Customers can use it now.` });
        setCode(suggestCode());
        setDescription("");
        setMaxRedemptions("");
        setExpiresAt("");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-4 shadow-card space-y-3">
      <div className="flex items-center gap-2">
        <TicketPercent className="h-4 w-4 text-maroon-700" />
        <h3 className="font-serif text-sm font-semibold text-charcoal-900">Create a coupon</h3>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
            Code
          </span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="LAUNCH2026"
            className="rounded-lg border border-border bg-white px-2.5 py-2 font-mono text-sm uppercase tracking-wide focus:border-maroon-500 focus:outline-none"
            required
          />
          <span className="text-[11px] text-charcoal-500">
            8–24 letters, digits or hyphens. Customers can type it in any case.
          </span>
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
            Description <span className="font-normal normal-case text-charcoal-400">(optional)</span>
          </span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Launch offer — shared on Instagram"
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
            Max uses <span className="font-normal normal-case text-charcoal-400">(optional)</span>
          </span>
          <input
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder="Unlimited"
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
          />
          <span className="text-[11px] text-charcoal-500">
            Counts paid bookings. Blank = unlimited (₹200 forgone each time).
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
            Expires <span className="font-normal normal-case text-charcoal-400">(optional)</span>
          </span>
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
          />
          <span className="text-[11px] text-charcoal-500">
            Blank = runs until you stop it.
          </span>
        </label>
      </div>

      {msg && (
        <p className={`text-xs font-semibold ${msg.ok ? "text-green-700" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-maroon-700 px-4 text-xs font-semibold text-white transition-colors hover:bg-maroon-800 disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create coupon"}
      </button>
    </form>
  );
}
