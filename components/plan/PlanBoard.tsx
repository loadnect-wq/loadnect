// The plan's board: one card per category in play, each showing where it
// stands, who is chosen, and the money. Categories marked "not needed" fold
// into a row of chips that switch them back on.

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatDiaryDay } from "@/lib/diary";
import { formatPrice } from "@/lib/mock-data";
import { PLAN_CATEGORIES, STATUS_LABEL, daysUntil, paidInFull, type ItemStatus } from "@/lib/plan";
import type { PlanItem } from "@/lib/plan.server";
import { CategoryToggle } from "./CategoryToggle";

const STATUS_STYLE: Record<ItemStatus, string> = {
  todo: "bg-ivory-200 text-charcoal-700",
  shortlisted: "bg-gold-50 text-gold-800",
  asked: "bg-gold-50 text-gold-800",
  visited: "bg-maroon-50 text-maroon-800",
  booked: "bg-green-50 text-green-800",
  not_needed: "bg-ivory-200 text-charcoal-500",
};

function moneyLine(i: PlanItem): string | null {
  if (i.status === "booked") {
    const agreed = i.quotedAmount ?? i.plannedAmount;
    if (agreed == null) return null;
    return `${formatPrice(agreed)} agreed${i.paidAmount ? ` · ${formatPrice(i.paidAmount)} paid` : ""}`;
  }
  if (i.quotedAmount != null) return `Quoted ${formatPrice(i.quotedAmount)}`;
  if (i.plannedAmount != null) return `Planned ${formatPrice(i.plannedAmount)}`;
  return null;
}

export function PlanBoard({
  planId,
  items,
  hallNames,
  today,
}: {
  planId: string;
  items: PlanItem[];
  /** hall id → name, for the chosen hall. A hall no longer listed is absent. */
  hallNames: Record<string, string>;
  today: string;
}) {
  const active = items.filter((i) => i.status !== "not_needed");
  const off = items.filter((i) => i.status === "not_needed");
  const meta = (key: string) => PLAN_CATEGORIES.find((c) => c.key === key)!;

  return (
    <section aria-labelledby="board-heading">
      <h2 id="board-heading" className="text-base font-bold text-charcoal-900">What to arrange</h2>
      <ul className="mt-2 space-y-2">
        {active.map((i) => {
          const m = meta(i.category);
          const chosen = i.hallId ? (hallNames[i.hallId] ?? "A hall no longer on Hallnect") : i.vendorName;
          const money = moneyLine(i);
          const dueIn = i.nextDueDate ? daysUntil(i.nextDueDate, today) : null;
          return (
            <li key={i.category}>
              <Link
                href={`/plan/${planId}/${i.category}`}
                className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-border hover:ring-maroon-200"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-charcoal-900">{m.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[i.status]}`}>
                      {STATUS_LABEL[i.status]}
                    </span>
                    {paidInFull(i) && (
                      <span className="rounded-full bg-green-700 px-2 py-0.5 text-[11px] font-semibold text-white">Paid in full</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-charcoal-700">{chosen ?? m.hint}</p>
                  {money && <p className="text-xs text-charcoal-600">{money}</p>}
                  {i.nextDueDate && !paidInFull(i) && (
                    <p className={`text-xs ${dueIn != null && dueIn <= 7 ? "font-semibold text-amber-800" : "text-charcoal-600"}`}>
                      {i.nextDueAmount ? `${formatPrice(i.nextDueAmount)} due ` : "Payment due "}
                      {formatDiaryDay("en", i.nextDueDate)}
                      {dueIn != null && dueIn < 0 ? " · overdue" : ""}
                    </p>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-charcoal-400" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>

      {off.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-charcoal-600">Not needed for this function. Tap one to add it back:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {off.map((i) => (
              <CategoryToggle key={i.category} planId={planId} category={i.category} label={meta(i.category).label} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
