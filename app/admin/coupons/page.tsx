import type { Metadata } from "next";
import { TicketPercent } from "lucide-react";
import { fetchCoupons } from "@/lib/admin";
import { formatPrice } from "@/lib/mock-data";
import { Badge } from "@/components/ui/Badge";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { ConfirmButton } from "../_components/ConfirmButton";
import { stopCoupon, resumeCoupon } from "../actions";
import { CreateCouponForm } from "./_components/CreateCouponForm";

export const metadata: Metadata = { title: "Coupons — Admin" };

// No role guard here: app/admin/layout.tsx already calls requireRole(["admin"])
// for the whole subtree, and noindex is inherited with it.

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export default async function AdminCouponsPage() {
  const result = await fetchCoupons();

  const rows = result.unavailable ? [] : result.rows;
  const liveCount   = rows.filter((c) => c.is_active).length;
  const totalPaid   = rows.reduce((s, c) => s + c.paid, 0);
  const totalForgone = rows.reduce((s, c) => s + c.feesForgone, 0);

  return (
    <div>
      <AdminPageHeader
        title="Coupons"
        description="Codes customers type at checkout to waive the ₹200 platform fee. The fee is Hallnect's own revenue — the venue's commission and payout are never affected, so every waiver costs Hallnect ₹200 and the owner nothing."
      />

      <div className="space-y-4 px-4 py-4 sm:px-6 lg:px-8">
        {result.unavailable ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            <p className="font-semibold">Coupons need migration 0045.</p>
            <p className="mt-1">
              Run <code className="font-mono text-xs">supabase/migrations/0045_coupons.sql</code>{" "}
              against this database, then reload.
            </p>
          </div>
        ) : (
          <>
            {rows.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-white p-3 shadow-card">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Live</p>
                  <p className="mt-1 font-serif text-xl font-bold text-charcoal-900">{liveCount}</p>
                </div>
                <div className="rounded-xl bg-white p-3 shadow-card">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Bookings</p>
                  <p className="mt-1 font-serif text-xl font-bold text-charcoal-900">{totalPaid}</p>
                </div>
                <div className="rounded-xl bg-white p-3 shadow-card">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Fees waived</p>
                  <p className="mt-1 font-serif text-xl font-bold text-maroon-700">{formatPrice(totalForgone)}</p>
                </div>
              </div>
            )}

            <CreateCouponForm />

            {rows.length === 0 ? (
              <div className="rounded-xl border border-border bg-white p-6 text-center text-sm text-charcoal-600">
                <TicketPercent className="mx-auto h-6 w-6 text-charcoal-300" />
                <p className="mt-2">No coupons yet. Create one above and hand the code out.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {rows.map((c) => {
                  const expired = !!c.expires_at && new Date(c.expires_at).getTime() <= Date.now();
                  const capped  = c.max_redemptions != null && c.paid >= c.max_redemptions;
                  // "Live" has to mean genuinely usable, not just is_active —
                  // an expired or exhausted coupon is refused at checkout, and
                  // showing it as active would send the admin hunting for a bug.
                  const usable  = c.is_active && !expired && !capped;

                  return (
                    <div key={c.id} className="rounded-2xl bg-white p-4 shadow-card">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-bold tracking-wide text-charcoal-900">
                              {c.code}
                            </span>
                            <Badge size="sm" variant={usable ? "success" : "secondary"}>
                              {usable ? "Live" : expired ? "Expired" : capped ? "Limit reached" : "Stopped"}
                            </Badge>
                            <Badge size="sm" variant="secondary">₹0 platform fee</Badge>
                          </div>
                          {c.description && (
                            <p className="mt-1 text-xs text-charcoal-600">{c.description}</p>
                          )}
                          <p className="mt-1.5 text-[11px] text-charcoal-500">
                            {c.paid} used
                            {c.held > 0 && ` · ${c.held} in checkout`}
                            {c.max_redemptions != null && ` · limit ${c.max_redemptions}`}
                            {" · "}
                            {formatPrice(c.feesForgone)} forgone
                            {" · created "}{fmtDate(c.created_at)}
                            {c.expires_at && ` · expires ${fmtDate(c.expires_at)}`}
                            {c.stopped_at && ` · stopped ${fmtDate(c.stopped_at)}`}
                          </p>
                        </div>

                        <div className="shrink-0">
                          {c.is_active ? (
                            <ConfirmButton
                              action={stopCoupon.bind(null, c.id)}
                              label="Stop"
                              confirmText="Click again"
                              variant="destructive"
                            />
                          ) : (
                            <ConfirmButton
                              action={resumeCoupon.bind(null, c.id)}
                              label="Restart"
                              confirmText="Click again"
                              variant="success"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-[11px] text-charcoal-500">
              Stopping a coupon blocks new checkouts at once. A customer already on the payment
              screen is refused when they return, so nothing can be redeemed after you stop it.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
