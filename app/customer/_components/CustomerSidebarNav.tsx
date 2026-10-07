"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays, Heart, Inbox, LayoutDashboard, Star, User,
  Bell, CalendarCheck, ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DIRECT_BOOKING_ENABLED } from "@/lib/booking-switch";

const NAV = [
  { label: "Dashboard",   href: "/customer",              icon: LayoutDashboard, exact: true },
  { label: "My Plans",    href: "/plan",                  icon: ClipboardList },
  // Online booking is switched off (lib/booking-switch.ts): nothing to list.
  ...(DIRECT_BOOKING_ENABLED ? [{ label: "My Bookings", href: "/customer/bookings", icon: CalendarDays }] : []),
  { label: "My Enquiries", href: "/customer/enquiries",  icon: Inbox },
  { label: "My Visits",   href: "/customer/visits",       icon: CalendarCheck },
  // The heart saves to this browser's list (/saved); the account table it
  // used to point at was never written to, so it always read "none saved".
  { label: "Saved Halls", href: "/saved",                 icon: Heart },
  // A review attaches to an online booking OR to an enquiry the hall marked
  // booked (0113), so there is always something a family can review.
  { label: "My Reviews",  href: "/customer/reviews",      icon: Star },
  { label: "Notifications", href: "/customer/notifications", icon: Bell },
  { label: "Profile",     href: "/customer/profile",      icon: User },
];

export function CustomerSidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="mt-3 px-2 space-y-0.5">
      {NAV.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-maroon-50 text-maroon-700"
                : "text-charcoal-600 hover:bg-ivory-100 hover:text-charcoal-900",
            )}
          >
            <item.icon
              className={cn(
                "h-4 w-4 shrink-0",
                active ? "text-maroon-600" : "text-charcoal-500",
              )}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
