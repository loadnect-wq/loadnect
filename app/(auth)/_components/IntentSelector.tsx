"use client";

import { useRef } from "react";
import { CalendarHeart, Check, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Intent selector — "how do you want to use Hallnect?"
//
// ⚠️  SECURITY: this value is UX ONLY. It is never sent to the auth callback's
// owner-upgrade path (/auth/set-owner-role, which only /owner/register may
// trigger) and nothing server-side reads it for authorization. Post-login
// routing is decided exclusively by the role stored in the database, via
// /auth/redirect. Selecting "List your hall" cannot make anyone an owner.
//
// A11y: a real radiogroup — arrow keys move between options, Space/Enter picks,
// aria-checked reflects state, and each card is a <button> (not a clickable div).
// ─────────────────────────────────────────────────────────────────────────────

export type AuthIntent = "book" | "list";

const OPTIONS: {
  id: AuthIntent;
  title: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: "book",
    title: "Book a hall",
    description: "Discover and book verified wedding halls and event venues.",
    Icon: CalendarHeart,
  },
  {
    id: "list",
    title: "List your hall",
    description: "Showcase your venue and manage bookings with Hallnect.",
    Icon: Building2,
  },
];

interface Props {
  value: AuthIntent;
  onChange: (next: AuthIntent) => void;
  /** Heading rendered above the group; also labels the radiogroup. */
  label?: string;
}

export function IntentSelector({ value, onChange, label = "How would you like to use Hallnect?" }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = OPTIONS.length - 1;
    let target: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") target = index === last ? 0 : index + 1;
    if (e.key === "ArrowLeft"  || e.key === "ArrowUp")   target = index === 0 ? last : index - 1;
    if (target === null) return;
    e.preventDefault();
    onChange(OPTIONS[target].id);
    refs.current[target]?.focus();
  }

  return (
    <div>
      <p id="intent-label" className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
        {label}
      </p>

      <div role="radiogroup" aria-labelledby="intent-label" className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
        {OPTIONS.map((opt, i) => {
          const selected = value === opt.id;
          return (
            <button
              key={opt.id}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={selected}
              // Roving tabindex: the group is one tab stop, arrows move within it.
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(opt.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "group relative flex min-h-[44px] w-full items-start gap-3 rounded-2xl border p-3.5 text-left",
                "transition-all duration-150 active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-500 focus-visible:ring-offset-2",
                selected
                  ? "border-maroon-600 bg-maroon-50/70 shadow-sm"
                  : "border-border bg-white hover:border-maroon-300 hover:bg-ivory-50",
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                  selected ? "bg-maroon-600 text-ivory-100" : "bg-ivory-200 text-charcoal-500 group-hover:text-maroon-600",
                )}
              >
                <opt.Icon className="h-4.5 w-4.5" aria-hidden />
              </span>

              <span className="min-w-0 flex-1">
                <span className={cn("block font-serif text-sm font-bold", selected ? "text-maroon-800" : "text-charcoal-900")}>
                  {opt.title}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-charcoal-500">
                  {opt.description}
                </span>
              </span>

              {/* Selected tick — gold, matching the brand accent */}
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all duration-150",
                  "motion-reduce:transition-none",
                  selected
                    ? "scale-100 border-gold-400 bg-gold-gradient text-charcoal-950"
                    : "scale-90 border-border bg-white text-transparent",
                )}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
