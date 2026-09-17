"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/chat/ChatParts.tsx — how assistant replies are drawn.
//
// NO HTML FROM THE MODEL, EVER. Text is split into paragraphs/bullets and
// **bold** runs and rendered as React text nodes, so anything the model (or a
// hall description it quoted) contains is displayed, not executed. Links come
// only from tool OUTPUTS, which the server built from validated slugs and the
// fixed CHAT_ACTION_ROUTES table; isSafeInternalHref() re-checks them here.
// ─────────────────────────────────────────────────────────────────────────────

import Image from "next/image";
import Link from "next/link";
import { Fragment } from "react";
import { CalendarCheck, CheckCircle2, MapPin, Star, Users, XCircle } from "lucide-react";
import { formatIsoDateLabel } from "@/lib/dates";
import type { ChatHallCard } from "@/lib/ai/tools.server";
import { trackChatEvent } from "./chat-analytics";

const DAY_LABEL: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" };
const dayLabel = (iso: string) => formatIsoDateLabel(iso, DAY_LABEL);

export function isSafeInternalHref(href: unknown): href is string {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//") && !href.includes("\\")
    && /^[A-Za-z0-9/_\-?=&.]+$/.test(href);
}

// ── Text ─────────────────────────────────────────────────────────────────────

function Inline({ text }: { text: string }) {
  const pieces = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {pieces.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4
          ? <strong key={i} className="font-semibold text-charcoal-900">{p.slice(2, -2)}</strong>
          : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  );
}

export function FormattedText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: { kind: "p" | "ul" | "ol"; items: string[] }[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-•*])\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.kind === "ul") last.items.push(bullet[1]); else blocks.push({ kind: "ul", items: [bullet[1]] });
    } else if (numbered) {
      if (last?.kind === "ol") last.items.push(numbered[1]); else blocks.push({ kind: "ol", items: [numbered[1]] });
    } else if (line.trim() === "") {
      blocks.push({ kind: "p", items: [] });
    } else if (last?.kind === "p" && last.items.length > 0) {
      last.items.push(line.replace(/^#+\s*/, ""));
    } else {
      blocks.push({ kind: "p", items: [line.replace(/^#+\s*/, "")] });
    }
  }

  return (
    <div className="space-y-2 break-words">
      {blocks.filter((b) => b.items.length > 0).map((b, i) => {
        if (b.kind === "ul") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 marker:text-gold-600">
              {b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}
            </ul>
          );
        }
        if (b.kind === "ol") {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5 marker:text-charcoal-500">
              {b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}
            </ol>
          );
        }
        return (
          <p key={i}>
            {b.items.map((it, j) => (
              <Fragment key={j}>{j > 0 && <br />}<Inline text={it} /></Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

export function ActionButtons({
  actions,
  onNavigate,
}: {
  actions: { key: string; label: string; href: string }[];
  onNavigate: () => void;
}) {
  const safe = actions.filter((a) => isSafeInternalHref(a.href));
  if (safe.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {safe.map((a) => (
        <Link
          key={a.key}
          href={a.href}
          onClick={() => {
            if (a.key === "contact_support") trackChatEvent("support_requested", { source: "action" });
            if (a.key === "become_owner" || a.key === "owner_dashboard") trackChatEvent("owner_help_requested", { source: "action" });
            onNavigate();
          }}
          className="inline-flex min-h-[40px] items-center rounded-full border border-gold-400/60 bg-white px-3.5 text-xs font-semibold text-maroon-800 transition hover:border-gold-500 hover:bg-gold-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        >
          {a.label}
        </Link>
      ))}
    </div>
  );
}

// ── Hall cards ───────────────────────────────────────────────────────────────

export function HallCards({ halls, onNavigate }: { halls: ChatHallCard[]; onNavigate: () => void }) {
  if (halls.length === 0) return null;
  return (
    <ul className="space-y-2.5" aria-label="Matching halls">
      {halls.map((h) => {
        const page = `/halls/${h.slug}`;
        if (!isSafeInternalHref(page)) return null;
        return (
          <li key={h.slug} className="overflow-hidden rounded-xl border border-border bg-white shadow-card">
            <div className="relative h-28 w-full bg-gradient-to-br from-maroon-900 to-maroon-700">
              {h.coverUrl ? (
                <Image src={h.coverUrl} alt="" fill sizes="360px" className="object-cover" />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center font-serif text-lg text-gold-300/80" aria-hidden>
                  {h.name.slice(0, 1)}
                </span>
              )}
              <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-charcoal-700">
                {h.bookingMode}
              </span>
            </div>
            <div className="space-y-1.5 p-3">
              <p className="font-serif text-[15px] font-semibold leading-snug text-charcoal-900">{h.name}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-charcoal-600">
                <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-gold-600" aria-hidden />{h.city}</span>
                <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5 text-gold-600" aria-hidden />Up to {h.capacity.toLocaleString("en-IN")} guests</span>
                {h.rating && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-gold-500 text-gold-500" aria-hidden />
                    {h.rating.average.toFixed(1)} ({h.rating.count} review{h.rating.count === 1 ? "" : "s"})
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-maroon-800">{h.price}</p>
              {h.amenities.length > 0 && (
                <p className="line-clamp-1 text-[11px] text-charcoal-500">{h.amenities.join(" · ")}</p>
              )}
              <div className="flex gap-2 pt-1">
                <Link
                  href={page}
                  onClick={() => { trackChatEvent("hall_result_clicked", { action: "view" }); onNavigate(); }}
                  className="inline-flex min-h-[38px] flex-1 items-center justify-center rounded-lg bg-maroon-900 px-3 text-xs font-semibold text-ivory-100 transition hover:bg-maroon-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                >
                  View Hall
                </Link>
                {isSafeInternalHref(h.primaryHref) && (
                  <Link
                    href={h.primaryHref}
                    onClick={() => { trackChatEvent("hall_result_clicked", { action: "primary" }); onNavigate(); }}
                    className="inline-flex min-h-[38px] flex-1 items-center justify-center rounded-lg border border-gold-400/70 px-3 text-xs font-semibold text-maroon-800 transition hover:bg-gold-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                  >
                    {h.primaryLabel === "Book Now" ? "Check Availability" : h.primaryLabel}
                  </Link>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── Availability ─────────────────────────────────────────────────────────────

export function AvailabilityDays({
  name,
  days,
  bookHref,
  onNavigate,
}: {
  name: string;
  days: { date: string; morning: boolean; evening: boolean; fullDay: boolean }[];
  bookHref: string;
  onNavigate: () => void;
}) {
  const Slot = ({ label, open }: { label: string; open: boolean }) => (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${open ? "bg-emerald-50 text-emerald-800" : "bg-charcoal-100 text-charcoal-500"}`}>
      {open ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <XCircle className="h-3 w-3" aria-hidden />}
      {label}<span className="sr-only">{open ? " open" : " not available"}</span>
    </span>
  );
  return (
    <div className="rounded-xl border border-border bg-white p-3 shadow-card">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-charcoal-800">
        <CalendarCheck className="h-4 w-4 text-gold-600" aria-hidden /> {name} — calendar right now
      </p>
      <ul className="mt-2 space-y-1.5">
        {days.map((d) => (
          <li key={d.date} className="flex flex-wrap items-center gap-1.5 text-xs text-charcoal-700">
            <span className="w-full shrink-0 font-medium sm:w-auto">{dayLabel(d.date)}</span>
            <Slot label="Morning" open={d.morning} />
            <Slot label="Evening" open={d.evening} />
            <Slot label="Full day" open={d.fullDay} />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-charcoal-500">Final availability is confirmed when you book.</p>
      {isSafeInternalHref(bookHref) && (
        <Link
          href={bookHref}
          onClick={() => { trackChatEvent("booking_help_requested", { source: "availability" }); onNavigate(); }}
          className="mt-2 inline-flex min-h-[38px] items-center rounded-lg bg-maroon-900 px-3 text-xs font-semibold text-ivory-100 transition hover:bg-maroon-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        >
          Book this hall
        </Link>
      )}
    </div>
  );
}

// ── My bookings ──────────────────────────────────────────────────────────────

export function MyBookingsList({
  bookings,
  onNavigate,
}: {
  bookings: { hall: string; city: string; startDate: string; endDate: string; status: string; detailsHref: string }[];
  onNavigate: () => void;
}) {
  if (bookings.length === 0) return null;
  return (
    <ul className="space-y-2">
      {bookings.map((b) => (
        <li key={b.detailsHref} className="rounded-xl border border-border bg-white p-3 text-xs shadow-card">
          <p className="font-semibold text-charcoal-900">{b.hall} <span className="font-normal text-charcoal-500">· {b.city}</span></p>
          <p className="mt-0.5 text-charcoal-600">
            {dayLabel(b.startDate)}{b.endDate && b.endDate !== b.startDate ? ` – ${dayLabel(b.endDate)}` : ""}
          </p>
          <p className="mt-0.5 text-charcoal-700">{b.status}</p>
          {isSafeInternalHref(b.detailsHref) && (
            <Link href={b.detailsHref} onClick={onNavigate} className="mt-1.5 inline-block font-semibold text-maroon-700 underline-offset-2 hover:underline">
              View booking
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
