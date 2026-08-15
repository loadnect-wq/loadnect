"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, CalendarCheck, Heart, User } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/",         label: "Home",     Icon: Home,          match: (p: string) => p === "/" },
  { href: "/halls",    label: "Search",   Icon: Search,        match: (p: string) => p.startsWith("/halls") },
  { href: "/bookings", label: "Bookings", Icon: CalendarCheck, match: (p: string) => p.startsWith("/bookings") },
  { href: "/saved",    label: "Saved",    Icon: Heart,         match: (p: string) => p.startsWith("/saved") },
  { href: "/profile",  label: "Profile",  Icon: User,          match: (p: string) => p.startsWith("/profile") },
] as const;

const HIDDEN_PREFIXES = ["/login", "/signup", "/owner/register", "/auth/", "/approval-pending", "/admin", "/book/"];

export function BottomNav() {
  const pathname = usePathname() ?? "/";
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  // Hide on hall detail pages (e.g. /halls/some-slug) — those use a sticky Book Now bar
  if (/^\/halls\/[^/]+/.test(pathname)) return null;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-2 pt-1.5">
        {TABS.map(({ href, label, Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 transition",
                  "active:scale-95 motion-reduce:active:scale-100",
                  active ? "text-maroon-700" : "text-charcoal-500 hover:text-maroon-700",
                )}
              >
                <Icon
                  className={cn("h-5 w-5", active && "fill-maroon-100")}
                  strokeWidth={active ? 2.2 : 1.8}
                  aria-hidden
                />
                <span className={cn("text-[10px] font-semibold tracking-wide", active && "text-maroon-700")}>
                  {label}
                </span>
                {active && <span className="mt-0.5 h-0.5 w-5 rounded-full bg-maroon-600" aria-hidden />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
