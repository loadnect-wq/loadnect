import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerRow, ownerTakesOnlinePayments } from "@/lib/owner";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app/AppHeader";
import { OwnerProfileForm } from "./_components/OwnerProfileForm";
import { isPayoutsConfigured } from "@/lib/cashfree-payouts";
import { PayoutSetup } from "./_components/PayoutSetup";

export const metadata: Metadata = { title: "Owner Profile" };

export default async function OwnerProfilePage() {
  const profile  = await requireRole(["owner_approved"]);
  const ownerRow = await fetchOwnerRow();

  // A payout account is only ever needed by a venue that takes payment THROUGH
  // Hallnect. See ownerTakesOnlinePayments — a lead-generation venue is paid by
  // the customer directly and owes Hallnect a commission, so money never
  // travels toward the owner and there is nothing to pay out.
  const payoutNeed = await ownerTakesOnlinePayments();

  // Personal phone + notification preference live on profiles (not in requireRole's
  // cached shape). This page previously passed phone={null} hard-coded, so the
  // personal-phone field always rendered empty even after a save.
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let { data: extra } = await db
    .from("profiles")
    .select("phone, notifications_enabled")
    .eq("id", profile.id)
    .maybeSingle();
  if (!extra) {
    ({ data: extra } = await db.from("profiles").select("phone").eq("id", profile.id).maybeSingle());
  }

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Profile" notificationsHref="/owner/notifications" />

      <div className="px-4 py-5 sm:px-6 lg:px-8 max-w-2xl space-y-5">

        {/* Identity card */}
        <div className="rounded-2xl bg-gradient-to-br from-maroon-800 to-maroon-950 p-5 text-ivory-100 shadow-elevated">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gold-400 text-maroon-900 font-serif text-xl font-bold">
              {(profile.full_name ?? profile.email ?? "?")[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate font-serif text-lg font-bold">{profile.full_name ?? "Owner"}</p>
              <p className="truncate text-xs text-ivory-400">{profile.email}</p>
              <span className="mt-1 inline-block rounded-full bg-gold-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold-300">
                Verified Owner
              </span>
            </div>
          </div>
        </div>

        {/* PAYOUT SETUP, AND ONLY WHEN IT MEANS SOMETHING.
            It used to render for every owner. Asking a lead-generation venue
            for a bank account, a PAN and an account-holder name is asking a
            stranger for their banking details for a purpose that does not
            exist — they are paid by the customer directly and owe Hallnect a
            commission, so nothing is ever paid TO them. It was also the first
            thing on the page, which is a poor first impression for a field
            nobody needs.

            Kept first for those who DO need it: it is the one thing that must
            be done before they can be paid. */}
        {/* payoutsEnabled is server-only — it reads an env var, so a client
            component cannot ask. Passed down because BOTH halves must be true
            before an owner is told payouts are automatic: the product switched
            on AND their own account VERIFIED by Cashfree. */}
        {payoutNeed.takesOnlinePayments ? (
        <PayoutSetup
          easySplitEnabled={isPayoutsConfigured()}
          vendorId={ownerRow?.payout_beneficiary_id ?? null}
          kycStatus={ownerRow?.payout_beneficiary_status ?? null}
          lastError={ownerRow?.payout_beneficiary_last_error ?? null}
          hasBusinessName={!!ownerRow?.business_name}
          saved={{
            accountHolder: ownerRow?.payout_account_holder ?? null,
            accountNumber: ownerRow?.payout_account_number ?? null,
            ifsc:          ownerRow?.payout_ifsc           ?? null,
            pan:           ownerRow?.pan_number            ?? null,
            phone:         ownerRow?.business_phone        ?? null,
          }}
        />
        ) : (
          /* Not silence: an owner who has heard Hallnect handles payments
             would wonder where the field went. This says why it is absent and
             what replaces it, and it appears on its own the moment they add a
             venue that takes online payment. */
          <div className="rounded-2xl border border-border bg-white p-5 shadow-card">
            <h3 className="font-serif text-sm font-semibold text-charcoal-900">
              No payout account needed
            </h3>
            {payoutNeed.hallCount > 0 ? (
              <p className="mt-1 text-xs leading-relaxed text-charcoal-600">
                Your venues take enquiries rather than online payments, so customers
                pay you directly and Hallnect never holds your money. You pay
                Hallnect&apos;s commission from{" "}
                <Link href="/owner/commissions" className="font-semibold text-maroon-700 underline">
                  Commissions
                </Link>
                . If you later list a venue that takes payment online, the payout
                fields will appear here.
              </p>
            ) : (
              <p className="mt-1 text-xs leading-relaxed text-charcoal-600">
                Nothing to set up yet. If you list a venue that takes payment
                online, the payout fields will appear here so Hallnect can
                transfer the advance to you. A venue that only takes enquiries
                never needs one — customers pay you directly.
              </p>
            )}
          </div>
        )}

        <OwnerProfileForm
          ownerRow={ownerRow}
          fullName={profile.full_name}
          email={profile.email}
          phone={(extra as { phone?: string | null } | null)?.phone ?? null}
          initialNotificationsEnabled={(extra as { notifications_enabled?: boolean } | null)?.notifications_enabled ?? true}
        />

        {/* Sign out */}
        <form
          action={async () => {
            "use server";
            const sc = await getSupabaseServerClient();
            await sc.auth.signOut();
            redirect("/login");
          }}
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3 text-sm font-semibold text-red-600 shadow-card active:scale-[0.99] transition-transform"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
