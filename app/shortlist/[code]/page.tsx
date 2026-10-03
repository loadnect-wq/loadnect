// ─────────────────────────────────────────────────────────────────────────────
// /shortlist/<code> — a family's hall shortlist, opened from a WhatsApp link.
// The code IS the list (lib/shortlist.ts); nothing is stored. The sender made
// it on /saved; whoever opens it can save the halls to their own phone and
// forward it again.
//
// NOINDEX, BUT NOT BLOCKED IN robots.txt. Every combination of halls is a URL,
// so none of them belongs in Google. They must still be fetchable, because
// WhatsApp's link preview reads this page's og: tags — a robots.txt Disallow
// would leave the family group with a bare link instead of the hall names.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Heart } from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";
import { HallCard } from "@/app/halls/_components/HallCard";
import { buildMetadata, noindexMetadata } from "@/lib/seo/metadata";
import { absoluteUrl } from "@/lib/seo/config";
import { getAdvancePercent } from "@/lib/platform-settings";
import { fetchVenueCategories } from "@/lib/venue-categories.server";
import { categoryLabelMap } from "@/lib/venue-categories";
import { citiesSummary, hallNamesSummary, shortlistPath, shortlistTitle } from "@/lib/shortlist";
import { loadShortlist } from "./load";
import { ShortlistActions } from "./_components/ShortlistActions";

// The halls' prices and listings can change; five minutes is fresh enough for
// a family comparing options, and spares the database a read per relative.
export const revalidate = 300;

type Props = { params: Promise<{ code: string }> };

/**
 * This segment's generated preview (opengraph-image.tsx), named explicitly:
 * buildMetadata always sets openGraph.images, and without this the site's
 * default picture is what WhatsApp shows instead of the hall names.
 */
function previewImage(code: string) {
  return [{ url: absoluteUrl(`${shortlistPath(code)}/opengraph-image`), width: 1200, height: 630, alt: "A hall shortlist on Hallnect" }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const list = await loadShortlist(code);
  if (!list) return noindexMetadata("Shortlist not found");
  const { halls } = list;
  if (halls.length === 0) {
    return buildMetadata({
      title: "A hall shortlist",
      description: "A hall shortlist shared on Hallnect. Photos, prices and dates for wedding and event halls.",
      path: shortlistPath(code),
      images: previewImage(code),
      indexable: false,
    });
  }
  const where = citiesSummary(halls);
  return buildMetadata({
    title: shortlistTitle(halls.length),
    description: `${hallNamesSummary(halls)}${where ? ` in ${where}` : ""}. Photos, prices and dates on Hallnect.`,
    path: shortlistPath(code),
    images: previewImage(code),
    indexable: false,
  });
}

export default async function ShortlistPage({ params }: Props) {
  const { code } = await params;
  const list = await loadShortlist(code);
  if (!list) notFound();

  const [advancePercent, catalogue] = list.halls.length > 0
    ? await Promise.all([getAdvancePercent(), fetchVenueCategories()])
    : [undefined, []];
  const categoryLabels = categoryLabelMap(catalogue);
  const { halls, missing, failed } = list;

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Shortlist" />
      <section className="container-app py-5 lg:max-w-7xl">
        {failed ? (
          // A failed read is not "these halls are gone". Say what happened.
          <EmptyState
            icon={<Heart className="h-8 w-8" />}
            title="We couldn't load this shortlist"
            description="Something went wrong on our side. Please open the link again in a minute."
          />
        ) : halls.length === 0 ? (
          <EmptyState
            icon={<Heart className="h-8 w-8" />}
            title="These halls are no longer on Hallnect"
            description="The halls in this shortlist have been taken off the site since it was shared."
            action={
              <Link href="/halls" className={buttonVariants({ variant: "gold", size: "sm" })}>
                Browse halls
              </Link>
            }
          />
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">Shared from Hallnect</p>
            <h1 className="mt-1 font-serif text-2xl font-bold text-charcoal-900">{shortlistTitle(halls.length)}</h1>
            <p className="mt-1 text-sm text-charcoal-700">
              Tap a hall for photos, prices and how to book or enquire.
            </p>
            {missing > 0 && (
              <p className="mt-2 text-xs text-charcoal-600">
                {missing === 1
                  ? "1 hall in this shortlist is no longer on Hallnect."
                  : `${missing} halls in this shortlist are no longer on Hallnect.`}
              </p>
            )}

            <ShortlistActions code={code} hallIds={halls.map((h) => h.id)} />

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {halls.map((h, i) => (
                <HallCard
                  key={h.id}
                  hall={h}
                  advancePercent={advancePercent}
                  categoryLabels={categoryLabels}
                  revealIndex={i}
                  revealNow={i < 3}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
