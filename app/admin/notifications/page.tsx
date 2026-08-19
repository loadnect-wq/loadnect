import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, CheckCheck, MessageSquareWarning } from "lucide-react";
import {
  fetchNotifications,
  fetchNotificationStats,
  type AdminNotificationRow,
} from "@/lib/admin";
import { getTwilioSmsStatus } from "@/lib/twilio";
import { maskPhone } from "@/lib/notifications/phone";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { ConfirmButton } from "../_components/ConfirmButton";
import { retryNotification, markNotificationRead, markAllNotificationsRead } from "../actions";

export const metadata: Metadata = { title: "Notifications — Admin" };

const STATUS_FILTERS = [
  { key: "all",     label: "All",     value: undefined },
  { key: "sent",    label: "Sent",    value: "sent" },
  { key: "failed",  label: "Failed",  value: "failed" },
  { key: "skipped", label: "Skipped", value: "skipped" },
  { key: "pending", label: "Pending", value: "pending" },
  { key: "unread",  label: "Unread",  value: undefined, unread: true },
];

const STATUS_TONE: Record<string, string> = {
  sent:       "bg-green-50 text-green-700 border-green-200",
  failed:     "bg-red-50 text-red-700 border-red-200",
  skipped:    "bg-amber-50 text-amber-800 border-amber-200",
  pending:    "bg-charcoal-50 text-charcoal-700 border-charcoal-200",
  processing: "bg-charcoal-50 text-charcoal-700 border-charcoal-200",
  cancelled:  "bg-charcoal-50 text-charcoal-500 border-charcoal-200",
};

function fmtWhen(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${STATUS_TONE[status] ?? STATUS_TONE.pending}`}>
      {status}
    </span>
  );
}

function NotificationCard({ row }: { row: AdminNotificationRow }) {
  const isStale =
    (row.status === "pending" || row.status === "processing") &&
    Date.now() - new Date(row.created_at).getTime() > 15 * 60 * 1000;
  const canRetry =
    (row.status === "failed" || row.status === "skipped" || isStale) &&
    !!row.recipient_phone && row.attempt_count < 5;
  return (
    <div className={`rounded-xl border bg-white p-3 ${row.is_read ? "border-border" : "border-maroon-300"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {!row.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-maroon-600" aria-label="Unread" />}
        <span className="font-mono text-[11px] font-semibold text-charcoal-800">{row.event_type}</span>
        <StatusChip status={row.status} />
        <span className="rounded-md bg-ivory-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-charcoal-500">
          {row.recipient_type}
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-charcoal-400">{fmtWhen(row.created_at)}</span>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-charcoal-700">{row.message}</p>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-charcoal-500">
        <span>To: {maskPhone(row.recipient_phone)}</span>
        {row.sent_at && <span>Sent: {fmtWhen(row.sent_at)}</span>}
        {row.attempt_count > 0 && <span>Attempts: {row.attempt_count}</span>}
        {row.provider_message_id && <span className="font-mono">SID: {row.provider_message_id.slice(0, 10)}…</span>}
      </div>

      {row.error_message && (
        <p className="mt-1.5 rounded-lg bg-red-50 p-2 text-[11px] text-red-700">{row.error_message}</p>
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

type Props = { searchParams: Promise<{ filter?: string; q?: string; page?: string }> };

export default async function AdminNotificationsPage({ searchParams }: Props) {
  const { filter, q, page } = await searchParams;
  const activeFilter = STATUS_FILTERS.find((f) => f.key === filter) ?? STATUS_FILTERS[0];
  const search = (q ?? "").trim();
  const pageNum = Number.parseInt(page ?? "1", 10) || 1;

  const [log, stats] = await Promise.all([
    fetchNotifications({
      status: activeFilter.value,
      unread: activeFilter.unread,
      search: search || undefined,
      page:   pageNum,
    }),
    fetchNotificationStats(),
  ]);
  const twilio = getTwilioSmsStatus();

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = {
      filter: activeFilter.key === "all" ? undefined : activeFilter.key,
      q: search || undefined,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const str = p.toString();
    return str ? `/admin/notifications?${str}` : "/admin/notifications";
  };

  return (
    <div>
      <AdminPageHeader
        title="Notifications"
        description="Every SMS the platform has queued — sent, failed, or skipped while Twilio is disabled."
      />

      <div className="p-4 sm:p-6 lg:p-8">
        {/* Twilio status — masked config only, never credentials (§36). */}
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <div className={`rounded-xl border p-3 ${twilio.enabled && twilio.configured ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
            <p className="text-[10px] font-bold uppercase tracking-wide text-charcoal-500">Twilio SMS</p>
            <p className="mt-0.5 text-sm font-bold text-charcoal-900">
              {twilio.enabled ? (twilio.configured ? "Enabled" : "Enabled, not configured") : "Disabled"}
            </p>
            <p className="text-[10px] text-charcoal-500">
              {twilio.configured
                ? `SID ${twilio.accountSidMasked} · ${twilio.sender === "messaging_service" ? "Messaging Service" : "Phone number"}`
                : "Set TWILIO_* env vars, then TWILIO_ENABLED=true"}
            </p>
          </div>
          {[
            { label: "Sent",    value: stats.totalSent },
            { label: "Failed",  value: stats.totalFailed },
            { label: "Skipped", value: stats.totalSkipped },
            { label: "Unread",  value: stats.unread },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-white p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-charcoal-500">{s.label}</p>
              <p className="mt-0.5 text-lg font-bold text-charcoal-900">{s.value.toLocaleString("en-IN")}</p>
            </div>
          ))}
          <div className="rounded-xl border border-border bg-white p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-charcoal-500">Last sent / failed</p>
            <p className="mt-0.5 text-[11px] font-semibold text-charcoal-800">{fmtWhen(stats.lastSentAt)}</p>
            <p className="text-[11px] text-red-600">{fmtWhen(stats.lastFailedAt)}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
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

        <form action="/admin/notifications" className="mb-4 flex gap-2">
          {activeFilter.key !== "all" && <input type="hidden" name="filter" value={activeFilter.key} />}
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
              Run migration <code className="font-mono">0026_notifications.sql</code> to enable the SMS outbox.
            </p>
          </div>
        ) : log.rows.length === 0 ? (
          <div className="rounded-2xl border border-border bg-white p-10 text-center">
            <BellRing className="mx-auto h-8 w-8 text-charcoal-300" />
            <p className="mt-2 text-sm font-semibold text-charcoal-900">No notifications</p>
            <p className="mt-1 text-xs text-charcoal-500">
              {search || activeFilter.key !== "all"
                ? "Nothing matches these filters."
                : "Booking, payment and moderation SMS will appear here as they are queued."}
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
      </div>
    </div>
  );
}
