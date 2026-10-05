// ─────────────────────────────────────────────────────────────────────────────
// /tools — "Plan your function": every free planning tool for families, as
// the four steps a family goes through. Linked from the desktop header, the
// homepage, the footer and the Profile tab. The list is lib/family-tools.ts.
//
// CACHED like the muhurtham page: the only thing that changes is which
// muhurtham day is next, and ten minutes of lag on that is harmless.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { Languages } from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { FamilyToolSteps } from "@/components/tools/FamilyTools";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildMetadata } from "@/lib/seo/metadata";
import { breadcrumbJsonLd, jsonLdGraph } from "@/lib/seo/jsonld";
import { TOOLS_PATH } from "@/lib/family-tools";
import { todayInBusinessTz } from "@/lib/dates";
import { nextMuhurthamDates } from "@/lib/muhurtham";

export const revalidate = 600;

export const metadata: Metadata = buildMetadata({
  title: "Free Wedding & Function Planning Tools",
  description:
    "Plan your function step by step: Tamil muhurtham dates, a budget calculator, a shortlist to compare halls " +
    "with the family, and a planner for the rest.",
  path: TOOLS_PATH,
});

export default function ToolsPage() {
  const today = todayInBusinessTz();
  const [next] = nextMuhurthamDates(today, 1);

  return (
    <div className="min-h-screen bg-ivory-100">
      <JsonLd
        data={jsonLdGraph(
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Plan your function", path: TOOLS_PATH },
          ]),
        )}
      />
      <AppHeader title="Plan your function" />
      <div className="container-app pb-16 pt-3 lg:max-w-5xl lg:pt-8">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-charcoal-600">
            <li><Link href="/" className="hover:text-maroon-700">Home</Link></li>
            <li aria-hidden="true">/</li>
            <li className="font-medium text-charcoal-800" aria-current="page">Plan your function</li>
          </ol>
        </nav>

        <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-gold-700">Free for families</p>
        <h1 className="mt-1 font-serif text-3xl font-bold leading-tight text-charcoal-900 lg:text-4xl">
          Plan your function, step by step
        </h1>
        <p className="mt-2 max-w-2xl text-base leading-relaxed text-charcoal-700">
          From fixing the muhurtham to the last payment. The first three need no account; the planner asks you to
          sign in so only your family can see it.
        </p>

        <div className="mt-6">
          <FamilyToolSteps next={next ? { date: next, today } : null} />
        </div>

        <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-charcoal-700">
          <Languages className="h-4 w-4 text-maroon-700" aria-hidden />
          Muhurtham dates in Tamil:
          <Link href="/ta/muhurtham-dates" lang="ta" hrefLang="ta-IN" className="font-semibold text-maroon-700 hover:underline">
            முகூர்த்த நாட்கள்
          </Link>
        </p>
      </div>
    </div>
  );
}
