// ─────────────────────────────────────────────────────────────────────────────
// /budget — the function budget calculator, on its own. Until 2026-10-05 the
// only way to use it was to open a hall's page first, so a family still
// deciding on a hall could not work out what the function would cost.
//
// STATIC AND INDEXABLE. Nothing here is per visitor on the server: the numbers
// live in the visitor's browser (useBudgetInputs), and the page is the same
// for everyone. The calculator is BudgetCalculator; the maths is lib/budget.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/app/AppHeader";
import { BudgetCalculator } from "@/components/budget/BudgetCalculator";
import { MoreFamilyTools } from "@/components/tools/FamilyTools";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildMetadata } from "@/lib/seo/metadata";
import { breadcrumbJsonLd, jsonLdGraph } from "@/lib/seo/jsonld";
import { BUDGET_PATH, TOOLS_PATH } from "@/lib/family-tools";
import { HALL_GST_PERCENT } from "@/lib/budget";

export const metadata: Metadata = buildMetadata({
  title: "Wedding & Function Budget Calculator",
  description:
    "Work out what your function will cost: hall rent, food per plate for your guests, decoration and GST, " +
    "with a total and a cost per guest. Free, no sign-up.",
  path: BUDGET_PATH,
});

export default function BudgetPage() {
  return (
    <div className="min-h-screen bg-ivory-100">
      <JsonLd
        data={jsonLdGraph(
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Plan your function", path: TOOLS_PATH },
            { name: "Budget calculator", path: BUDGET_PATH },
          ]),
        )}
      />
      <AppHeader title="Budget calculator" />
      <div className="container-app pb-16 pt-3 lg:max-w-5xl lg:pt-8">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-charcoal-600">
            <li><Link href="/" className="hover:text-maroon-700">Home</Link></li>
            <li aria-hidden="true">/</li>
            <li><Link href={TOOLS_PATH} className="hover:text-maroon-700">Plan your function</Link></li>
            <li aria-hidden="true">/</li>
            <li className="font-medium text-charcoal-800" aria-current="page">Budget calculator</li>
          </ol>
        </nav>

        <h1 className="mt-1 font-serif text-2xl font-bold leading-snug text-charcoal-900 lg:text-3xl">
          What will the whole function cost?
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-charcoal-700">
          The hall is only part of it. Food for every guest usually decides the budget, so add your guest count
          and a per-plate rate along with the hall&apos;s price, and see the total and the cost per guest.
        </p>

        <div className="mt-5">
          <BudgetCalculator />
        </div>

        <section className="mt-10 max-w-2xl">
          <h2 className="text-lg font-bold text-charcoal-900">Getting the numbers right</h2>
          <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-charcoal-700">
            <li>
              <span className="font-semibold text-charcoal-900">Food per plate.</span> Ask the hall (some have
              in-house catering) or your caterer for a per-plate rate, and say how many meals each guest will have.
            </li>
            <li>
              <span className="font-semibold text-charcoal-900">GST on the hall.</span> Ask whether the hall&apos;s
              price includes GST. If it is quoted before GST, tick the box to add {HALL_GST_PERCENT}%.
            </li>
            <li>
              <span className="font-semibold text-charcoal-900">The hall&apos;s real price.</span> Ask a hall for a
              quote from its page on Hallnect. It replies with its price for your date, and only gets your phone
              number if you accept the quote.
            </li>
          </ul>
        </section>

        <MoreFamilyTools current="budget" />
      </div>
    </div>
  );
}
