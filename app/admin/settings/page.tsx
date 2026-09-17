import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, Shield, AlertTriangle, Settings as SettingsIcon, Database, Timer, Percent, Sparkles, KeyRound, CheckCircle2, XCircle, CreditCard, ShieldCheck, Wallet, BarChart3 } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { PENDING_PAYMENT_TIMEOUT_MIN } from "@/lib/booking-payment";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getPublicPaymentSettings } from "@/lib/platform-settings";
import { COMMISSION_PERCENT_LABEL } from "@/lib/commission";
import { fetchPremiumPlans } from "@/lib/premium-plans";
import { checkAuthRedirectHealth } from "@/lib/auth-health";
import { checkCashfreeHealth } from "@/lib/cashfree-health";
import { checkPayoutsHealth } from "@/lib/cashfree-payouts";
import { getMsg91Status } from "@/lib/msg91";
import { Badge } from "@/components/ui/Badge";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { CleanupButton } from "./_components/CleanupButton";
import { InternalTrafficToggle } from "./_components/InternalTrafficToggle";
import { PremiumPlansForm } from "./_components/PremiumPlansForm";
import { PaymentSettingsForm } from "./_components/PaymentSettingsForm";

export const metadata: Metadata = { title: "Admin Settings" };

/** Same expression the banner uses, so this readout cannot claim an id that is
 *  not the one on the page. */
const GA_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || "G-4YVQGMTCR4";

/**
 * Applied schema version, read from the database rather than asserted.
 *
 * NEVER THROWS, and that is the point: this page is the only readout an
 * operator has for configuration Vercel keeps write-only, so one unavailable
 * row must not take the Cashfree and MSG91 cards down with it. A null renders
 * as "could not read", which is honest; a hardcoded string was not.
 */
async function fetchSchemaState(): Promise<{ version: string; name: string | null; count: number } | null> {
  try {
    const sb = await getSupabaseServerClient();
    const { data, error } = await sb.rpc("schema_migration_state").single();
    if (error || !data) return null;
    const row = data as { latest_version: string; latest_name: string | null; applied_count: number };
    return { version: row.latest_version, name: row.latest_name, count: row.applied_count };
  } catch {
    return null;
  }
}

/**
 * Owners whose payout account Cashfree has actually VERIFIED.
 *
 * This is the half of "can we pay anyone?" that credentials cannot answer: the
 * Payouts product can be live, the keys accepted, and every transfer still
 * refused because no beneficiary passed verification. Counts VERIFIED only —
 * INITIATED means Cashfree is still checking and will not accept a transfer.
 * Same no-throw contract as above.
 */
async function countVerifiedBeneficiaries(): Promise<number | null> {
  try {
    const sb = await getSupabaseServerClient();
    const { count, error } = await sb
      .from("hall_owners")
      .select("id", { count: "exact", head: true })
      .eq("payout_beneficiary_status", "VERIFIED");
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

export default async function AdminSettingsPage() {
  const profile = await requireRole(["admin"]);
  const [premiumPlans, paymentSettings, authHealth, cashfree, payouts, schemaState, verifiedBeneficiaries] = await Promise.all([
    fetchPremiumPlans(),
    getPublicPaymentSettings(),
    // Live probe of the Supabase redirect allow-list. A mismatch here is
    // invisible everywhere else: Supabase silently falls back to its Site URL
    // instead of erroring, which is what sent customers to Vercel's login page.
    checkAuthRedirectHealth(),
    checkCashfreeHealth(),
    checkPayoutsHealth(),
    fetchSchemaState(),
    countVerifiedBeneficiaries(),
  ]);

  // Cheap, synchronous env reads — no network call, unlike the probes above.
  const msg91 = getMsg91Status();
  const otpConfigured = msg91.otpConfigured;
  // Name only what is genuinely missing — listing a variable that is already set
  // sends whoever reads this to check something that is fine.
  const otpMissing = [
    msg91.authKeyHint ? null : "MSG91_AUTH_KEY",
    msg91.otpTemplateId ? null : "MSG91_OTP_TEMPLATE_ID",
  ].filter((v): v is string => v !== null);

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

        {/* Commission — fixed, not editable. One standard rate for every venue
            (lib/commission.ts). There is deliberately no form here: a rate an
            admin can type is a rate that can be mistyped for the whole country. */}
        <Section title="Commission" icon={<Percent className="h-4 w-4" />}>
          <ConfigRow label="Standard Hallnect commission" value={COMMISSION_PERCENT_LABEL} />
          <p className="mt-2 text-xs leading-relaxed text-charcoal-500">
            Applied to every new booking: direct bookings on the full hall price (retained from the
            customer&apos;s advance), enquiries on the amount the venue confirms. Existing bookings keep
            the rate they were charged. It is fixed in the platform and cannot be changed by owners,
            customers or this page.
          </p>
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

        {/* Cashfree payment configuration (live probe) */}
        <div className={`rounded-2xl border-2 p-5 ${
          !cashfree.configured ? "border-amber-200 bg-amber-50"
          : cashfree.modeKeyMismatch || cashfree.credentialsAccepted === false ? "border-red-200 bg-red-50"
          : cashfree.mode === "production" ? "border-green-200 bg-green-50"
          : "border-blue-200 bg-blue-50"}`}>
          <div className="flex items-start gap-3">
            <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-charcoal-700" />
            <div className="min-w-0 flex-1">
              <h3 className="font-serif text-sm font-semibold text-charcoal-900">Cashfree payments</h3>

              {!cashfree.configured ? (
                <p className="mt-0.5 text-xs text-amber-800">
                  Not configured — bookings run in manual request mode (no online payment).
                </p>
              ) : (
                <>
                  <p className="mt-0.5 text-xs text-charcoal-700">
                    Running in{" "}
                    <span className="font-bold uppercase">{cashfree.mode}</span>
                    {cashfree.mode === "production"
                      ? " — real money will be charged."
                      : " — test money only, no real charges."}
                  </p>

                  <dl className="mt-3 space-y-1 text-[11px]">
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-semibold text-charcoal-600">API endpoint</dt>
                      <dd className="font-mono text-charcoal-800">{cashfree.apiBaseUrl}</dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-semibold text-charcoal-600">App ID</dt>
                      <dd className="font-mono text-charcoal-800">
                        {cashfree.appIdMasked}
                        {cashfree.appIdLooksLikeTestKey && (
                          <span className="ml-1 rounded bg-blue-100 px-1 font-sans font-semibold text-blue-800">TEST key</span>
                        )}
                      </dd>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2">
                      <dt className="font-semibold text-charcoal-600">Credentials</dt>
                      <dd className="flex items-center gap-1">
                        {cashfree.credentialsAccepted === true ? (
                          <><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /><span className="font-semibold text-green-700">accepted by Cashfree</span></>
                        ) : cashfree.credentialsAccepted === false ? (
                          <><XCircle className="h-3.5 w-3.5 text-red-600" /><span className="font-semibold text-red-700">REJECTED</span></>
                        ) : (
                          <span className="text-charcoal-500">could not verify</span>
                        )}
                      </dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-semibold text-charcoal-600">Webhook URL</dt>
                      <dd className="break-all font-mono text-charcoal-800">{cashfree.webhookUrl}</dd>
                    </div>
                  </dl>

                  {cashfree.modeKeyMismatch && (
                    <p className="mt-2 rounded-lg bg-red-100 p-2 text-[11px] font-semibold text-red-900">
                      Mismatch: CASHFREE_ENV says <span className="font-mono">{cashfree.mode}</span> but the App ID is a{" "}
                      {cashfree.appIdLooksLikeTestKey ? "TEST" : "live"} key. Payments will fail. Set both to the same environment.
                    </p>
                  )}
                  {cashfree.credentialsError && !cashfree.modeKeyMismatch && (
                    <p className="mt-2 rounded-lg bg-white/70 p-2 text-[11px] text-red-800">{cashfree.credentialsError}</p>
                  )}
                  {/* THIS USED TO READ LIKE A MISCONFIGURATION AND IS NOT ONE.
                      Cashfree's own documentation is explicit: "You need your
                      Cashfree PG secret key and the payload to verify the
                      signature" — PG webhooks are signed with the CLIENT
                      SECRET, not with a separate dashboard-issued webhook
                      secret. There is nothing to go and find. The old wording
                      sent an operator hunting for a value that does not exist,
                      on the settings page they check when unsure.
                      https://www.cashfree.com/docs/payments/online/webhooks/signature-verification */}
                  {!cashfree.webhookSecretConfigured ? (
                    <p className="mt-2 rounded-lg bg-white/70 p-2 text-[11px] text-charcoal-600">
                      Webhook signatures are verified with the PG secret key, which is what Cashfree
                      signs with. This is the correct setup — there is no separate webhook secret to
                      configure. CASHFREE_WEBHOOK_SECRET is only needed to pin a specific key while
                      rotating the API secret.
                    </p>
                  ) : (
                    <p className="mt-2 rounded-lg bg-white/70 p-2 text-[11px] text-amber-800">
                      CASHFREE_WEBHOOK_SECRET is set, so signatures are verified with THAT value and
                      not with the PG secret key. Cashfree signs with the PG secret key, so this only
                      works if the two are the same — clear it unless you set it deliberately to pin
                      a key through a rotation.
                    </p>
                  )}
                  {/* WHO CAN ACTUALLY BE PAID. The Payouts credentials being
                      accepted says nothing about this: every transfer is still
                      refused unless the owner's own account reached VERIFIED.
                      A failed count is NOT evidence of zero, so it says so
                      rather than implying everything is fine — the mistake this
                      very banner made when it was first written. */}
                  <p className={`mt-2 rounded-lg p-2 text-[11px] ${
                    verifiedBeneficiaries === null
                      ? "bg-amber-100 font-semibold text-amber-900"
                      : verifiedBeneficiaries === 0
                        ? "bg-amber-100 font-semibold text-amber-900"
                        : "bg-white/70 text-charcoal-700"
                  }`}>
                    {verifiedBeneficiaries === null ? (
                      <>
                        The number of owners with a verified payout account <strong>could not be
                        read</strong>. Treat automatic payouts as unproven until this shows a number.
                      </>
                    ) : verifiedBeneficiaries === 0 ? (
                      <>
                        No owner has a VERIFIED payout account yet, so no transfer can succeed.
                        Register each owner&rsquo;s bank details from the payout queue on{" "}
                        <Link href="/admin/payments" className="font-semibold underline">Payments</Link>{" "}
                        — until then every payout is a bank transfer by hand.
                      </>
                    ) : (
                      <>
                        {verifiedBeneficiaries} owner{verifiedBeneficiaries === 1 ? " has" : "s have"} a
                        VERIFIED payout account and can be paid from the queue on{" "}
                        <Link href="/admin/payments" className="font-semibold underline">Payments</Link>.
                        Owners without one are refused at dispatch, not silently skipped.
                      </>
                    )}
                  </p>
                  {cashfree.publicEnvVarMisleading && (
                    <p className="mt-2 rounded-lg bg-white/70 p-2 text-[11px] text-charcoal-600">
                      NEXT_PUBLIC_CASHFREE_ENV is set to{" "}
                      <span className="font-mono break-all">{cashfree.publicEnvVarValue}</span>, which is not
                      &ldquo;production&rdquo; or &ldquo;sandbox&rdquo;. No code reads this variable — the checkout mode comes from
                      CASHFREE_ENV above — so it is harmless, but it is safe to delete to avoid confusion.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* CASHFREE PAYOUTS — the money going OUT.
            A separate product from the gateway with its own credentials, its own
            host and its own activation switch, so "payments work" says nothing
            about whether an owner can be paid. This card exists because the
            credentials are write-only in Vercel and there is nowhere else to
            look. */}
        <div className={`rounded-2xl border-2 p-5 ${
          !payouts.configured ? "border-amber-200 bg-amber-50"
          : payouts.credentialsAccepted === false ? "border-red-200 bg-red-50"
          : payouts.credentialsAccepted === null ? "border-amber-200 bg-amber-50"
          : payouts.mode === "production" ? "border-green-200 bg-green-50"
          : "border-blue-200 bg-blue-50"}`}>
          <div className="flex items-start gap-3">
            <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-charcoal-700" />
            <div className="min-w-0 flex-1">
              <h3 className="font-serif text-sm font-semibold text-charcoal-900">Owner payouts</h3>

              {!payouts.configured ? (
                <p className="mt-0.5 text-xs text-amber-800">
                  Not configured. Owners cannot be paid automatically — every payout is a bank
                  transfer by hand from the queue on{" "}
                  <Link href="/admin/payments" className="font-semibold underline">Payments</Link>.
                  Set <span className="font-mono">CASHFREE_PAYOUT_CLIENT_ID</span> and{" "}
                  <span className="font-mono">CASHFREE_PAYOUT_CLIENT_SECRET</span> in Vercel and
                  redeploy. These are a SEPARATE pair from the gateway keys.
                </p>
              ) : (
                <>
                  <p className="mt-0.5 text-xs text-charcoal-700">
                    Running in <span className="font-bold uppercase">{payouts.mode}</span>
                    {payouts.mode === "production" ? " — real money will be sent." : " — test money only."}
                  </p>
                  <dl className="mt-3 space-y-1 text-[11px]">
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-semibold text-charcoal-600">API endpoint</dt>
                      <dd className="font-mono text-charcoal-800">{payouts.apiBaseUrl}</dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-semibold text-charcoal-600">Payout client ID</dt>
                      <dd className="font-mono text-charcoal-800">{payouts.clientIdMasked}</dd>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2">
                      <dt className="font-semibold text-charcoal-600">Credentials</dt>
                      <dd className="flex items-center gap-1">
                        {payouts.credentialsAccepted === true ? (
                          <><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /><span className="font-semibold text-green-700">accepted by Cashfree</span></>
                        ) : payouts.credentialsAccepted === false ? (
                          <><XCircle className="h-3.5 w-3.5 text-red-600" /><span className="font-semibold text-red-700">REJECTED</span></>
                        ) : (
                          <span className="text-charcoal-500">could not verify</span>
                        )}
                      </dd>
                    </div>
                    {/* Without this, an IP-allowlist rejection and a genuine
                        credentials problem look identical on this card. */}
                    <div className="flex flex-wrap items-center gap-x-2">
                      <dt className="font-semibold text-charcoal-600">Auth method</dt>
                      <dd className="text-charcoal-800">
                        {!payouts.signatureConfigured
                          ? "IP allowlist only — no 2FA public key set"
                          : payouts.signatureError
                            ? "X-Cf-Signature — KEY UNUSABLE, header not sent"
                            : "X-Cf-Signature (works from any IP)"}
                      </dd>
                    </div>
                  </dl>
                  {/* OUR fault, not Cashfree's, and they cannot tell you which:
                      an unparseable key means we send no header at all, and the
                      only thing Cashfree can say is that it is missing. */}
                  {payouts.signatureError && (
                    <p className="mt-2 rounded-lg bg-red-100 p-2 text-[11px] font-semibold text-red-900">
                      The 2FA public key is set but cannot be used, so requests go out with no
                      signature. {payouts.signatureError}
                    </p>
                  )}
                  {payouts.error && (
                    <p className={`mt-2 rounded-lg p-2 text-[11px] ${payouts.notActivated ? "bg-red-100 font-semibold text-red-900" : "bg-white/70 text-charcoal-700"}`}>
                      {payouts.error}
                    </p>
                  )}
                  <p className="mt-2 rounded-lg bg-white/70 p-2 text-[11px] text-charcoal-700">
                    Transfers are sent by an admin from the payout queue, one at a time — nothing
                    dispatches automatically on acceptance. A transfer that reports SUCCESS can
                    still reverse within 24 hours, so <strong>Reconcile</strong> on a payout row is
                    the authority, not the summary shown against the booking.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Phone verification (MSG91 OTP) and outbound SMS.
            The credentials are write-only in Vercel, so "what did production
            actually pick up?" is unanswerable anywhere else. Same reasoning as
            the Cashfree readout above: surface it, because there is no other way
            to see it. The auth key is shown only as its last four characters. */}
        <div className={`rounded-2xl border-2 p-5 ${otpConfigured ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
          <div className="flex items-start gap-3">
            <ShieldCheck className={`mt-0.5 h-5 w-5 shrink-0 ${otpConfigured ? "text-green-600" : "text-amber-600"}`} />
            <div className="min-w-0 flex-1">
              <h3 className="font-serif text-sm font-semibold text-charcoal-900">Phone verification</h3>
              {otpConfigured ? (
                <>
                  <p className="mt-0.5 text-xs text-charcoal-700">
                    MSG91 OTP is configured. One-time codes are sent{" "}
                    <span className="font-bold uppercase">by SMS</span>. MSG91 generates,
                    expires and checks the code — Hallnect never stores one.
                  </p>
                  <p className="mt-2 rounded-lg bg-white/70 p-2 text-[11px] text-charcoal-600">
                    Auth key {msg91.authKeyHint} · OTP template{" "}
                    <span className="font-mono">{msg91.otpTemplateId?.slice(0, 8)}…</span>
                  </p>
                </>
              ) : (
                <p className="mt-0.5 text-xs text-amber-900">
                  Not configured — still needs{" "}
                  <strong>{otpMissing.join(" and ")}</strong>.
                  {msg91.authKeyHint
                    ? ` The auth key in effect is ${msg91.authKeyHint}.`
                    : ""}
                  {msg91.malformedOtpTemplateId
                    ? " MSG91_OTP_TEMPLATE_ID is set but is not a 24-character template id."
                    : ""}{" "}
                  The OTP body must be registered on the DLT portal before MSG91 will
                  issue that template id. Until then the &ldquo;Verify your phone&rdquo; row
                  is hidden from profiles rather than leading to a dead end.
                </p>
              )}
            </div>
          </div>
        </div>

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
          {/* Read live. This row said "0011 (booking cleanup)" for fifty-six
              migrations, directly above a sentence promising live state. */}
          <ConfigRow
            label="Latest migration applied"
            value={schemaState ? (schemaState.name ?? schemaState.version) : "could not read"}
          />
          <ConfigRow
            label="Migrations applied"
            value={schemaState ? String(schemaState.count) : "—"}
          />
          <p className="mt-3 text-[11px] text-charcoal-500">
            Read live from the database, not from this repository — the two can disagree, and when they do it
            is this one that is true. Run new migrations through the Supabase SQL editor.
          </p>
        </Section>

        {/* Pending booking cleanup */}
        <Section title="Booking Maintenance" icon={<Timer className="h-4 w-4" />}>
          <ConfigRow label="Pending payment timeout" value={`${PENDING_PAYMENT_TIMEOUT_MIN} minutes`} />
          <p className="mt-2 text-[11px] text-charcoal-500">
            Expired pending bookings are auto-cancelled by{" "}
            <code className="rounded bg-ivory-200 px-1 py-0.5">cleanup_expired_pending_bookings()</code>.
            Recommended: schedule it via pg_cron to run every minute. Use the button below to run it once manually.
          </p>
          <div className="mt-3">
            <CleanupButton />
          </div>
        </Section>

        {/* Analytics */}
        <Section title="Analytics" icon={<BarChart3 className="h-4 w-4" />}>
          <ConfigRow label="Google Analytics" value={GA_MEASUREMENT_ID} />
          <p className="mt-2 text-[11px] text-charcoal-500">
            Loads only for visitors who accept the cookie banner. Nothing is sent to Google before that.
          </p>
          <div className="mt-3">
            <InternalTrafficToggle />
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
