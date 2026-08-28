import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchMyNotifications } from "@/lib/notifications/history";
import { NotificationHistoryList } from "@/components/notifications/NotificationHistoryList";
import { AppHeader } from "@/components/app/AppHeader";

export const metadata: Metadata = { title: "Notifications" };

export default async function OwnerNotificationsPage() {
  await requireRole(["owner_approved"]);
  const notifications = await fetchMyNotifications();

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Notifications" notificationsHref="/owner/notifications" />
      <div className="px-4 py-4 sm:px-6 lg:px-8">
        <div className="mb-4 hidden items-center gap-2 lg:flex">
          <Bell className="h-5 w-5 text-maroon-600" />
          <h1 className="font-serif text-xl font-bold text-charcoal-900">Notifications</h1>
        </div>
        <NotificationHistoryList
          notifications={notifications}
          emptyHint="Booking alerts, payment updates, hall approvals and commission reminders will appear here."
        />
      </div>
    </div>
  );
}
