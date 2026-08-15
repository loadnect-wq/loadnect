import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { fetchAllPremium, fetchHallOptionsForPremium } from "@/lib/admin";
import { formatPrice } from "@/lib/mock-data";
import { Badge } from "@/components/ui/Badge";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { ConfirmButton } from "../_components/ConfirmButton";
import { togglePremiumActive } from "../actions";
import { CreateListingForm } from "./_components/CreateListingForm";

export const metadata: Metadata = { title: "Premium Listings — Admin" };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function isInWindow(start: string, end: string): boolean {
  const today = new Date().toISOString().split("T")[0];
  return start <= today && today <= end;
}

export default async function AdminPremiumPage() {
  const [listings, halls] = await Promise.all([fetchAllPremium(), fetchHallOptionsForPremium()]);
  const totalRevenue = listings.reduce((s, l) => s + l.amount, 0);
  const activeCount  = listings.filter((l) => l.is_active && isInWindow(l.start_date, l.end_date)).length;
  const proCount     = listings.filter((l) => l.plan_slug === "pro" && l.is_active && isInWindow(l.start_date, l.end_date)).length;

  return (
    <div>
      <AdminPageHeader title="Premium Listings" description="Boosted hall placements. Records are written by the server after payment success." />

      <div className="px-4 py-4 sm:px-6 lg:px-8 space-y-4">

        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="Active now"    value={activeCount.toString()} highlight />
          <SummaryCard label="Pro active"    value={proCount.toString()} />
          <SummaryCard label="Total listings" value={listings.length.toString()} />
          <SummaryCard label="Premium revenue" value={formatPrice(totalRevenue)} wide />
        </div>

        {/* Manual activation form */}
        <CreateListingForm halls={halls} />

        {listings.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow-card">
            <Sparkles className="mx-auto h-10 w-10 text-charcoal-300 mb-3" />
            <p className="text-sm text-charcoal-500">No premium listings purchased yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white shadow-card">
            <table className="min-w-full text-sm">
              <thead className="bg-ivory-50 border-b border-border">
                <tr>
                  <Th>Hall</Th>
                  <Th>Plan</Th>
                  <Th>Window</Th>
                  <Th>Amount</Th>
                  <Th>Status</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => {
                  const live = l.is_active && isInWindow(l.start_date, l.end_date);
                  const expired = new Date(l.end_date).toISOString().split("T")[0] < new Date().toISOString().split("T")[0];
                  return (
                    <tr key={l.id} className="border-b border-border last:border-b-0 hover:bg-ivory-50/50">
                      <Td className="font-medium">{l.hall_name}</Td>
                      <Td>
                        <Badge size="sm" variant={l.plan_slug === "pro" ? "default" : "gold"}>
                          {l.plan_slug === "pro" ? "★ Pro" : "✦ Premium"}
                        </Badge>
                      </Td>
                      <Td className="text-xs text-charcoal-500">{fmtDate(l.start_date)} → {fmtDate(l.end_date)}</Td>
                      <Td className="font-semibold">{formatPrice(l.amount)}</Td>
                      <Td>
                        {expired
                          ? <Badge variant="secondary" size="sm">Expired</Badge>
                          : live
                          ? <Badge variant="gold" size="sm"><Sparkles className="h-3 w-3" /> Active</Badge>
                          : <Badge variant="warning" size="sm">Inactive</Badge>}
                      </Td>
                      <Td align="right">
                        {!expired && (
                          <ConfirmButton
                            action={togglePremiumActive.bind(null, l.id, !l.is_active)}
                            label={l.is_active ? "Deactivate" : "Activate"}
                            confirmText="Click again"
                            variant={l.is_active ? "destructive" : "success"}
                          />
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label, value, highlight = false, wide = false,
}: {
  label: string; value: string; highlight?: boolean; wide?: boolean;
}) {
  return (
    <div className={[
      "rounded-2xl bg-white p-4 shadow-card",
      highlight ? "ring-2 ring-gold-300" : "",
      wide ? "col-span-2 sm:col-span-1" : "",
    ].join(" ")}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">{label}</p>
      <p className="mt-0.5 text-xl font-bold text-charcoal-900">{value}</p>
    </div>
  );
}
function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-charcoal-500 ${align === "right" ? "text-right" : "text-left"}`}>{children}</th>;
}
function Td({ children, className = "", align = "left" }: { children: React.ReactNode; className?: string; align?: "left" | "right" }) {
  return <td className={`px-4 py-3 ${align === "right" ? "text-right" : ""} ${className}`}>{children}</td>;
}
