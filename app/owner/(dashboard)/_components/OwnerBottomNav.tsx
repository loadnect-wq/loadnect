"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, CalendarDays, LayoutDashboard, IndianRupee, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Owner navigation on a phone.
//
// There was none. OwnerSidebarNav lives inside `hidden lg:flex`, the desktop
// Navbar is `hidden lg:block`, and the customer BottomNav did not exclude
// /owner — so a venue owner on a phone saw the CUSTOMER tabs (Home, Search,
// Bookings, Saved, Profile) sitting on top of their own dashboard, and tapping
// "Bookings" bounced them off /customer/bookings back to the dashboard. From
// any owner page other than the dashboard there was no way to reach My Halls,
// Premium, Support or Profile at all.
//
// This is a mobile-first marketplace in Tamil Nadu and owners are the paying
// side of it, so that was the single worst usability hole in the product.
//
// Four destinations plus More, because five is the most that stays tappable at
// 360px. Everything else lives behind More, which is a real page rather than a
// menu — a sheet would need client state and would be one more thing to get
// wrong on a slow device.
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  { href: "/owner/dashboard", label: "Dashboard", Icon: LayoutDashboard, exact: true },
  { href: "/owner/halls",     label: "My Halls",  Icon: Building2 },
  { href: "/owner/bookings",  label: "Bookings",  Icon: CalendarDays },
  { href: "/owner/revenue",   label: "Revenue",   Icon: IndianRupee },
  { href: "/owner/more",      label: "More",      Icon: Menu },
] as const;

/** Pages that are their own full-screen flow and should not carry tabs. */
const HIDDEN_PREFIXES = ["/owner/register", "/owner/halls/new"];

export function OwnerBottomNav() {
  const pathname = usePathname() ?? "";
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <nav
      aria-label="Owner"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex">
        {TABS.map(({ href, label, Icon, ...rest }) => {
          const exact = "exact" in rest && rest.exact;
          // "More" is active for anything not covered by the other four, so the
          // owner is never looking at a page with no tab lit.
          const active =
            href === "/owner/more"
              ? !TABS.some((t) =>
                  t.href !== "/owner/more" &&
                  ("exact" in t && t.exact ? pathname === t.href : pathname.startsWith(t.href)),
                )
              : exact
                ? pathname === href
                : pathname.startsWith(href);

          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[10px] font-medium",
                  active ? "text-maroon-700" : "text-charcoal-500",
                )}
              >
                <Icon className={cn("h-5 w-5", active ? "text-maroon-600" : "text-charcoal-400")} />
                <span className="leading-none">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
