// ─────────────────────────────────────────────────────────────────────────────
// lib/standee.server.ts — the standee's server half. SERVER-ONLY.
//
//   qrSvg              the code itself, drawn on the server so the qrcode
//                      library never ships to a browser
//   findStandeeHall    which hall a /q/<slug> scan belongs to — approved only
//   recordStandeeScan  +1 for today, through the service-role-only RPC (0107)
//   fetchStandeeStats  the owner's own counts, through RLS
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import QRCode from "qrcode";
import { getSupabasePublicClient } from "@/lib/supabase/public";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { addDaysToIsoDate, todayInBusinessTz } from "@/lib/dates";
import { STANDEE_SLUG } from "@/lib/standee";

/**
 * The QR code as an SVG string. Error correction "M" survives a scuffed or
 * glare-lit laminate at a reception desk; "H" would add modules and make the
 * code denser for no gain at this size. Pure black on white: low-contrast
 * "brand" codes are the most common reason a printed code will not scan.
 */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 0,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/**
 * The approved hall a scan belongs to, or null. Read through the cookie-free
 * anon client: RLS shows anonymous visitors approved halls only, which is
 * exactly the set a scan may land on — a suspended hall's standee leads to the
 * catalogue instead of a 404.
 */
export async function findStandeeHall(slug: string): Promise<{ id: string; slug: string } | null> {
  if (!STANDEE_SLUG.test(slug) || slug.length > 160) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabasePublicClient() as any;
  const { data, error } = await db.from("halls").select("id, slug").eq("slug", slug).eq("status", "approved").maybeSingle();
  if (error) {
    console.error("[standee] hall lookup failed:", error.code, error.message);
    return null;
  }
  return data ? { id: data.id as string, slug: data.slug as string } : null;
}

/** One more scan today. Never throws: a counting failure must not stop the redirect. */
export async function recordStandeeScan(hallId: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;
    const { error } = await db.rpc("record_hall_qr_scan", { _hall_id: hallId });
    if (error) console.error("[standee] scan not recorded:", error.code, error.message);
  } catch (e) {
    console.error("[standee] scan not recorded:", e instanceof Error ? e.message : e);
  }
}

export type StandeeStats = {
  /** Scans in the last 30 days, today included. */
  last30: number;
  total: number;
  /** Scans today (India time). */
  today: number;
};

/**
 * The owner's counts. Session client, so RLS (owns_hall) decides — another
 * venue's id simply returns nothing. Null when the read FAILED, so the page can
 * say "couldn't load" instead of a false "0 scans".
 */
export async function fetchStandeeStats(hallId: string): Promise<StandeeStats | null> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db.from("hall_qr_scans").select("scan_date, scans").eq("hall_id", hallId);
  if (error) {
    console.error("[standee] stats read failed:", error.code, error.message);
    return null;
  }
  const today = todayInBusinessTz();
  const since = addDaysToIsoDate(today, -29);
  let last30 = 0;
  let total = 0;
  let todayCount = 0;
  for (const r of (data ?? []) as { scan_date: string; scans: number }[]) {
    total += r.scans;
    if (r.scan_date >= since) last30 += r.scans;
    if (r.scan_date === today) todayCount += r.scans;
  }
  return { last30, total, today: todayCount };
}
