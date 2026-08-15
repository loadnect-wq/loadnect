import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, Shield, AlertTriangle, Settings as SettingsIcon, Database, Timer, Percent, Sparkles } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getCommissionPercent, getPublicPaymentSettings } from "@/lib/platform-settings";
import { fetchPremiumPlans } from "@/lib/premium-plans";
import { Badge } from "@/components/ui/Badge";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { CleanupButton } from "./_components/CleanupButton";
import { CommissionRateForm } from "./_components/CommissionRateForm";
import { PremiumPlansForm } from "./_components/PremiumPlansForm";
import { PaymentSettingsForm } from "./_components/PaymentSettingsForm";

export const metadata: Metadata = { title: "Admin Settings" };

export default async function AdminSettingsPage() {
  const profile = await requireRole(["admin"]);
  const [commissionPercent, premiumPlans, paymentSettings] = await Promise.all([
    getCommissionPercent(),
    fetchPremiumPlans(),
    getPublicPaymentSettings(),
  ]);

  return (
    <div>
      <AdminPageHeader title="Settings" description="Admin account settings and platform configuration." />

      <div className="px-4 py-5 sm:px-6 lg:px-8 max-w-3xl space-y-5">

        {/* Admin identity */}
        <div className="rounded-2xl bg-gradient-to-br from-charcoal-900 to-charcoal-950 p-5 text-ivory-100 shadow-elevated">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-maroon-700 text-white font-serif text-xl font-bold">
              {(profile.full_name ?? profile.email ?? "?")[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate font-serif text-lg font-bold">{profile.full_name ?? "Admin"}</p>
              <p className="truncate text-xs text-charcoal-300">{profile.email}</p>
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-maroon-700/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-maroon-200">
                <Shield className="h-3 w-3" /> Administrator
              </span>
            </div>
          </div>
        </div>

        {/* Commission rate (editable) */}
        <Section title="Commission" icon={<Percent className="h-4 w-4" />}>
          <ConfigRow label="Current platform commission" value={`${commissionPercent}%`} />
          <div className="mt-3 border-t border-border pt-3">
            <CommissionRateForm initialPercent={commissionPercent} />
          </div>
        </Section>

        {/* Payment & commission settings (editable) */}
        <Section title="Payments & commission" icon={<SettingsIcon className="h-4 w-4" />}>
          <PaymentSettingsForm initial={paymentSettings} />
        </Section>

        {/* Premium plans (editable price + duration) */}
        <Section title="Premium plans" icon={<Sparkles className="h-4 w-4" />}>
          <PremiumPlansForm plans={premiumPlans} />
        </Section>

        {/* Platform configuration (informational) */}
        <Section title="Platform Configuration" icon={<SettingsIcon className="h-4 w-4" />}>
          <ConfigRow label="Booking advance" value="25%" />
          <ConfigRow label="Payment gateway" value="Cashfree" />
          <ConfigRow label="Image storage"   value="Supabase Storage" />
          <ConfigRow label="Default booking date guard" value="≥ 2024-01-01" />
          <p className="mt-3 text-[11px] text-charcoal-500">
            These values are defined in code (lib/constants.ts) and database constraints.
            Changes require code review and a deployment.
          </p>
        </Section>

        {/* Security notes */}
        <Section title="Security Posture" icon={<Shield className="h-4 w-4" />}>
          <SecurityRow
            label="Row-Level Security"
            badge={<Badge variant="success" size="sm">Enabled</Badge>}
            note="Every table has RLS enabled with default-deny policies."
          />
          <SecurityRow
            label="Role escalation guard"
            badge={<Badge variant="success" size="sm">Active</Badge>}
            note="DB trigger prevents non-admin role changes."
          />
          <SecurityRow
            label="Owner self-approval guard"
            badge={<Badge variant="success" size="sm">Active</Badge>}
            note="DB trigger prevents owners from approving their own halls."
          />
          <SecurityRow
            label="Booking state machine"
            badge={<Badge variant="success" size="sm">Active</Badge>}
            note="DB trigger enforces legal status transitions per role."
          />
          <SecurityRow
            label="Payment write lock"
            badge={<Badge variant="success" size="sm">Active</Badge>}
            note="Client write policies absent — only the trusted backend writes payments."
          />
          <SecurityRow
            label="Service-role key"
            badge={<Badge variant="success" size="sm">Server-only</Badge>}
            note="Walled off by 'server-only' import. Never reaches the browser bundle."
          />
        </Section>

        {/* Database health */}
        <Section title="Database" icon={<Database className="h-4 w-4" />}>
          <ConfigRow label="Schema version" value="0011 (booking cleanup)" />
          <p className="mt-3 text-[11px] text-charcoal-500">
            Run new migrations through the Supabase SQL editor. The dashboard reflects the live database state.
          </p>
        </Section>

        {/* Pending booking cleanup */}
        <Section title="Booking Maintenance" icon={<Timer className="h-4 w-4" />}>
          <ConfigRow label="Pending payment timeout" value="15 minutes" />
          <p className="mt-2 text-[11px] text-charcoal-500">
            Expired pending bookings are auto-cancelled by{" "}
            <code className="rounded bg-ivory-200 px-1 py-0.5">cleanup_expired_pending_bookings()</code>.
            Recommended: schedule it via pg_cron to run every minute. Use the button below to run it once manually.
          </p>
          <div className="mt-3">
            <CleanupButton />
          </div>
        </Section>

        {/* Danger zone */}
        <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <h3 className="font-serif text-sm font-semibold text-red-900">Danger Zone</h3>
          </div>
          <p className="text-xs text-red-800">
            Sign out to release this admin session. To revoke another admin&apos;s access, change their role
            in the Supabase SQL editor directly:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-red-100 p-2 text-[11px] font-mono text-red-900">
{`UPDATE profiles SET role = 'customer'
WHERE id = '<user-uuid>';`}
          </pre>

          <div className="flex flex-wrap gap-2 pt-2">
            <Link href="/admin/users?role=admin" className="text-xs font-semibold text-red-700 hover:underline">
              View all admins →
            </Link>
          </div>
        </div>

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
            <LogOut className="h-4 w-4" /> Sign out of admin
          </button>
        </form>
      </div>
    </div>
  );
}

function Section({
  title, icon, children,
}: {
  title: string;
  icon:  React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white shadow-card overflow-hidden">
      <div className="border-b border-border bg-ivory-50 px-4 py-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-maroon-50 text-maroon-600">{icon}</span>
        <h3 className="font-serif text-sm font-semibold text-charcoal-900">{title}</h3>
      </div>
      <div className="px-4 py-3 space-y-1.5">{children}</div>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 last:border-b-0 text-sm">
      <span className="text-charcoal-600">{label}</span>
      <span className="font-semibold text-charcoal-900">{value}</span>
    </div>
  );
}

function SecurityRow({ label, badge, note }: { label: string; badge: React.ReactNode; note: string }) {
  return (
    <div className="border-b border-border py-2 last:border-b-0">
      <div className="flex items-center justify-between">
        <span className="text-sm text-charcoal-700">{label}</span>
        {badge}
      </div>
      <p className="mt-0.5 text-[11px] text-charcoal-500">{note}</p>
    </div>
  );
}
