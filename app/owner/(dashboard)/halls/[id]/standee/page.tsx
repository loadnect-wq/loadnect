// ─────────────────────────────────────────────────────────────────────────────
// /owner/halls/[id]/standee — print a QR standee for the reception desk.
//
// The card is drawn at A5 (148 × 210 mm) for print and scaled to the phone for
// the preview: every size inside it is in container-query units (cqw), so the
// same markup is the preview and the print. Printing hides everything else on
// the page (see PRINT_CSS) and keeps the maroon band in colour.
//
// Shown only for an APPROVED hall. /q/<slug> sends a scan for any other hall to
// the catalogue, so a standee printed for a hall still in review would greet
// families with somebody else's venues.
//
// The scan count comes from hall_qr_scans (0107) through RLS. A failed read
// says so; it is never shown as "0 scans", which would read as "the standee
// does not work".
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { notoSansTamil } from "@/app/fonts/noto-sans-tamil/font";
import { ArrowLeft, ScanLine } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerHall } from "@/lib/owner";
import { absoluteUrl } from "@/lib/seo/config";
import { standeeCopy, standeePath } from "@/lib/standee";
import { isLeadGeneration } from "@/lib/booking-mode";
import { fetchStandeeStats, qrSvg } from "@/lib/standee.server";
import { AppHeader } from "@/components/app/AppHeader";
import { PrintButton } from "./_components/PrintButton";
import { STANDEE_PRINT_CSS, StandeeCard } from "./_components/StandeeCard";

export const metadata: Metadata = { title: "QR standee" };

// Self-hosted — see app/fonts/noto-sans-tamil/font.ts for why never next/font/google.
const tamilFont = notoSansTamil;


type Props = { params: Promise<{ id: string }> };

export default async function StandeePage({ params }: Props) {
  await requireRole(["owner_approved"]);
  const { id } = await params;
  const hall = await fetchOwnerHall(id);
  if (!hall) notFound();

  const approved = hall.status === "approved";
  const url = absoluteUrl(standeePath(hall.slug));
  const [svg, stats] = approved ? await Promise.all([qrSvg(url), fetchStandeeStats(hall.id)]) : [null, null];
  const copy = standeeCopy(hall.booking_mode);
  const shortUrl = url.replace(/^https?:\/\/(www\.)?/, "");

  return (
    <div className={`${tamilFont.variable} min-h-screen bg-ivory-100`}>
      <style>{STANDEE_PRINT_CSS}</style>
      <AppHeader title="QR standee" notificationsHref="/owner/notifications" />

      <div className="mx-auto max-w-md space-y-4 px-4 pb-24 pt-4">
        <div className="print:hidden">
          <h1 className="text-xl font-bold text-charcoal-900">QR standee for {hall.name}</h1>
          <p className="mt-1 text-sm text-charcoal-600">
            Put it on your reception desk. Families scan it, see your prices and photos on their own
            phone, and {isLeadGeneration(hall.booking_mode) ? "can send you an enquiry" : "can pay the advance"} after
            they leave, when the decision is made at home.
          </p>
        </div>

        {!approved ? (
          <p className="rounded-2xl bg-white p-4 text-sm text-charcoal-700 shadow-card">
            Your standee will be ready once Hallnect approves this hall. Until then the code would lead
            families to other venues, so it is not shown.
          </p>
        ) : (
          <>
            {/* ── Scans ──────────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-card print:hidden">
              <ScanLine className="h-5 w-5 shrink-0 text-maroon-600" aria-hidden />
              <p className="text-sm text-charcoal-800">
                {stats == null
                  ? "Couldn't load the scan count just now. Refresh to try again."
                  : stats.total === 0
                    ? "No scans yet. The count starts the first time a family scans your standee."
                    : `Scanned ${stats.last30} ${stats.last30 === 1 ? "time" : "times"} in the last 30 days (${stats.today} today), ${stats.total} in total.`}
              </p>
            </div>

            {/* ── The card ───────────────────────────────────────────────── */}
            <StandeeCard hallName={hall.name} copy={copy} svg={svg ?? ""} shortUrl={shortUrl} />

            <PrintButton />

            <ul className="space-y-2 rounded-2xl bg-white p-4 text-sm text-charcoal-700 shadow-card print:hidden">
              <li>Print it on A5 (half an A4 sheet). On A4, choose “Fit to page”.</li>
              <li>Laminate it, or slide it into a table stand, so it survives the desk.</li>
              <li>Put it where families ask about dates: the reception desk or the manager&apos;s table.</li>
              <li>Test it once with your own phone camera before you print a stack.</li>
            </ul>
          </>
        )}

        <Link
          href="/owner/halls"
          className="flex items-center gap-1 text-sm text-charcoal-600 hover:text-charcoal-900 print:hidden"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to my halls
        </Link>
      </div>
    </div>
  );
}
