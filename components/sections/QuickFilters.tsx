// ─────────────────────────────────────────────────────────────────────────────
// components/sections/QuickFilters.tsx — Budget · Premium · Available today.
//
// These used to be their own section, "Browse halls by type", sitting directly
// under "What are you planning?". Two "browse by" rows back to back was the
// most confusing thing on the home page: a visitor had no way to tell which one
// to use, because they looked like the same kind of control. And they are not
// the same kind of thing — an OCCASION is what the hall is for, whereas a price
// band, a paid tier and a date are FILTERS on whatever you already chose.
//
// So they are drawn as what they are: a slim row of filter pills under the
// occasions, with no heading of their own. One discovery section, not two.
//
// "Available today" used to appear TWICE — once as a tile here and once as a
// gold "Need a hall today?" banner directly beneath, both linking to the same
// URL. It appears once now.
//
// PREMIUM IS GATED, and that gate is correct (unlike the occasion gate that was
// removed): /halls?category=premium returns nothing while no hall holds a paid
// tier, so the pill would advertise a shelf that does not exist. It comes back
// on its own the moment an owner buys a plan.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { Crown, Wallet, Zap, type LucideIcon } from "lucide-react";

type Filter = { key: string; label: string; href: string; Icon: LucideIcon };

const FILTERS: Filter[] = [
  { key: "today",   label: "Available today", href: "/halls?available=today",  Icon: Zap },
  { key: "budget",  label: "Budget-friendly", href: "/halls?category=budget",  Icon: Wallet },
  { key: "premium", label: "Premium",         href: "/halls?category=premium", Icon: Crown },
];

export function QuickFilters({
  premiumCount,
  className = "",
}: {
  /** Approved halls holding a paid tier. Zero hides the Premium pill. */
  premiumCount: number;
  className?: string;
}) {
  const filters = FILTERS.filter((f) => f.key !== "premium" || premiumCount > 0);

  return (
    // ONE LINE, NEVER WRAPPED. With all three pills a 375px phone has 343px of
    // room for ~375px of pill, so flex-wrap dropped "Premium" onto a line of
    // its own — a single widowed pill, which read as a layout accident. It
    // scrolls sideways instead, matching the occasion ticker and the venue and
    // city strips around it; on a desktop all three fit and nothing moves.
    <ul
      className={`no-scrollbar flex gap-2 overflow-x-auto whitespace-nowrap ${className}`}
      aria-label="Quick filters"
    >
      {filters.map(({ key, label, href, Icon }) => (
        <li key={key} className="shrink-0">
          <Link
            href={href}
            className={[
              "inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold",
              "transition-all duration-200 ease-out active:scale-95 motion-reduce:active:scale-100",
              // Available today is the one time-sensitive shortcut, so it gets
              // the gold treatment the old banner had — now at pill size.
              key === "today"
                ? "border-gold-300/70 bg-gold-50 text-gold-800 hover:border-gold-400 hover:bg-gold-100"
                : "border-border bg-white text-charcoal-700 hover:border-maroon-300 hover:text-maroon-700",
            ].join(" ")}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
