// One category as a viewer sees it: where it stands, who is chosen and the
// money, without the form. People who can edit get ItemForm instead.

import { formatDiaryDay } from "@/lib/diary";
import { formatPrice } from "@/lib/mock-data";
import { STATUS_LABEL } from "@/lib/plan";
import type { PlanItem } from "@/lib/plan.server";

export function ItemSummary({ item, chosenName }: { item: PlanItem; chosenName: string | null }) {
  const rows: [string, string][] = [];
  rows.push(["Where it stands", STATUS_LABEL[item.status]]);
  if (chosenName) rows.push([item.category === "hall" ? "Hall" : "Who", chosenName]);
  if (item.vendorPhone) rows.push(["Phone", item.vendorPhone]);
  if (item.plannedAmount != null) rows.push(["Planned", formatPrice(item.plannedAmount)]);
  if (item.quotedAmount != null) rows.push([item.status === "booked" ? "Agreed" : "Quoted", formatPrice(item.quotedAmount)]);
  if (item.paidAmount != null) rows.push(["Paid", formatPrice(item.paidAmount)]);
  if (item.nextDueDate) {
    rows.push([
      "Next payment",
      `${item.nextDueAmount != null ? `${formatPrice(item.nextDueAmount)} on ` : ""}${formatDiaryDay("en", item.nextDueDate, { year: true })}`,
    ]);
  }

  return (
    <section aria-labelledby="item-summary-heading" className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
      <h2 id="item-summary-heading" className="text-base font-bold text-charcoal-900">Details</h2>
      <dl className="mt-2 divide-y divide-border">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2 text-sm">
            <dt className="text-charcoal-600">{k}</dt>
            <dd className="text-right font-semibold text-charcoal-900">{v}</dd>
          </div>
        ))}
      </dl>
      {item.notes && <p className="mt-2 whitespace-pre-line text-sm text-charcoal-700">{item.notes}</p>}
      <p className="mt-3 text-xs text-charcoal-600">You can view this plan. The person who started it can let you edit.</p>
    </section>
  );
}
