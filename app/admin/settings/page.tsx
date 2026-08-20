import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, Shield, AlertTriangle, Settings as SettingsIcon, Database, Timer, Percent, Sparkles, KeyRound, CheckCircle2, XCircle } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getCommissionPercent, getPublicPaymentSettings } from "@/lib/platform-settings";
import { fetchPremiumPlans } from "@/lib/premium-plans";
import { checkAuthRedirectHealth } from "@/lib/auth-health";
import { Badge } from "@/components/ui/Badge";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { CleanupButton } from "./_components/CleanupButton";
import { CommissionRateForm } from "./_components/CommissionRateForm";
import { PremiumPlansForm } from "./_components/PremiumPlansForm";
import { PaymentSettingsForm } from "./_components/PaymentSettingsForm";

export const metadata: Metadata = { title: "Admin Settings" };

export default async function AdminSettingsPage() {
  const profile = await requireRole(["admin"]);
  const [commissionPercent, premiumPlans, paymentSettings, authHealth] = await Promise.all([
    getCommissionPercent(),
    fetchPremiumPlans(),
    getPublicPaymentSettings(),
    // Live probe of the Supabase redirect allow-list. A mismatch here is
    // invisible everywhere else: Supabase silently falls back to its Site URL
    // instead of erroring, which is what sent customers to Vercel's login page.
    checkAuthRedirectHealth(),
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

        {/* Google sign-in configuration health (live probe) */}
        <div className={`rounded-2xl border-2 p-5 ${authHealth.healthy ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
          <div className="flex items-start gap-3">
            <KeyRound className={`mt-0.5 h-5 w-5 shrink-0 ${authHealth.healthy ? "text-green-600" : "text-red-600"}`} />
            <div className="min-w-0 flex-1">
              <h3 className={`font-serif text-sm font-semibold ${authHealth.healthy ? "text-green-900" : "text-red-900"}`}>
                Google sign-in redirect configuration
              </h3>
              <p className={`mt-0.5 text-xs ${authHealth.healthy ? "text-green-800" : "text-red-800"}`}>
                {!authHealth.reachable
                  ? "Could not reach the Supabase auth server to verify. Try again shortly."
                  : authHealth.healthy
                    ? "Supabase will return customers to this site after Google sign-in."
                    : "Supabase does NOT recognise this site's callback URL, so it redirects customers elsewhere after Google sign-in."}
              </p>

              <ul className="mt-3 space-y-1.5">
                {authHealth.checks.map((c) => (
                  <li key={c.url} className="flex items-start gap-2 text-[11px]">
                    {c.allowListed
                      ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                      : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />}
                    <span className="min-w-0">
                      <span className="break-all font-mono text-charcoal-800">{c.url}</span>
                      <span className={c.allowListed ? "ml-1 font-semibold text-green-700" : "ml-1 font-semibold text-red-700"}>
                        {c.allowListed ? "allowed" : "not allowed"}
                      </span>
                      {!c.allowListed && c.actualDestination && (
                        <span className="block text-charcoal-500">
                          Customers are sent to <span className="break-all font-mono">{c.actualDestination}</span>
                          {c.landsOnProtectedHost && " — a Vercel-protected page, not Hallnect"}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              {authHealth.reachable && !authHealth.healthy && (
                <div className="mt-3 rounded-xl bg-white/70 p-3">
                  <p className="text-[11px] font-semibold text-red-900">To fix (Supabase dashboard, ~1 minute):</p>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11px] text-red-800">
                    <li>Authentication → URL Configuration</li>
                    <li>Set <span className="font-semibold">Site URL</span> to <span className="break-all font-mono">{authHealth.canonicalOrigin}</span></li>
                    <li>Add each URL marked &ldquo;not allowed&rdquo; above to <span className="font-semibold">Redirect URLs</span> (exactly, no query string)</li>
                    <li>Save, then reload this page — it re-checks automatically</li>
                  </ol>
                </div>
              )}
            </div>
          </div>
        </div>

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
