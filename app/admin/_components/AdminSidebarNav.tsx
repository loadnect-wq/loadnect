"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck, Building2, CalendarDays, ClipboardCheck,
  CreditCard, LayoutDashboard, Megaphone, MessageSquare,
  Receipt, ScrollText, Settings, Sparkles, Star, Users, Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href:  string;
  icon:  React.ComponentType<{ className?: string }>;
  exact?: boolean;
  badgeKey?: keyof BadgeCounts;
};

export type BadgeCounts = {
  pendingHalls:  number;
  pendingOwners: number;
  openTickets:   number;
  pendingAds:    number;
};

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard, exact: true },
    ],
  },
  {
    title: "People",
    items: [
      { label: "Users",   href: "/admin/users",   icon: Users },
      { label: "Owners",  href: "/admin/owners",  icon: BadgeCheck, badgeKey: "pendingOwners" },
    ],
  },
  {
    title: "Listings",
    items: [
      { label: "Halls",          href: "/admin/halls",          icon: Building2 },
      { label: "Hall Approvals", href: "/admin/hall-approvals", icon: ClipboardCheck, badgeKey: "pendingHalls" },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Bookings",    href: "/admin/bookings",    icon: CalendarDays },
      { label: "Payments",    href: "/admin/payments",    icon: CreditCard },
      { label: "Commissions", href: "/admin/commissions", icon: Wallet },
      { label: "Reviews",     href: "/admin/reviews",     icon: Star },
    ],
  },
  {
    title: "Monetization",
    items: [
      { label: "Premium Listings", href: "/admin/premium-listings", icon: Sparkles },
      { label: "Advertisements",   href: "/admin/advertisements",   icon: Megaphone, badgeKey: "pendingAds" },
    ],
  },
  {
    title: "Support",
    items: [
      { label: "Support Tickets", href: "/admin/support-tickets", icon: MessageSquare, badgeKey: "openTickets" },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "Audit Log", href: "/admin/audit-logs", icon: ScrollText },
      { label: "Settings",  href: "/admin/settings",   icon: Settings },
    ],
  },
];

export function AdminSidebarNav({ counts }: { counts: BadgeCounts }) {
  const pathname = usePathname();

  return (
    <nav className="px-2 pb-6 space-y-4">
      {SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-wider text-charcoal-400">
            {section.title}
          </p>
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              const badge = item.badgeKey ? counts[item.badgeKey] : 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
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
                  <span className="flex-1 truncate">{item.label}</span>
                  {badge > 0 && (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-maroon-600 px-1.5 text-[10px] font-bold text-white">
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
