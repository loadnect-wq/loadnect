// ─────────────────────────────────────────────────────────────────────────────
// POST /api/halls/view  { slug }
//
// Counts one view of a live venue page for the owner's Insights (0117,
// lib/page-views.server.ts). The venue page calls it at most once per browser
// per hall per day. Always answers 204: the page does nothing with the result,
// and a uniform answer tells a script nothing about which slugs are live.
//
// The venue page itself stays cached and cookie-free; this separate request is
// the only part that looks at the viewer, and only to leave the hall's own
// owner (and admins) out of the count. Nothing about the viewer is stored.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordHallPageView } from "@/lib/page-views.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const done = () => new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  let slug: unknown;
  try {
    const text = await request.text();
    if (text.length > 400) return done();
    slug = (JSON.parse(text) as { slug?: unknown }).slug;
  } catch {
    return done();
  }
  if (typeof slug !== "string") return done();

  const user = await getSession().catch(() => null);
  await recordHallPageView({
    slug,
    userAgent: request.headers.get("user-agent"),
    viewerId: user?.id ?? null,
  });
  return done();
}
