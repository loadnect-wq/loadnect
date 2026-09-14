import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import Link from "next/link";
import { BellRing, CheckCheck, MessageSquareWarning, ShieldCheck } from "lucide-react";
import {
  fetchNotifications,
  fetchNotificationStats,
  type AdminNotificationRow,
} from "@/lib/admin";
import { getMsg91Status } from "@/lib/msg91";
import { smsTemplateConfigStatus, dltBody, templateIdFor } from "@/lib/notifications/sms-templates";
import { maskPhone } from "@/lib/notifications/phone";
import { resolveAdminNotificationPhone } from "@/lib/notifications/service";
import { AdminAlertNumberForm } from "./_components/AdminAlertNumberForm";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { ConfirmButton } from "../_components/ConfirmButton";
import { retryNotification, markNotificationRead, markAllNotificationsRead } from "../actions";

export const metadata: Metadata = { title: "SMS notifications — Admin" };

/**
 * `value` is what fetchNotifications filters on — a single status, or a SET.
 *
 * PENDING IS TWO STATUSES, NOT ONE. A message is written 'pending', flipped to
 * 'processing' the moment a sender claims it, and only then to sent/failed. A
 * crash between the claim and the result strands the row at 'processing'
 * forever. The Pending chip used to be an exact match on 'pending' alone, so
 * every stranded row was invisible here — while fetchNotificationStats counted
 * it in totalPending and retryNotification() would happily re-send it once it
 * was 15 minutes stale. The count and the chip now select the same two states,
 * which is the whole point: the number on the tile is a number you can click.
 */
const STATUS_FILTERS: {
  key: string; label: string; value?: string | string[]; unread?: boolean;
}[] = [
  { key: "all",     label: "All",     value: undefined },
  { key: "sent",    label: "Sent",    value: "sent" },
  { key: "failed",  label: "Failed",  value: "failed" },
  { key: "skipped", label: "Skipped", value: "skipped" },
  { key: "pending", label: "Pending", value: ["pending", "processing"] },
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

/**
 * The OPERATOR's verdict, which arrives later on the delivery-report webhook
 * and can disagree with ours: a message can be status='sent' (MSG91 accepted
 * it) and delivery_status='undelivered' (the handset never got it).
 */
const DELIVERY_TONE: Record<string, string> = {
  delivered:   "bg-green-50 text-green-700 border-green-200",
  accepted:    "bg-charcoal-50 text-charcoal-600 border-charcoal-200",
  undelivered: "bg-red-50 text-red-700 border-red-200",
  failed:      "bg-red-50 text-red-700 border-red-200",
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
  // Staleness is decided in fetchAdminNotifications against one instant for
  // the whole page, so the clock is never read during a render.
  const isStale = row.isStale === true;
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
            text={`DLR: ${row.delivery_status}`}
            tone={DELIVERY_TONE[row.delivery_status] ?? DELIVERY_TONE.accepted}
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
          <span className="font-mono">Req: {row.provider_message_id.slice(0, 12)}…</span>
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
  // ASSERTS ITS OWN ROLE. The layout also calls requireRole, but a layout and
  // its page render CONCURRENTLY in the App Router — the layout's redirect does
  // not stop this component's queries from being issued first. An anonymous
  // request therefore ran every read below as `anon`, was denied by the grants,
  // and only then got its 307. Nothing leaked, but the work was wasted and each
  // denial now logs at error level, which would bury real failures. Guarding
  // here also means this page is not relying on a file it does not control.
  await requireRole(["admin"]);
  const { filter, q, page, to, cat } = await searchParams;
  const activeFilter = STATUS_FILTERS.find((f) => f.key === filter) ?? STATUS_FILTERS[0];
  const activeTo  = RECIPIENT_FILTERS.find((f) => f.key === to)?.key;
  const activeCat = CATEGORY_FILTERS.find((f) => f.key === cat)?.key;
  const search = (q ?? "").trim();
  const pageNum = Number.parseInt(page ?? "1", 10) || 1;

  const [log, stats, adminPhone] = await Promise.all([
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
  ]);

  const msg91 = getMsg91Status();

  // DLT approval is NOT queryable: it happens on a telecom operator's portal,
  // outside MSG91's API. So the honest thing to show is our own configuration —
  // "is a template id set for this event" — and never a claim about approval we
  // have no way to verify. A template id that was never DLT-approved simply
  // fails at send time, and that failure lands on the row below.
  const templates = smsTemplateConfigStatus();
  const templatesReady = templates.filter((t) => t.configured).length;
  const templatesBroken = templates.filter((t) => t.malformed);

  // Name ONLY what is actually missing. "Set MSG91_AUTH_KEY and MSG91_SENDER_ID"
  // when the key is already set sends whoever reads it to check a variable that
  // is fine, which is exactly the kind of message that wastes an afternoon.
  // Whenever the key IS set, its masked hint is shown instead, which is also the
  // only way to confirm which key production actually picked up.
  const missingCredentials = [
    msg91.authKeyHint ? null : "MSG91_AUTH_KEY",
    msg91.senderId ? null : msg91.malformedSenderId
      ? "a valid MSG91_SENDER_ID (the current value is not a usable DLT header)"
      : "MSG91_SENDER_ID",
  ].filter((v): v is string => v !== null);

  const testModeMisconfigured = msg91.testMode && !msg91.testRecipient;
  const live =
    msg91.enabled && msg91.configured && templatesReady > 0 && !testModeMisconfigured;

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
        title="SMS notifications"
        description="Every SMS the platform has queued — sent, delivered, failed, or skipped while messaging is not fully configured."
      />

      <div className="p-4 sm:p-6 lg:p-8">
        {/* MSG91 status — masked configuration only, never credentials. */}
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
          <div className={`rounded-xl border p-3 ${live ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
            <p className="text-[10px] font-bold uppercase tracking-wide text-charcoal-500">MSG91 SMS</p>
            <p className="mt-0.5 text-sm font-bold text-charcoal-900">
              {!msg91.enabled ? "Disabled"
                : msg91.malformedSenderId ? "Sender ID is not a valid DLT header"
                : !msg91.configured ? `Enabled — missing ${missingCredentials.length} of 2 credentials`
                // Checked BEFORE the template states: while this is true nothing
                // sends at all, so reporting a template problem would be a lie
                // about why messages are not going out.
                : testModeMisconfigured ? "Blocked — test mode has no recipient"
                : templatesReady === 0 ? "No DLT templates configured"
                : msg91.testMode ? "Live — TEST MODE" : "Live"}
            </p>
            <p className="text-[10px] text-charcoal-500">
              {testModeMisconfigured
                ? "Set MSG91_TEST_TO, or set MSG91_TEST_MODE=false"
                : msg91.configured
                ? `Key ${msg91.authKeyHint} · sender ${msg91.senderId}`
                : missingCredentials.length > 0
                  ? `Set ${missingCredentials.join(" and ")}`
                  : "Credentials incomplete"}
            </p>
          </div>
          {/* Pending is counted here AND selectable below — see STATUS_FILTERS.
              It was already being fetched and shown nowhere, which is how a
              message stuck mid-send could exist with nothing on the page ever
              mentioning it. Each of these is a link to the filter that returns
              exactly the rows it counts. */}
          {[
            { label: "Sent",        value: stats.totalSent,    filter: "sent" },
            { label: "Failed",      value: stats.totalFailed,  filter: "failed" },
            { label: "Undelivered", value: stats.undelivered,  filter: undefined },
            { label: "Skipped",     value: stats.totalSkipped, filter: "skipped" },
            { label: "Pending",     value: stats.totalPending, filter: "pending" },
          ].map((s) => {
            const body = (
              <>
                <p className="text-[10px] font-bold uppercase tracking-wide text-charcoal-500">{s.label}</p>
                <p className="mt-0.5 text-lg font-bold text-charcoal-900">{s.value.toLocaleString("en-IN")}</p>
              </>
            );
            // 'Undelivered' is the OPERATOR's verdict on delivery_status, not
            // one of our send-side statuses, so no status chip selects it and
            // it stays a plain tile rather than a link that would lie.
            return s.filter ? (
              <Link
                key={s.label}
                href={qs({ filter: s.filter, page: undefined })}
                className="rounded-xl border border-border bg-white p-3 transition-colors hover:bg-ivory-50"
              >
                {body}
              </Link>
            ) : (
              <div key={s.label} className="rounded-xl border border-border bg-white p-3">{body}</div>
            );
          })}
          <div className="rounded-xl border border-border bg-white p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-charcoal-500">Templates configured</p>
            <p className="mt-0.5 text-lg font-bold text-charcoal-900">
              {templatesReady}<span className="text-sm font-semibold text-charcoal-400">/{templates.length}</span>
            </p>
            <p className="text-[10px] text-charcoal-500">
              {templatesBroken.length > 0
                ? `${templatesBroken.length} set to an invalid id`
                : `${templates.length - templatesReady} still to register on DLT`}
            </p>
          </div>
        </div>

        {/* WHO RECEIVES PLATFORM ALERTS.
            The page already resolved this number and already imported the
            form to change it — and then rendered neither, so the one control
            an operator has over where alerts land was unreachable while the
            admin channel was the one known to be failing. The number is passed
            in masked: an admin can replace it without it appearing in the
            page source. */}
        <div className="mb-4 rounded-xl border border-border bg-white p-4">
          <AdminAlertNumberForm
            currentMasked={adminPhone.phone ? maskPhone(adminPhone.phone) : "—"}
            source={adminPhone.source}
          />
        </div>

        {/* Per-template state. Two DIFFERENT things have to be true before a
            message can be delivered in India, and only one of them is visible
            from here:
              1. the body is registered and approved on a telecom DLT portal
                 (not queryable from any API — it lives with the operator), and
              2. the resulting MSG91 template id is set in the environment.
            Only (2) is shown, because asserting (1) without being able to check
            it would be a guess presented as a status. The exact body to register
            is printed so it can be pasted into the DLT portal verbatim — the
            operator matches on the text, character for character. */}
        {templatesReady < templates.length && (
          <details className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-amber-900">
              {templatesBroken.length > 0
                ? `${templatesBroken.length} template id${templatesBroken.length === 1 ? " is" : "s are"} invalid · ${templatesReady}/${templates.length} configured`
                : `${templates.length - templatesReady} template${templates.length - templatesReady === 1 ? "" : "s"} not configured — see below for what each one does while it waits`}
            </summary>

            {/* "not configured" NO LONGER MEANS "nothing is sent" for every
                template, and a blanket sentence saying it did was false the
                moment the lead substitution shipped. A new enquiry still
                reaches the venue — on the approved generic owner template —
                so the operator must not read an amber chip here as silence.
                Stated once, above the list, rather than repeated per row. */}
            {!templateIdFor("OWNER_NEW_LEAD") && templateIdFor("OWNER_ACCOUNT_STATUS") && (
              <p className="mt-2 rounded-lg border border-amber-300 bg-white/60 p-2 text-[11px] leading-relaxed text-amber-900">
                <strong>OWNER_NEW_LEAD is being stood in for.</strong> Until it is approved on
                DLT, a new enquiry is announced to the venue on{" "}
                <code className="font-mono">OWNER_ACCOUNT_STATUS</code>, which is approved and
                generic enough to carry it — the venue still gets the customer&apos;s name, date
                and phone. This ends by itself the moment{" "}
                <code className="font-mono">MSG91_TEMPLATE_OWNER_NEW_LEAD</code> is set; there is
                nothing to undo. The CUSTOMER&apos;s enquiry confirmation is <em>not</em>{" "}
                substituted — every approved customer template says &ldquo;hall booking&rdquo;,
                and telling someone their venue is booked when they only enquired is not a
                stand-in, it is a false statement.
              </p>
            )}

            <ul className="mt-2 space-y-3">
              {templates.map((t) => (
                <li key={t.key} className="border-t border-amber-200 pt-2 text-[11px] first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Chip
                      text={t.malformed ? "invalid id" : t.configured ? "configured" : "not configured"}
                      tone={
                        t.malformed
                          ? "bg-red-50 text-red-700 border-red-200"
                          : t.configured
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-charcoal-50 text-charcoal-600 border-charcoal-200"
                      }
                    />
                    <code className="font-mono font-semibold text-charcoal-800">{t.key}</code>
                    <span className="text-charcoal-600">{t.purpose}</span>
                    <span className="ml-auto text-charcoal-500">
                      {t.segments} SMS segment{t.segments === 1 ? "" : "s"}
                    </span>
                  </div>

                  {!t.configured && (
                    <p className="mt-1">
                      <code className="font-mono text-amber-900">set {t.envVar}</code>
                      {t.malformed && (
                        <span className="ml-2 font-semibold text-red-700">
                          — set, but not a 24-character MSG91 template id
                        </span>
                      )}
                    </p>
                  )}

                  <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-white p-2 font-mono text-[10px] leading-relaxed text-charcoal-700">
                    {dltBody(t.key)}
                  </p>
                </li>
              ))}
            </ul>

            <p className="mt-2 border-t border-amber-200 pt-2 text-[10px] leading-relaxed text-amber-800">
              Indian A2P SMS runs under TRAI&apos;s DLT regime. Each body above must be
              registered against the sender header on a DLT portal and approved by
              the operator; MSG91 then issues a template id for it. A message whose
              body does not match a registered template is dropped by the operator
              <strong> silently</strong> — there is no error to catch, which is why
              nothing here claims a template is approved.
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
              Run migrations <code className="font-mono">0026_notifications.sql</code>,{" "}
              <code className="font-mono">0030_whatsapp_notifications.sql</code> and{" "}
              <code className="font-mono">0047_msg91_sms.sql</code> to enable the outbox.
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
          Recipient numbers are masked here and the MSG91 auth key is never displayed or logged.
          Message content is composed server-side from registered templates — it can never be set by a customer.
        </p>
      </div>
    </div>
  );
}
