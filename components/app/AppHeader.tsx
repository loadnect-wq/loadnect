"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";

const HIDDEN_PREFIXES = ["/login", "/signup", "/owner/register", "/auth/"];

interface AppHeaderProps {
  title?: string;
  showBack?: boolean;
  rightSlot?: React.ReactNode;
  /** Where the bell goes. Owner pages pass their own route. */
  notificationsHref?: string;
  transparent?: boolean;
}

export function AppHeader({
  title, showBack, rightSlot, transparent, notificationsHref,
}: AppHeaderProps) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();

  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <header
      className={cn(
        "sticky top-0 z-30 w-full lg:hidden",
        transparent ? "bg-transparent" : "border-b border-border bg-white/95 backdrop-blur-md",
      )}
    >
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-3">
          {showBack ? (
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Back"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-card"
            >
              <ArrowLeft className="h-4 w-4 text-charcoal-800" />
            </button>
          ) : (
            <Link href="/" className="flex items-center gap-1.5" aria-label={`${APP_NAME} home`}>
              <span className="relative block h-7 w-7 shrink-0">
                <Image src="/logo.png" alt="" fill sizes="28px" className="object-contain" priority />
              </span>
              <span className="font-serif text-base font-bold text-maroon-800">{APP_NAME}</span>
            </Link>
          )}
          {title && (
            <p className="truncate font-serif text-base font-semibold text-charcoal-900">{title}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* A real link, not an ornament. This was a <button> with no handler
              on every mobile page: it looked like the way to reach your
              notifications and did nothing when tapped. */}
          {/* Owners have their own notifications page. This was hardcoded to
              the customer route, which requireRole refuses for an owner — so
              the bell on every owner page bounced them back to their dashboard.
              `notificationsHref` lets an owner surface point at its own. */}
          {rightSlot ?? (
            <Link
              href={notificationsHref ?? "/customer/notifications"}
              aria-label="Notifications"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-ivory-200 text-charcoal-700 transition-colors hover:bg-ivory-300"
            >
              <Bell className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
