"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays, Heart, LayoutDashboard, Star, User,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Dashboard",   href: "/customer",              icon: LayoutDashboard, exact: true },
  { label: "My Bookings", href: "/customer/bookings",     icon: CalendarDays },
  { label: "Saved Halls", href: "/customer/saved-halls",  icon: Heart },
  { label: "My Reviews",  href: "/customer/reviews",      icon: Star },
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
                active ? "text-maroon-600" : "text-charcoal-400",
              )}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
