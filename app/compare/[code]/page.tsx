// ─────────────────────────────────────────────────────────────────────────────
// /compare/<code> — two or three halls side by side, from what each lists on
// Hallnect. Reached from the saved list or a shared shortlist, and shared back
// into the family group. The code holds the hall ids (lib/compare.ts); nothing
// is stored.
//
// HONEST BY CONSTRUCTION. A dash is "the hall has not listed this", and the
// page says so. Highlights come only from published values and only when the
// halls differ. Dining-hall size, rooms and parking spaces are not fields on
// Hallnect yet, so the page names them as questions to ask rather than leaving
// the family to assume the halls were compared on them.
//
// NOINDEX, NOT robots-BLOCKED — the same reasoning as /shortlist: every pair is
// a URL, and WhatsApp's preview fetcher must still read the og: tags.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Columns3 } from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";
import { ShareButtons } from "@/components/share/ShareButtons";
import { buildMetadata, noindexMetadata } from "@/lib/seo/metadata";
import { absoluteUrl } from "@/lib/seo/config";
import { fetchVenueCategories } from "@/lib/venue-categories.server";
import { categoryLabelMap } from "@/lib/venue-categories";
import {
  amenityRows,
  comparePath,
  compareRows,
  compareShareText,
  compareTitle,
  versusLine,
} from "@/lib/compare";
import { CompareTable } from "@/components/compare/CompareTable";
import { CompareBudget } from "@/components/compare/CompareBudget";
import { loadCompare } from "./load";

export const revalidate = 300;

type Props = { params: Promise<{ code: string }> };

function previewImage(code: string) {
  return [{ url: absoluteUrl(`${comparePath(code)}/opengraph-image`), width: 1200, height: 630, alt: "Halls compared on Hallnect" }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const loaded = await loadCompare(code);
  if (!loaded) return noindexMetadata("Comparison not found");
  const { halls } = loaded;
  return buildMetadata({
    title: halls.length >= 2 ? compareTitle(halls.length) : "Hall comparison",
    description: halls.length >= 2
      ? `${versusLine(halls)}: price, guests and amenities side by side on Hallnect.`
      : "Wedding and event halls compared side by side on Hallnect.",
    path: comparePath(code),
    images: previewImage(code),
    indexable: false,
  });
}

export default async function ComparePage({ params }: Props) {
  const { code } = await params;
  const loaded = await loadCompare(code);
  if (!loaded) notFound();
  const { halls, missing, failed } = loaded;

  const catalogue = halls.length >= 2 ? await fetchVenueCategories() : [];
  const rows = compareRows(halls, categoryLabelMap(catalogue));
  const amenities = amenityRows(halls);

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Compare" />
      <section className="container-app py-5 lg:max-w-5xl">
        {failed ? (
          <EmptyState
            icon={<Columns3 className="h-8 w-8" />}
            title="We couldn't load this comparison"
            description="Something went wrong on our side. Please open the link again in a minute."
          />
        ) : halls.length < 2 ? (
          <EmptyState
            icon={<Columns3 className="h-8 w-8" />}
            title="Not enough of these halls are still on Hallnect"
            description="At least one hall in this comparison has been taken off the site since it was shared."
            action={
              <Link href="/halls" className={buttonVariants({ variant: "gold", size: "sm" })}>
                Browse halls
              </Link>
            }
          />
        ) : (
          <>
            <h1 className="font-serif text-2xl font-bold text-charcoal-900">{compareTitle(halls.length)}</h1>
            <p className="mt-1 text-sm text-charcoal-700">
              From what each hall lists on Hallnect. A dash means the hall hasn&apos;t listed it, so ask the hall.
            </p>
            {missing > 0 && (
              <p className="mt-2 text-xs text-charcoal-600">
                {missing === 1 ? "1 hall" : `${missing} halls`} in this comparison {missing === 1 ? "is" : "are"} no longer on Hallnect.
              </p>
            )}

            <CompareTable halls={halls} rows={rows} amenities={amenities} />
            <CompareBudget halls={halls.map((h) => ({ id: h.id, name: h.name, pricePerDay: h.pricePerDay }))} />

            <p className="mt-4 text-xs leading-relaxed text-charcoal-600">
              Not compared here: dining hall size, rooms and parking space. Halls don&apos;t list these on Hallnect yet, so ask each one when you call.
            </p>

            <div className="mt-6 rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
              <h2 className="text-base font-bold text-charcoal-900">Deciding with family?</h2>
              <p className="mt-1 text-sm text-charcoal-700">Send this comparison to the family group. It opens on any phone.</p>
              <div className="mt-3">
                <ShareButtons path={comparePath(code)} text={compareShareText(halls.length)} />
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
