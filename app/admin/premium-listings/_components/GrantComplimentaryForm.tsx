"use client";

import { TIER_LABEL, planDisplayName } from "@/lib/plan-names";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Gift, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { createPremiumListing, checkPremiumOverlap } from "../../actions";

type HallOption = { id: string; name: string; city?: string | null };
type Overlap = { id: string; planSlug: string; startDate: string; endDate: string; grantType: string };

const DURATIONS = [7, 15, 30, 60, 90] as const;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const today = () => new Date().toISOString().slice(0, 10);

function fmt(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Grants a Pro or Elite plan at no charge.
 *
 * NOTHING HERE TOUCHES CASHFREE. The action writes a premium_listings row with
 * grant_type 'complimentary', no payment_id, no plan_purchase_id and amount 0 —
 * and the database refuses anything else. Entitlements then come from the same
 * recompute_hall_premium() that serves paid listings, so a complimentary Pro
 * gets exactly the Pro features, with no second code path to keep in step.
 */
export function GrantComplimentaryForm({ halls }: { halls: HallOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hallId, setHallId] = useState("");
  const [planSlug, setPlanSlug] = useState<"premium" | "pro">("premium");
  const [preset, setPreset] = useState<number | "custom">(30);
  const [startDate, setStartDate] = useState(today());
  const [customEnd, setCustomEnd] = useState(addDays(today(), 30));
  const [reason, setReason] = useState("");
  const [overlaps, setOverlaps] = useState<Overlap[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Inclusive window: a 30-day offer starting today ends 29 days later, so the
  // owner gets thirty days rather than thirty-one.
  const endDate = preset === "custom" ? customEnd : addDays(startDate, preset - 1);
  const hall = useMemo(() => halls.find((h) => h.id === hallId), [halls, hallId]);

  function reset() {
    setHallId(""); setPlanSlug("premium"); setPreset(30);
    setStartDate(today()); setCustomEnd(addDays(today(), 30));
    setReason(""); setOverlaps(null); setAcknowledged(false); setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      // WARN ONCE, THEN ALLOW. Overlap is legitimate — a paid Premium owner
      // given a complimentary Pro is a supported scenario, and the tier
      // resolves to the better plan while both are live, then falls back on its
      // own. It just must never be accidental.
      if (!acknowledged) {
        const res = await checkPremiumOverlap({ hallId, startDate, endDate });
        if ("error" in res) { setError(res.error); return; }
        if (res.overlaps.length > 0) {
          setOverlaps(res.overlaps);
          setAcknowledged(true);
          return;
        }
      }

      const result = await createPremiumListing({
        hallId, planSlug, startDate, endDate,
        amount: 0,
        grantType: "complimentary",
        grantReason: reason.trim() || undefined,
      });

      if ("error" in result) { setError(result.error); return; }

      toast({
        title: "Complimentary access granted",
        description: `${hall?.name ?? "The hall"} has ${TIER_LABEL[planSlug]} until ${fmt(endDate)}.`,
        variant: "success",
      });
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)} className="gap-2">
        <Gift className="h-4 w-4" aria-hidden />
        Give Premium for Free
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border-2 border-gold-300 bg-gold-50/50 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-serif text-base font-semibold text-charcoal-900">
            <Gift className="h-4 w-4 text-gold-600" aria-hidden />
            Complimentary Premium offer
          </h3>
          <p className="mt-0.5 text-xs text-charcoal-600">
            Grants the full plan at no charge. No payment is created and nothing is billed.
          </p>
        </div>
        <button type="button" onClick={() => { reset(); setOpen(false); }} aria-label="Close"
                className="text-charcoal-400 hover:text-charcoal-700">
          <X className="h-4 w-4" />
        </button>
      </div>

      <fieldset disabled={pending} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="c-hall">Hall <span className="text-maroon-600">*</span></Label>
          <select
            id="c-hall" required value={hallId}
            onChange={(e) => { setHallId(e.target.value); setOverlaps(null); setAcknowledged(false); }}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Select a hall…</option>
            {halls.map((h) => (
              <option key={h.id} value={h.id}>{h.name}{h.city ? ` — ${h.city}` : ""}</option>
            ))}
          </select>
        </div>

        <div>
          <Label>Plan</Label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {([["premium", TIER_LABEL.premium], ["pro", TIER_LABEL.pro]] as const).map(([slug, label]) => (
              <button
                key={slug} type="button"
                onClick={() => { setPlanSlug(slug); setOverlaps(null); setAcknowledged(false); }}
                className={[
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  planSlug === slug
                    ? "border-gold-500 bg-gold-100 text-gold-900"
                    : "border-border bg-white text-charcoal-600 hover:border-gold-300",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
          {/* The plan names come from premium_plans: free, premium, pro. There
              is no "Elite" tier in this application. */}
          <p className="mt-1 text-[11px] text-charcoal-500">
            The same two purchasable plans owners can buy — the offer waives the price, not the features.
          </p>
        </div>

        <div>
          <Label>Duration</Label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d} type="button"
                onClick={() => { setPreset(d); setOverlaps(null); setAcknowledged(false); }}
                className={[
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  preset === d ? "border-gold-500 bg-gold-100 text-gold-900"
                               : "border-border bg-white text-charcoal-600 hover:border-gold-300",
                ].join(" ")}
              >
                {d} days
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setPreset("custom"); setOverlaps(null); setAcknowledged(false); }}
              className={[
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                preset === "custom" ? "border-gold-500 bg-gold-100 text-gold-900"
                                    : "border-border bg-white text-charcoal-600 hover:border-gold-300",
              ].join(" ")}
            >
              Custom
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="c-start">Starts</Label>
            <Input id="c-start" type="date" value={startDate}
                   onChange={(e) => { setStartDate(e.target.value); setOverlaps(null); setAcknowledged(false); }} />
          </div>
          {preset === "custom" && (
            <div className="space-y-1.5">
              <Label htmlFor="c-end">Ends</Label>
              <Input id="c-end" type="date" value={customEnd}
                     onChange={(e) => { setCustomEnd(e.target.value); setOverlaps(null); setAcknowledged(false); }} />
            </div>
          )}
        </div>

        <p className="rounded-lg border border-gold-200 bg-white px-3 py-2 text-xs font-medium text-charcoal-800">
          Premium access from {fmt(startDate)} to {fmt(endDate)}
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="c-reason">Offer reason (internal)</Label>
          <Input id="c-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                 placeholder="Founding partner offer / launch promotion / referral" />
          <p className="text-[11px] text-charcoal-500">Recorded in the audit log. The owner never sees this.</p>
        </div>
      </fieldset>

      {overlaps && overlaps.length > 0 && (
        <div className="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            This hall already has premium access in that window
          </p>
          <ul className="mt-2 space-y-1 text-xs text-amber-900">
            {overlaps.map((o) => (
              <li key={o.id}>
                {planDisplayName(o.planSlug)} ({o.grantType}) — {fmt(o.startDate)} to {fmt(o.endDate)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-900/80">
            Nothing will be overwritten: the existing access stays exactly as it is, and the hall
            keeps whichever plan is higher while both are live. Press Grant again to add this offer alongside it.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-5 flex items-center gap-3">
        <Button type="submit" variant="gold" disabled={pending || !hallId}>
          {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
          {acknowledged && overlaps && overlaps.length > 0 ? "Grant anyway" : "Grant Premium"}
        </Button>
        <button type="button" onClick={() => { reset(); setOpen(false); }}
                className="text-sm text-charcoal-500 hover:text-charcoal-800">
          Cancel
        </button>
      </div>
    </form>
  );
}
