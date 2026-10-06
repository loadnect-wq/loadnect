// ─────────────────────────────────────────────────────────────────────────────
// /owner/diary — the hall manager's booking diary, built for a phone.
//
// It replaces the paper notebook: every function at the hall, who booked it,
// what was agreed and what is still due — plus a WhatsApp receipt or reminder
// in two taps. It is useful on the first day even if Hallnect sends the venue
// no customers, and every date entered here becomes live availability on the
// public site, which is what makes date search truthful.
//
// DATA. Writes go through create/update/cancel_offline_booking (0058, 0063,
// 0106) — never a direct table write; those RPCs hold the inventory lock and
// the ownership check. Reads go through the session client, so RLS decides
// what an owner can see, and they are STRICT: a failed read throws to the
// error boundary rather than rendering an empty diary that reads as "nothing
// booked, nothing to collect".
//
// INSTALLABLE. This route alone links /diary.webmanifest, whose start_url is
// this page and whose scope is /owner/, so "Add to home screen" from here
// opens straight into the diary. The rest of the site keeps no manifest.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Building2 } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerHalls, fetchOwnerRow } from "@/lib/owner";
import { fetchOwnerCalendar } from "@/lib/owner-calendar";
import { fetchOfflineBookings } from "@/lib/offline-bookings";
import { fetchDiaryOnlineBookings } from "@/lib/owner-diary";
import { todayInBusinessTz } from "@/lib/dates";
import {
  DIARY_LANG_COOKIE,
  MONTH_KEY,
  addMonthsToKey,
  dt,
  monthEndIso,
  parseDiaryLang,
  type DiaryBooking,
  type DiaryOnline,
} from "@/lib/diary";
import { AppHeader } from "@/components/app/AppHeader";
import { Diary } from "./_components/Diary";

export const metadata: Metadata = {
  title: "Booking diary",
  manifest: "/diary.webmanifest",
  appleWebApp: { capable: true, title: "Hallnect Diary", statusBarStyle: "default" },
  // Full-bleed: iOS rounds the corners itself and paints transparency black.
  icons: { apple: "/diary-apple-icon.png" },
};

export const viewport: Viewport = { themeColor: "#9B2038" };

// One month back so last month's money can still be reconciled, eleven forward
// because that is how far ahead weddings are booked. Same window as the
// availability screen.
const MONTHS_BACK = 1;
const MONTHS_FORWARD = 11;

type Props = { searchParams: Promise<{ hall?: string; m?: string }> };

export default async function DiaryPage({ searchParams }: Props) {
  await requireRole(["owner_approved"]);
  const sp = await searchParams;
  const lang = parseDiaryLang((await cookies()).get(DIARY_LANG_COOKIE)?.value);

  const ownerRow = await fetchOwnerRow();
  const halls = ownerRow ? await fetchOwnerHalls(ownerRow.id) : [];

  if (halls.length === 0) {
    return (
      <div className="min-h-screen bg-ivory-100" lang={lang === "ta" ? "ta" : undefined}>
        <AppHeader title={dt(lang, "title")} notificationsHref="/owner/notifications" heading />
        <div className="mx-auto max-w-md px-4 py-12 text-center">
          <Building2 className="mx-auto h-10 w-10 text-charcoal-300" aria-hidden />
          <p className="mt-3 text-sm text-charcoal-700">{dt(lang, "noHall")}</p>
          <Link
            href="/owner/halls/new"
            className="mt-4 inline-flex min-h-[44px] items-center rounded-xl bg-maroon-600 px-5 text-sm font-semibold text-white hover:bg-maroon-700"
          >
            {dt(lang, "addHall")}
          </Link>
        </div>
      </div>
    );
  }

  // A hall id from the URL is honoured only if it is one of THIS owner's
  // halls; anything else falls back to the first. RLS would hide another
  // venue's rows anyway — this just keeps the page from rendering an empty
  // diary for a hall the owner does not have.
  const hall = halls.find((h) => h.id === sp.hall) ?? halls[0];

  const today = todayInBusinessTz();
  const thisMonth = today.slice(0, 7);
  const earliest = addMonthsToKey(thisMonth, -MONTHS_BACK);
  const latest = addMonthsToKey(thisMonth, MONTHS_FORWARD);
  let month = sp.m && MONTH_KEY.test(sp.m) ? sp.m : thisMonth;
  if (month < earliest) month = earliest;
  if (month > latest) month = latest;

  const [days, offline, online] = await Promise.all([
    fetchOwnerCalendar(hall.id, `${month}-01`, monthEndIso(month)),
    fetchOfflineBookings(hall.id, { strict: true }),
    fetchDiaryOnlineBookings(hall.id, today),
  ]);

  const bookings: DiaryBooking[] = offline.map((o) => ({
    id: o.id,
    eventDate: o.event_date,
    endDate: o.end_date,
    slot: o.slot,
    customerName: o.customer_name,
    customerPhone: o.customer_phone,
    notes: o.notes,
    totalAmount: o.total_amount,
    amountReceived: o.amount_received,
  }));
  const onlineBookings: DiaryOnline[] = online.map((b) => ({
    id: b.id,
    eventDate: b.event_date,
    endDate: b.end_date,
    slot: b.slot,
  }));

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title={dt(lang, "title")} notificationsHref="/owner/notifications" />
      <Diary
        lang={lang}
        hall={{ id: hall.id, name: hall.name }}
        halls={halls.map((h) => ({ id: h.id, name: h.name }))}
        today={today}
        month={month}
        prevMonth={month > earliest ? addMonthsToKey(month, -1) : null}
        nextMonth={month < latest ? addMonthsToKey(month, 1) : null}
        days={days}
        bookings={bookings}
        online={onlineBookings}
      />
    </div>
  );
}
