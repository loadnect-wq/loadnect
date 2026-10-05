// ─────────────────────────────────────────────────────────────────────────────
// The family planning tools as cards: on the homepage (phone and desktop), on
// /tools, and as "More free tools" at the foot of each tool. A server
// component — no client JavaScript. The list itself is lib/family-tools.ts.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FAMILY_TOOLS, daysAway, type FamilyTool, type FamilyToolKey } from "@/lib/family-tools";
import { TOOL_ICONS } from "./tool-icons";
import { formatDiaryDay } from "@/lib/diary";
import { revealDelay } from "@/lib/motion";

/** The next muhurtham day, worked out on the server from India's today. */
export type NextMuhurtham = { date: string; today: string } | null;

/** A short live line under each tool's name. The muhurtham one names the actual next date. */
function detail(tool: FamilyTool, next: NextMuhurtham): string {
  switch (tool.key) {
    case "muhurtham":
      return next ? `Next: ${formatDiaryDay("en", next.date)}, ${daysAway(next.today, next.date)}` : "Wedding dates, month by month";
    case "budget":
      return "Hall, food and decoration";
    case "shortlist":
      return "No sign-in needed";
    case "planner":
      return "Free, with sign-in";
  }
}

function ToolIcon({ tool, size = "md" }: { tool: FamilyTool; size?: "md" | "lg" }) {
  const Icon = TOOL_ICONS[tool.key];
  return (
    <span
      className={
        size === "lg"
          ? "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-maroon-50 text-maroon-700"
          : "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-maroon-50 text-maroon-700"
      }
    >
      <Icon className={size === "lg" ? "h-6 w-6" : "h-5 w-5"} aria-hidden />
    </span>
  );
}

/** Phone homepage: four tiles, two by two, each one tap from its tool. */
export function FamilyToolTiles({ next }: { next: NextMuhurtham }) {
  return (
    <ul className="container-app grid grid-cols-2 gap-3">
      {FAMILY_TOOLS.map((t, i) => (
        <li key={t.key} data-reveal="up" style={revealDelay(i, 70)}>
          <Link
            href={t.href}
            className="flex h-full min-h-[132px] flex-col rounded-2xl bg-white p-3.5 shadow-card ring-1 ring-border transition active:scale-[0.98] motion-reduce:active:scale-100"
          >
            <ToolIcon tool={t} />
            <span className="mt-2.5 text-sm font-semibold leading-snug text-charcoal-900">{t.title}</span>
            <span className="mt-0.5 text-xs leading-snug text-charcoal-600">{detail(t, next)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Desktop homepage: four cards in a row, each with what it does and its button. */
export function FamilyToolCards({ next }: { next: NextMuhurtham }) {
  return (
    <ul className="grid grid-cols-4 gap-5">
      {FAMILY_TOOLS.map((t, i) => (
        <li key={t.key} data-reveal="up" style={revealDelay(i, 90)}>
          <Link
            href={t.href}
            className="group flex h-full flex-col rounded-2xl border border-border bg-white p-6 transition-all hover:-translate-y-1 hover:shadow-card-hover motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <ToolIcon tool={t} size="lg" />
            <span className="mt-4 text-[11px] font-semibold uppercase tracking-widest text-gold-700">
              {i + 1}. {t.step}
            </span>
            <span className="mt-1 font-serif text-xl font-semibold text-charcoal-900">{t.title}</span>
            <span className="mt-2 flex-1 text-sm leading-relaxed text-charcoal-600">{t.blurb}</span>
            {t.key === "muhurtham" && next && (
              <span className="mt-3 text-xs font-semibold text-maroon-700">{detail(t, next)}</span>
            )}
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-maroon-700 group-hover:text-maroon-900">
              {t.cta} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0" aria-hidden />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** /tools: the four tools as numbered steps, each with its button. */
export function FamilyToolSteps({ next }: { next: NextMuhurtham }) {
  return (
    <ol className="space-y-4 lg:grid lg:grid-cols-2 lg:gap-5 lg:space-y-0">
      {FAMILY_TOOLS.map((t, i) => (
        <li key={t.key} className="flex flex-col rounded-3xl bg-white p-5 shadow-card ring-1 ring-border lg:p-6">
          <div className="flex items-start gap-4">
            <ToolIcon tool={t} size="lg" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-gold-700">
                Step {i + 1} · {t.step}
              </p>
              <h2 className="mt-0.5 font-serif text-xl font-bold text-charcoal-900">{t.title}</h2>
            </div>
          </div>
          <p className="mt-3 flex-1 text-sm leading-relaxed text-charcoal-700">{t.blurb}</p>
          <p className="mt-2 text-xs font-semibold text-maroon-700">
            {t.key === "muhurtham" ? detail(t, next) : t.noSignIn ? "Free, no sign-in needed" : "Free. Sign in so the plan is saved and only your family sees it."}
          </p>
          <Link
            href={t.href}
            className="mt-4 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-maroon-700 px-5 text-sm font-semibold text-white hover:bg-maroon-800"
          >
            {t.cta} <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </li>
      ))}
    </ol>
  );
}

/** "More free tools" at the foot of a tool's own page: the others, one tap each. */
export function MoreFamilyTools({ current }: { current: FamilyToolKey }) {
  return (
    <section aria-labelledby="more-tools" className="mt-10">
      <h2 id="more-tools" className="text-base font-bold text-charcoal-900">More free tools for your function</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-3">
        {FAMILY_TOOLS.filter((t) => t.key !== current).map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              className="flex h-full items-center gap-3 rounded-2xl bg-white p-3.5 shadow-card ring-1 ring-border hover:ring-maroon-200"
            >
              <ToolIcon tool={t} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-charcoal-900">{t.title}</span>
                <span className="block text-xs text-charcoal-600">{t.step}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
