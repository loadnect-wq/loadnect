"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, BadgeCheck, Building2, ClipboardCheck,
  CalendarDays, CreditCard, Wallet, Star, Sparkles, Megaphone,
  MessageSquare, Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Mobile admin navigation.
//
// The desktop sidebar is `hidden lg:flex`, and the customer BottomNav opts /admin
// out — so below lg the admin area previously had NO navigation at all: once you
// opened a section you could not reach any other one without editing the URL.
//
// A 5-tab bottom bar can't represent 13 admin sections, so this is a sticky,
// horizontally scrollable chip rail directly under the page header. It mirrors
// the sidebar's items and badge counts, and is `lg:hidden` so the desktop
// sidebar layout is completely untouched.
// ─────────────────────────────────────────────────────────────────────────────

type Counts = {
  pendingHalls?:  number;
  pendingOwners?: number;
  openTickets?:   number;
  pendingAds?:    number;
};

const ITEMS: {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  badgeKey?: keyof Counts;
}[] = [
  { label: "Dashboard",  href: "/admin/dashboard",       icon: LayoutDashboard, exact: true },
  { label: "Approvals",  href: "/admin/hall-approvals",  icon: ClipboardCheck, badgeKey: "pendingHalls" },
  { label: "Halls",      href: "/admin/halls",           icon: Building2 },
  { label: "Bookings",   href: "/admin/bookings",        icon: CalendarDays },
  { label: "Payments",   href: "/admin/payments",        icon: CreditCard },
  { label: "Commissions",href: "/admin/commissions",     icon: Wallet },
  { label: "Owners",     href: "/admin/owners",          icon: BadgeCheck, badgeKey: "pendingOwners" },
  { label: "Users",      href: "/admin/users",           icon: Users },
  { label: "Reviews",    href: "/admin/reviews",         icon: Star },
  { label: "Premium",    href: "/admin/premium-listings",icon: Sparkles },
  { label: "Ads",        href: "/admin/advertisements",  icon: Megaphone, badgeKey: "pendingAds" },
  { label: "Support",    href: "/admin/support-tickets", icon: MessageSquare, badgeKey: "openTickets" },
  { label: "Settings",   href: "/admin/settings",        icon: Settings },
];

export function AdminMobileNav({ counts }: { counts?: Counts }) {
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label="Admin sections"
      className="sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur-md lg:hidden"
    >
      <ul className="no-scrollbar flex items-stretch gap-1.5 overflow-x-auto px-3 py-2">
        {ITEMS.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          const badge = item.badgeKey ? counts?.[item.badgeKey] ?? 0 : 0;

          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-xs font-semibold",
                  "transition-colors active:scale-[0.97] motion-reduce:active:scale-100",
                  active
                    ? "bg-maroon-700 text-white"
                    : "bg-ivory-100 text-charcoal-700 hover:bg-ivory-200",
                )}
              >
                <item.icon className={cn("h-4 w-4 shrink-0", active ? "text-white" : "text-charcoal-500")} />
                <span className="whitespace-nowrap">{item.label}</span>
                {badge > 0 && (
                  <span
                    className={cn(
                      "ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold",
                      active ? "bg-white text-maroon-700" : "bg-amber-500 text-white",
                    )}
                  >
                    {badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
