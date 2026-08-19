import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchMyNotifications } from "@/lib/notifications/history";
import { NotificationHistoryList } from "@/components/notifications/NotificationHistoryList";

export const metadata: Metadata = { title: "Notifications" };

export default async function CustomerNotificationsPage() {
  await requireRole(["customer"]);
  const notifications = await fetchMyNotifications();

  return (
    <div className="px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center gap-2">
        <Bell className="h-5 w-5 text-maroon-600" />
        <h1 className="font-serif text-xl font-bold text-charcoal-900">Notifications</h1>
      </div>
      <NotificationHistoryList
        notifications={notifications}
        emptyHint="Booking confirmations, payment updates and cancellations will appear here."
      />
    </div>
  );
}
