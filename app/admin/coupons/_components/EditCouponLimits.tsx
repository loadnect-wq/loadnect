"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Change a live coupon's redemption cap and expiry.
//
// The gap this fills: a coupon could be created with limits, and stopped or
// restarted — but its limits could never be changed. Bounding an uncapped code
// meant stopping it and issuing a replacement under a new name, which breaks
// every link and poster already carrying the old one. LAUNCH2026 was uncapped
// and unexpiring for exactly that reason.
//
// Collapsed by default. This sits in a row that is mostly a status readout, and
// a pair of always-visible inputs next to a destructive Stop button invites the
// wrong click.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useTransition } from "react";
import { SlidersHorizontal } from "lucide-react";
import { updateCouponLimits } from "../../actions";

type Props = {
  couponId: string;
  code: string;
  maxRedemptions: number | null;
  expiresAt: string | null;
};

export function EditCouponLimits({ couponId, code, maxRedemptions, expiresAt }: Props) {
  const [open, setOpen] = useState(false);
  // Seeded from what the coupon currently has, so opening and saving without
  // touching anything is a no-op rather than a silent clearing of both fields.
  const [max, setMax] = useState(maxRedemptions == null ? "" : String(maxRedemptions));
  const [expiry, setExpiry] = useState(expiresAt ? expiresAt.slice(0, 10) : "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMsg(null);
    startTransition(async () => {
      const r = await updateCouponLimits(couponId, {
        // Blank means "no limit", the same as on the create form. Passing
        // undefined rather than "" keeps the two paths on one schema.
        maxRedemptions: max.trim() || undefined,
        expiresAt: expiry.trim() || undefined,
      });
      if ("error" in r) { setMsg({ ok: false, text: r.error }); return; }
      setMsg({ ok: true, text: "Limits updated." });
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1 text-[11px] font-semibold text-charcoal-600 hover:border-maroon-300"
      >
        <SlidersHorizontal className="h-3 w-3" /> Limits
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-border bg-ivory-50 p-3">
      <p className="text-[11px] font-semibold text-charcoal-700">Limits for {code}</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-charcoal-500">
            Max redemptions
          </span>
          <input
            type="number"
            min="1"
            step="1"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            placeholder="Unlimited"
            disabled={pending}
            className="w-32 rounded-lg border border-border bg-white px-2 py-1.5 text-xs focus:border-maroon-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-charcoal-500">
            Expires
          </span>
          <input
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            disabled={pending}
            className="w-40 rounded-lg border border-border bg-white px-2 py-1.5 text-xs focus:border-maroon-500 focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-maroon-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-maroon-700 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setMsg(null); }}
          disabled={pending}
          className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-charcoal-600"
        >
          Cancel
        </button>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-charcoal-500">
        Leave either blank for no limit. Redemptions already made are never clawed back — a cap
        below the current count is refused rather than silently killing the coupon. An expiry
        date takes effect at 00:00 UTC (05:30 IST) on that day.
      </p>
      {msg && (
        <p className={`mt-2 text-[11px] font-semibold ${msg.ok ? "text-green-700" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
