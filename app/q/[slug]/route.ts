// ─────────────────────────────────────────────────────────────────────────────
// /q/<slug> — where every printed QR standee points.
//
// Counts the scan and sends the phone to the venue page. The count is written
// AFTER the redirect has gone out (next/server `after`), so a family standing
// at the desk never waits on the database — and a counting failure can never
// stop the redirect.
//
// A slug that is not an approved hall (suspended, renamed, mistyped) still
// lands somewhere useful: the catalogue, rather than a 404 on a code that is
// laminated to a desk and cannot be changed.
//
// `src=qr` rides along so analytics can tell a standee visit from the rest.
// The venue page's canonical drops the query, so it cannot split indexing.
// ─────────────────────────────────────────────────────────────────────────────

import { after, NextResponse, type NextRequest } from "next/server";
import { findStandeeHall, recordStandeeScan } from "@/lib/standee.server";
import { isLikelyBot } from "@/lib/standee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const hall = await findStandeeHall(slug.toLowerCase());

  const target = new URL(hall ? `/halls/${hall.slug}` : "/halls", request.nextUrl.origin);
  target.searchParams.set("src", "qr");

  if (hall && !isLikelyBot(request.headers.get("user-agent"))) {
    after(() => recordStandeeScan(hall.id));
  }

  const res = NextResponse.redirect(target, 302);
  // Never cached: a cached redirect is a scan nobody counts.
  res.headers.set("Cache-Control", "no-store");
  return res;
}
