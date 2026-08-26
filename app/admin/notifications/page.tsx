import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, CheckCheck, MessageSquareWarning, ShieldCheck } from "lucide-react";
import {
  fetchNotifications,
  fetchNotificationStats,
  type AdminNotificationRow,
} from "@/lib/admin";
import { getWhatsAppStatus } from "@/lib/twilio/whatsapp";
import { templateConfigStatus } from "@/lib/notifications/whatsapp-templates";
import { fetchTemplateApprovals, type TemplateApprovalStatus } from "@/lib/twilio/approvals";
import { maskPhone } from "@/lib/notifications/phone";
import { resolveAdminNotificationPhone } from "@/lib/notifications/service";
import { AdminAlertNumberForm } from "./_components/AdminAlertNumberForm";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { ConfirmButton } from "../_components/ConfirmButton";
import { retryNotification, markNotificationRead, markAllNotificationsRead } from "../actions";

export const metadata: Metadata = { title: "WhatsApp notifications — Admin" };

const STATUS_FILTERS = [
  { key: "all",     label: "All",     value: undefined },
  { key: "sent",    label: "Sent",    value: "sent" },
  { key: "failed",  label: "Failed",  value: "failed" },
  { key: "skipped", label: "Skipped", value: "skipped" },
  { key: "pending", label: "Pending", value: "pending" },
  { key: "unread",  label: "Unread",  value: undefined, unread: true },
];

/** §18: filter by who it went to and what it was about. */
const RECIPIENT_FILTERS = [
  { key: "customer", label: "Customer" },
  { key: "owner",    label: "Owner" },
  { key: "admin",    label: "Admin" },
];
const CATEGORY_FILTERS = [
  { key: "booking",    label: "Booking" },
  { key: "payment",    label: "Payment" },
  { key: "hall",       label: "Hall" },
  { key: "commission", label: "Commission" },
];

const STATUS_TONE: Record<string, string> = {
  sent:       "bg-green-50 text-green-700 border-green-200",
  failed:     "bg-red-50 text-red-700 border-red-200",
  skipped:    "bg-amber-50 text-amber-800 border-amber-200",
  pending:    "bg-charcoal-50 text-charcoal-700 border-charcoal-200",
  processing: "bg-charcoal-50 text-charcoal-700 border-charcoal-200",
  cancelled:  "bg-charcoal-50 text-charcoal-500 border-charcoal-200",
};

/** WhatsApp's own view of the message, which can disagree with ours. */
const DELIVERY_TONE: Record<string, string> = {
  delivered:   "bg-green-50 text-green-700 border-green-200",
  read:        "bg-green-100 text-green-800 border-green-300",
  sent:        "bg-blue-50 text-blue-700 border-blue-200",
  queued:      "bg-charcoal-50 text-charcoal-600 border-charcoal-200",
  sending:     "bg-charcoal-50 text-charcoal-600 border-charcoal-200",
  accepted:    "bg-charcoal-50 text-charcoal-600 border-charcoal-200",
  undelivered: "bg-red-50 text-red-700 border-red-200",
  failed:      "bg-red-50 text-red-700 border-red-200",
};

/** Meta's verdict on a template. `undefined` = no Content SID configured. */
const APPROVAL_TONE: Record<string, string> = {
  approved:    "bg-green-50 text-green-700 border-green-200",
  pending:     "bg-amber-50 text-amber-800 border-amber-200",
  received:    "bg-amber-50 text-amber-800 border-amber-200",
  rejected:    "bg-red-50 text-red-700 border-red-200",
  unsubmitted: "bg-charcoal-50 text-charcoal-600 border-charcoal-200",
  unknown:     "bg-charcoal-50 text-charcoal-500 border-charcoal-200",
};

const APPROVAL_LABEL: Record<string, string> = {
  approved:    "approved",
  pending:     "awaiting Meta",
  received:    "submitted",
  rejected:    "rejected",
  unsubmitted: "not submitted",
  unknown:     "status unknown",
};

function fmtWhen(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function Chip({ text, tone }: { text: string; tone: string }) {
  return (
    <span className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${tone}`}>
      {text}
    </span>
  );
}

function NotificationCard({ row }: { row: AdminNotificationRow }) {
  const isStale =
    (row.status === "pending" || row.status === "processing") &&
    Date.now() - new Date(row.created_at).getTime() > 15 * 60 * 1000;
  const canRetry =
    (row.status === "failed" || row.status === "skipped" || isStale) &&
    // A row with NO recipient phone is still retryable when it is linked to a
    // booking or hall: the retry re-derives the number, so a message written
    // before the owner added their phone becomes deliverable rather than lost.
    (!!row.recipient_phone || !!row.booking_id || !!row.hall_id || row.recipient_type === "admin") &&
    row.attempt_count < 5 &&
    // A permanent failure repeats identically; offering the button would only
    // burn an attempt. Skipped rows stay retryable — they are waiting on
    // configuration, and fixing it is exactly when a retry should work.
    !(row.permanent_failure && row.status === "failed");

  return (
    <div className={`rounded-xl border bg-white p-3 ${row.is_read ? "border-border" : "border-maroon-300"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {!row.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-maroon-600" aria-label="Unread" />}
        <span className="font-mono text-[11px] font-semibold text-charcoal-800">{row.event_type}</span>
        <Chip text={row.status} tone={STATUS_TONE[row.status] ?? STATUS_TONE.pending} />
        {row.delivery_status && (
          <Chip
            text={`WA: ${row.delivery_status}`}
            tone={DELIVERY_TONE[row.delivery_status] ?? DELIVERY_TONE.queued}
          />
        )}
        {row.test_mode && (
          <Chip text="TEST" tone="bg-purple-50 text-purple-700 border-purple-200" />
        )}
        <span className="rounded-md bg-ivory-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-charcoal-500">
          {row.recipient_type}
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-charcoal-400">{fmtWhen(row.created_at)}</span>
      </div>

      {/* The rendered template — exactly the text the recipient received. */}
      <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-charcoal-700">{row.message}</p>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-charcoal-500">
        <span>To: {maskPhone(row.recipient_phone)}</span>
        {row.template_key && <span className="font-mono">{row.template_key}</span>}
        {row.sent_at && <span>Sent: {fmtWhen(row.sent_at)}</span>}
        {row.delivery_updated_at && <span>Updated: {fmtWhen(row.delivery_updated_at)}</span>}
        {row.attempt_count > 0 && <span>Attempts: {row.attempt_count}</span>}
        {row.provider_message_id && (
          <span className="font-mono">SID: {row.provider_message_id.slice(0, 12)}…</span>
        )}
      </div>

      {row.error_message && (
        <p className="mt-1.5 rounded-lg bg-red-50 p-2 text-[11px] text-red-700">
          {row.error_code && <span className="font-mono font-semibold">[{row.error_code}] </span>}
          {row.error_message}
          {row.permanent_failure && row.status === "failed" && (
            <span className="ml-1 font-semibold">Retry will not help.</span>
          )}
        </p>
      )}

      <div className="mt-2 flex flex-wrap justify-end gap-1.5">
        {!row.is_read && (
          <ConfirmButton
            action={markNotificationRead.bind(null, row.id)}
            label="Mark read"
            confirmText="Mark read"
            hideOnSuccess doneLabel="✓ Read"
          />
        )}
        {canRetry && (
          <ConfirmButton
            action={retryNotification.bind(null, row.id)}
            label="Retry send"
            confirmText="Confirm retry"
            variant="success"
            hideOnSuccess doneLabel="✓ Sent"
          />
        )}
      </div>
    </div>
  );
}

type Props = {
  searchParams: Promise<{
    filter?: string; q?: string; page?: string; to?: string; cat?: string;
  }>;
};

export default async function AdminNotificationsPage({ searchParams }: Props) {
  const { filter, q, page, to, cat } = await searchParams;
  const activeFilter = STATUS_FILTERS.find((f) => f.key === filter) ?? STATUS_FILTERS[0];
  const activeTo  = RECIPIENT_FILTERS.find((f) => f.key === to)?.key;
  const activeCat = CATEGORY_FILTERS.find((f) => f.key === cat)?.key;
  const search = (q ?? "").trim();
  const pageNum = Number.parseInt(page ?? "1", 10) || 1;

  const [log, stats, adminPhone, approvals] = await Promise.all([
    fetchNotifications({
      status:    activeFilter.value,
      unread:    activeFilter.unread,
      search:    search || undefined,
      recipient: activeTo,
      category:  activeCat,
      page:      pageNum,
    }),
    fetchNotificationStats(),
    resolveAdminNotificationPhone(),
    // Meta's verdict per template. Fails soft — the page renders without it.
    fetchTemplateApprovals(),
  ]);

  const wa = getWhatsAppStatus();
  // Join our configuration against Meta's verdict, keyed by Content SID.
  // A configured SID only means "we know which template to reference"; it says
  // nothing about whether Meta will let us send it.
  const templates = templateConfigStatus().map((t) => ({
    ...t,
    approval: (approvals.ok && t.sid ? approvals.bySid[t.sid]?.status : undefined)
      ?? (t.configured ? ("unknown" as TemplateApprovalStatus) : undefined),
    rejectionReason:
      approvals.ok && t.sid ? approvals.bySid[t.sid]?.rejectionReason ?? null : null,
  }));

  const templatesReady = templates.filter((t) => t.configured).length;
  const templatesBroken = templates.filter((t) => t.malformed);
  const templatesApproved = templates.filter((t) => t.approval === "approved").length;
  const templatesRejected = templates.filter((t) => t.approval === "rejected");
  const templatesWaiting = templates.filter(
    (t) => t.approval === "pending" || t.approval === "received",
  ).length;

  // Only genuinely live when Meta has approved at least one template — a
  // configured-but-unapproved SID fails at send time with error 63016.
  const live =
    wa.enabled && wa.configured && templatesApproved > 0 && !wa.testModeMisconfigured;

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = {
      filter: activeFilter.key === "all" ? undefined : activeFilter.key,
      q: search || undefined,
      to: activeTo,
      cat: activeCat,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const str = p.toString();
    return str ? `/admin/notifications?${str}` : "/admin/notifications";
  };

  return (
    <div>
      <AdminPageHeader
        title="WhatsApp notifications"
        description="Every WhatsApp message the platform has queued — sent, delivered, failed, or skipped while Twilio is disabled."
      />

      <div className="p-4 sm:p-6 lg:p-8">
        {/* Twilio status — masked configuration only, never credentials. */}
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <div className={`rounded-xl border p-3 ${live ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
            <p className="text-[10px] font-bold uppercase tracking-wide text-charcoal-500">Twilio WhatsApp</p>
            <p className="mt-0.5 text-sm font-bold text-charcoal-900">
              {!wa.enabled ? "Disabled"
                : !wa.configured ? "Enabled, no credentials"
                // Checked BEFORE the template states: while this is true nothing
                // sends at all, so reporting a template problem would be a lie
                // about why messages are not going out.
                : wa.testModeMisconfigured ? "Blocked — test mode has no recipient"
                : templatesReady === 0 ? "No templates configured"
                : templatesApproved === 0 ? "Awaiting Meta approval"
                : wa.testMode ? "Live — TEST MODE" : "Live"}
            </p>
            <p className="text-[10px] text-charcoal-500">
              {wa.testModeMisconfigured
                ? "Set TWILIO_WHATSAPP_TEST_TO, or set TWILIO_WHATSAPP_TEST_MODE=false"
                : wa.configured
                ? `SID ${wa.accountSidMasked} · ${wa.sender ?? "no sender"}`
                : "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM"}
            </p>
          </div>
          {[
            { label: "Sent",        value: stats.totalSent },
            { label: "Failed",      value: stats.totalFailed },
            { label: "Undelivered", value: stats.undelivered },
            { label: "Skipped",     value: stats.totalSkipped },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-white p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-charcoal-500">{s.label}</p>
              <p className="mt-0.5 text-lg font-bold text-charcoal-900">{s.value.toLocaleString("en-IN")}</p>
            </div>
          ))}
          <div className="rounded-xl border border-border bg-white p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-charcoal-500">Templates approved</p>
            <p className="mt-0.5 text-lg font-bold text-charcoal-900">
              {templatesApproved}<span className="text-sm font-semibold text-charcoal-400">/{templates.length}</span>
            </p>
            <p className="text-[10px] text-charcoal-500">
              {!approvals.ok
                ? "approval status unavailable"
                : templatesRejected.length > 0
                  ? `${templatesWaiting} awaiting · ${templatesRejected.length} rejected`
                  : `${templatesWaiting} awaiting Meta`}
            </p>
          </div>
        </div>

        {/* Per-template state: our configuration AND Meta's verdict. These
            are two different things — a Content SID being set does not mean
            WhatsApp will accept it — so both are shown side by side. Content
            SIDs are not secrets; they identify approved public message copy. */}
        {(templatesApproved < templates.length || !approvals.ok) && (
          <details className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-amber-900">
              {!approvals.ok
                ? `Template approval status unavailable — ${approvals.reason}`
                : templatesRejected.length > 0
                  ? `${templatesRejected.length} template${templatesRejected.length === 1 ? "" : "s"} rejected by Meta · ${templatesApproved}/${templates.length} approved`
                  : templatesReady < templates.length
                    ? `${templates.length - templatesReady} template${templates.length - templatesReady === 1 ? "" : "s"} not configured — messages using them are recorded as skipped, not sent`
                    : `${templatesApproved}/${templates.length} approved by Meta — the rest cannot be sent yet`}
            </summary>

            <ul className="mt-2 space-y-1.5">
              {templates.map((t) => (
                <li key={t.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                  <Chip
                    text={t.approval ? APPROVAL_LABEL[t.approval] : "not configured"}
                    tone={t.approval ? APPROVAL_TONE[t.approval] : APPROVAL_TONE.unsubmitted}
                  />
                  <code className="font-mono font-semibold text-charcoal-800">{t.key}</code>
                  <span className="text-charcoal-600">{t.purpose}</span>

                  {!t.configured && (
                    <code className="font-mono text-amber-900">set {t.envVar}</code>
                  )}
                  {t.malformed && (
                    <span className="font-semibold text-red-700">
                      set but not a valid HX… Content SID
                    </span>
                  )}
                  {t.rejectionReason && (
                    <span className="w-full text-red-700">
                      Meta&apos;s reason: {t.rejectionReason}
                    </span>
                  )}
                </li>
              ))}
            </ul>

            <p className="mt-2 border-t border-amber-200 pt-2 text-[10px] leading-relaxed text-amber-800">
              Approval comes from Meta and is read live from Twilio (cached ~2 min).
              A template must be <strong>approved</strong> before it can open a
              conversation — sending an unapproved one fails with Twilio error 63016.
            </p>
          </details>
        )}

        {/* Filters */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={qs({ filter: f.key === "all" ? undefined : f.key, page: undefined })}
              className={
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
                (f.key === activeFilter.key
                  ? "bg-maroon-600 text-white"
                  : "border border-border bg-white text-charcoal-600 hover:bg-ivory-50")
              }
            >
              {f.label}
            </Link>
          ))}
          {stats.unread > 0 && (
            <div className="ml-auto">
              <ConfirmButton
                action={markAllNotificationsRead}
                label={`Mark all ${stats.unread} read`}
                confirmText="Mark all read"
              />
            </div>
          )}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-charcoal-400">To</span>
          {RECIPIENT_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={qs({ to: activeTo === f.key ? undefined : f.key, page: undefined })}
              className={
                "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors " +
                (activeTo === f.key
                  ? "bg-charcoal-900 text-white"
                  : "border border-border bg-white text-charcoal-600 hover:bg-ivory-50")
              }
            >
              {f.label}
            </Link>
          ))}
          <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-charcoal-400">About</span>
          {CATEGORY_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={qs({ cat: activeCat === f.key ? undefined : f.key, page: undefined })}
              className={
                "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors " +
                (activeCat === f.key
                  ? "bg-charcoal-900 text-white"
                  : "border border-border bg-white text-charcoal-600 hover:bg-ivory-50")
              }
            >
              {f.label}
            </Link>
          ))}
        </div>

        <form action="/admin/notifications" className="mb-4 flex gap-2">
          {activeFilter.key !== "all" && <input type="hidden" name="filter" value={activeFilter.key} />}
          {activeTo && <input type="hidden" name="to" value={activeTo} />}
          {activeCat && <input type="hidden" name="cat" value={activeCat} />}
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search phone, event or message…"
            className="min-h-[44px] flex-1 rounded-xl border border-border bg-white px-3.5 text-sm text-charcoal-900 outline-none focus:border-maroon-500 focus:ring-1 focus:ring-maroon-500 lg:max-w-sm"
          />
          <button
            type="submit"
            className="min-h-[44px] rounded-xl bg-charcoal-900 px-4 text-sm font-semibold text-white hover:bg-charcoal-800"
          >
            Search
          </button>
        </form>

        {log.unavailable ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
            <MessageSquareWarning className="mx-auto h-8 w-8 text-amber-500" />
            <p className="mt-2 text-sm font-semibold text-amber-900">Notifications not provisioned</p>
            <p className="mt-1 text-xs text-amber-700">
              Run migrations <code className="font-mono">0026_notifications.sql</code> and{" "}
              <code className="font-mono">0030_whatsapp_notifications.sql</code> to enable the outbox.
            </p>
          </div>
        ) : log.rows.length === 0 ? (
          <div className="rounded-2xl border border-border bg-white p-10 text-center">
            <BellRing className="mx-auto h-8 w-8 text-charcoal-300" />
            <p className="mt-2 text-sm font-semibold text-charcoal-900">No notifications</p>
            <p className="mt-1 text-xs text-charcoal-500">
              {search || activeFilter.key !== "all" || activeTo || activeCat
                ? "Nothing matches these filters."
                : "Booking, payment and moderation messages will appear here as they are queued."}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {log.rows.map((row) => <NotificationCard key={row.id} row={row} />)}
            </div>

            {log.pages > 1 && (
              <div className="mt-4 flex items-center justify-between text-xs text-charcoal-600">
                <span className="flex items-center gap-1">
                  <CheckCheck className="h-3.5 w-3.5" />
                  Page {log.page} of {log.pages} · {log.total.toLocaleString("en-IN")} notifications
                </span>
                <div className="flex gap-2">
                  {log.page > 1 && (
                    <Link href={qs({ page: String(log.page - 1) })} className="rounded-lg border border-border bg-white px-3 py-2 font-semibold hover:bg-ivory-50">
                      Previous
                    </Link>
                  )}
                  {log.page < log.pages && (
                    <Link href={qs({ page: String(log.page + 1) })} className="rounded-lg border border-border bg-white px-3 py-2 font-semibold hover:bg-ivory-50">
                      Next
                    </Link>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        <p className="mt-6 flex items-start gap-1.5 text-[11px] leading-relaxed text-charcoal-400">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Recipient numbers are masked here and Twilio credentials are never displayed or logged.
          Message content is composed server-side from approved templates — it can never be set by a customer.
        </p>
      </div>
    </div>
  );
}
