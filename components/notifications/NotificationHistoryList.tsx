import { BellOff } from "lucide-react";
import type { MyNotification } from "@/lib/notifications/history";

// Server component: read-only history of the caller's OWN notifications
// (RLS-scoped upstream). No delivery internals — just what was communicated.

const EVENT_LABELS: Record<string, string> = {
  "booking.requested":   "Booking request",
  "booking.confirmed":   "Booking confirmed",
  "booking.rejected":    "Booking declined",
  "booking.cancelled":   "Booking cancelled",
  "payment.success":     "Payment received",
  "payment.failed":      "Payment failed",
  "refund.initiated":    "Refund update",
  "hall.approved":       "Hall approved",
  "hall.rejected":       "Hall needs changes",
  "hall.suspended":      "Hall suspended",
  "hall.unsuspended":    "Hall restored",
  "premium.activated":   "Premium activated",
  "premium.deactivated": "Premium deactivated",
  "commission.overdue":  "Commission overdue",
  "commission.payment.verified": "Commission verified",
  "commission.payment.rejected": "Commission payment issue",
};

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

export function NotificationHistoryList({
  notifications,
  emptyHint,
}: {
  notifications: MyNotification[];
  emptyHint: string;
}) {
  if (notifications.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-10 text-center shadow-card">
        <BellOff className="mx-auto h-8 w-8 text-charcoal-300" />
        <p className="mt-2 text-sm font-semibold text-charcoal-900">No notifications yet</p>
        <p className="mt-1 text-xs text-charcoal-500">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {notifications.map((n) => (
        <div key={n.id} className="rounded-xl bg-white p-3 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-charcoal-900">
              {EVENT_LABELS[n.event_type] ?? n.event_type}
            </p>
            <span className="shrink-0 text-[10px] text-charcoal-400">{fmtWhen(n.created_at)}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-charcoal-600">{n.message}</p>
        </div>
      ))}
    </div>
  );
}
