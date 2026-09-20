"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The customer's enquiry wizard: details → verify → sent.
//
// THREE THINGS THIS COMPONENT DELIBERATELY DOES NOT DO.
//
//   1. It never decides that the phone is verified. There is no "verified"
//      boolean it can set — the only thing that advances it to the sent screen
//      is a server action returning success, and that action asks MSG91.
//   2. It never tells the customer the venue has been notified until the
//      server says the enquiry was actually FORWARDED. `forwarded: false` (a
//      repeat verify, a second tab) still lands on the success screen, because
//      from the customer's point of view their enquiry is in — but the copy
//      does not claim a fresh notification went out.
//   3. It never sends the hall's owner id, the commission rate, or any amount.
//      The server resolves all three from the slug.
//
// Every button that costs money or an SMS is disabled while its transition is
// pending, which is the §28 double-click requirement — and the server is
// idempotent underneath regardless (uq_lead_active, the resend cooldown).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft, CalendarDays, CheckCircle2, Loader2, MessageSquare,
  Phone, PhoneCall, ShieldCheck, Users,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

import { formatHallPrice, hasPrice } from "@/lib/booking-mode";
import { startLeadEnquiry, resendLeadOtp, verifyLeadOtp } from "../actions";

const OTP_LENGTH = 6;

// The four hard-coded labels that used to live here came from a CHECK
// constraint. The options now arrive as a prop from public.venue_categories
// (0102), led by the ones this venue itself declared — see the page.
export type EnquiryEventOption = { slug: string; name: string };

type Props = {
  hall: {
    id: string;
    slug: string;
    name: string;
    city: string;
    capacity_max: number;
    price_per_day: number | null;
  };
  /** Today in the business timezone (IST) — the earliest selectable date. */
  minDate: string;
  initialName: string;
  initialPhone: string;
  /** False when MSG91's auth key or OTP template id is missing. */
  otpConfigured: boolean;
  /** Occasions offered, this venue's own first. Empty hides the question. */
  eventOptions?: EnquiryEventOption[];
};

export function EnquiryFlow({ hall, minDate, initialName, initialPhone, otpConfigured, eventOptions = [] }: Props) {
  const [step, setStep] = useState<"details" | "code" | "sent">("details");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [eventDate, setEventDate] = useState("");
  const [eventType, setEventType] = useState<string>("");
  const [guestCount, setGuestCount] = useState("");
  const [requirements, setRequirements] = useState("");

  const [leadId, setLeadId] = useState<string | null>(null);
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [cooldown, setCooldown] = useState(0);
  const [freshlyForwarded, setFreshlyForwarded] = useState(true);
  // The venue's own number, returned by the server only once the enquiry has
  // actually reached them. Never present before verification.
  const [venue, setVenue] = useState<{ businessName: string; phone: string | null } | null>(null);
  const boxRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await startLeadEnquiry({
        hallId: hall.id,
        contactName: name,
        contactPhone: phone,
        eventDate,
        eventType,
        guestCount,
        requirements,
      });
      if ("error" in r) { setError(r.error); return; }
      setLeadId(r.leadId);

      // Already verified on an earlier visit — no second code was sent, and
      // pretending one was would leave the customer waiting for an SMS that is
      // never coming.
      if (r.alreadySent) { setFreshlyForwarded(false); setStep("sent"); return; }

      setCooldown(r.cooldownSeconds ?? 60);
      setDigits(Array(OTP_LENGTH).fill(""));
      setStep("code");
      setTimeout(() => boxRefs.current[0]?.focus(), 50);
    });
  }

  function submitCode(code: string) {
    if (!leadId) return;
    setError(null);
    startTransition(async () => {
      const r = await verifyLeadOtp(leadId, code);
      if ("error" in r) { setError(r.error); setDigits(Array(OTP_LENGTH).fill("")); return; }
      setFreshlyForwarded(r.forwarded);
      setVenue(r.venue ?? null);
      setStep("sent");
    });
  }

  function resend() {
    if (!leadId) return;
    setError(null);
    startTransition(async () => {
      const r = await resendLeadOtp(leadId);
      if ("error" in r) { setError(r.error); return; }
      setCooldown(r.cooldownSeconds);
    });
  }

  // Paste-aware OTP boxes, matching /verify-phone so the two feel like one
  // product. Auto-submits on the last digit.
  function handleDigit(i: number, value: string) {
    const pasted = value.replace(/\D/g, "");
    if (pasted.length > 1) {
      const next = Array(OTP_LENGTH).fill("");
      for (let k = 0; k < Math.min(OTP_LENGTH, pasted.length); k++) next[k] = pasted[k];
      setDigits(next);
      const last = Math.min(OTP_LENGTH, pasted.length) - 1;
      boxRefs.current[last]?.focus();
      if (pasted.length >= OTP_LENGTH) submitCode(pasted.slice(0, OTP_LENGTH));
      return;
    }
    const d = pasted.slice(0, 1);
    const next = [...digits];
    next[i] = d;
    setDigits(next);
    if (d && i < OTP_LENGTH - 1) boxRefs.current[i + 1]?.focus();
    const code = next.join("");
    if (code.length === OTP_LENGTH && !next.includes("")) submitCode(code);
  }

  function handleKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      boxRefs.current[i - 1]?.focus();
      const next = [...digits];
      next[i - 1] = "";
      setDigits(next);
    }
  }

  // ── Not configured ─────────────────────────────────────────────────────────
  // Said up front rather than after the customer fills in the form: MSG91 is
  // the only way an enquiry can be verified, so without it there is nothing
  // this page can complete.
  if (!otpConfigured) {
    return (
      <Shell hall={hall}>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="font-semibold">Enquiries are paused right now</p>
          <p className="mt-1 text-xs leading-relaxed">
            We verify every enquiry by SMS before passing it to the venue, and the
            verification service is unavailable at the moment. Please try again shortly.
          </p>
        </div>
      </Shell>
    );
  }

  // ── Sent ───────────────────────────────────────────────────────────────────
  if (step === "sent") {
    return (
      <Shell hall={hall}>
        <div className="rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" aria-hidden />
          <p className="mt-3 font-serif text-lg font-bold text-charcoal-900">
            Your enquiry has been sent to the Mahal owner
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-charcoal-600">
            {freshlyForwarded
              ? `${hall.name} has been notified and will contact you on the number you verified.`
              : `${hall.name} already has this enquiry and will contact you on the number you verified.`}
          </p>
          {/* SAYS WHAT HAS *NOT* HAPPENED. A customer who has just completed a
              form with a date on it can reasonably think the date is now
              theirs. It is not — no calendar is blocked and no money changed
              hands — and finding that out later, from the venue, is the worst
              possible moment. */}
          <p className="mt-3 rounded-xl bg-white/70 p-3 text-[11px] leading-relaxed text-charcoal-600">
            This is an enquiry, not a booking. Your date is not held and Hallnect has not
            taken any payment. The venue will agree the price and confirm the date with
            you directly.
          </p>
          {/* CALL THE VENUE, right here. This is the peak of intent — they
              have just spent a minute on a form and a verification code, and
              the next thing they want is to talk to the venue. Making them
              navigate to another page to find the number wastes that. */}
          {venue?.phone && (
            <a
              href={`tel:${venue.phone}`}
              className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-maroon-300 bg-white px-4 py-3 font-semibold text-maroon-800 active:bg-maroon-50"
            >
              <PhoneCall className="h-4 w-4" aria-hidden />
              Call {venue.businessName} — {venue.phone}
            </a>
          )}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link href="/customer/enquiries">
              <Button variant="gold" size="lg" className="w-full sm:w-auto">
                View my enquiries
              </Button>
            </Link>
            <Link href={`/halls/${hall.slug}`}>
              <Button variant="outline" size="lg" className="w-full sm:w-auto">
                Back to venue
              </Button>
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  // ── Verify ─────────────────────────────────────────────────────────────────
  if (step === "code") {
    return (
      <Shell hall={hall}>
        <div className="rounded-2xl bg-white p-5 shadow-card">
          <p className="flex items-center gap-2 font-serif text-base font-semibold text-charcoal-900">
            <ShieldCheck className="h-4 w-4 text-maroon-600" aria-hidden />
            Verify your number
          </p>
          <p className="mt-1 text-xs leading-relaxed text-charcoal-600">
            We sent a {OTP_LENGTH}-digit code to <strong>{phone}</strong>. Your enquiry
            reaches the venue only once this is verified.
          </p>

          <div className="mt-4 flex justify-between gap-1.5">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { boxRefs.current[i] = el; }}
                value={d}
                onChange={(e) => handleDigit(i, e.target.value)}
                onKeyDown={(e) => handleKey(i, e)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={OTP_LENGTH}
                aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
                disabled={pending}
                className="h-12 w-full rounded-xl border border-border text-center text-lg font-bold text-charcoal-900 focus:border-maroon-500 focus:outline-none focus:ring-2 focus:ring-maroon-200 disabled:opacity-60"
              />
            ))}
          </div>

          {error && (
            <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </p>
          )}

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={resend}
              disabled={pending || cooldown > 0}
              className="text-xs font-semibold text-maroon-700 disabled:text-charcoal-400"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
            <button
              type="button"
              onClick={() => { setStep("details"); setError(null); }}
              disabled={pending}
              className="text-xs font-semibold text-charcoal-500 disabled:opacity-60"
            >
              Change details
            </button>
          </div>

          {pending && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-charcoal-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Checking…
            </p>
          )}
        </div>
      </Shell>
    );
  }

  // ── Details ────────────────────────────────────────────────────────────────
  return (
    <Shell hall={hall}>
      <form onSubmit={submitDetails} className="rounded-2xl bg-white p-5 shadow-card">
        <p className="font-serif text-base font-semibold text-charcoal-900">Your enquiry</p>
        <p className="mt-1 text-xs text-charcoal-600">
          The venue contacts you directly. Hallnect does not take any payment for this
          listing.
        </p>

        <div className="mt-4 space-y-3.5">
          <Field label="Your name" htmlFor="enq-name">
            <input
              id="enq-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              className={INPUT}
            />
          </Field>

          <Field label="Mobile number" htmlFor="enq-phone" hint="We send a code here to verify it.">
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal-400" aria-hidden />
              <input
                id="enq-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoComplete="tel"
                placeholder="+91 98765 43210"
                className={`${INPUT} pl-9`}
              />
            </div>
          </Field>

          <Field label="Event date" htmlFor="enq-date">
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal-400" aria-hidden />
              <input
                id="enq-date"
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                required
                min={minDate}
                className={`${INPUT} pl-9`}
              />
            </div>
          </Field>

          {/* Already optional, so an unreadable catalogue simply removes the
              question rather than blocking a free enquiry. */}
          <fieldset className={eventOptions.length === 0 ? "hidden" : undefined}>
            <legend className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
              Event type (optional)
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {eventOptions.map((t) => {
                const on = eventType === t.slug;
                return (
                  <button
                    key={t.slug}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setEventType(on ? "" : t.slug)}
                    className={`min-h-[44px] rounded-xl border px-3 text-sm font-medium transition-colors ${
                      on
                        ? "border-maroon-500 bg-maroon-50 text-maroon-800"
                        : "border-border bg-white text-charcoal-700 hover:border-maroon-300"
                    }`}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <Field
            label="Number of guests (optional)"
            htmlFor="enq-guests"
            hint={`This venue seats up to ${hall.capacity_max.toLocaleString("en-IN")}.`}
          >
            <div className="relative">
              <Users className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal-400" aria-hidden />
              <input
                id="enq-guests"
                type="number"
                min={1}
                step={1}
                value={guestCount}
                onChange={(e) => setGuestCount(e.target.value)}
                placeholder="e.g. 400"
                className={`${INPUT} pl-9`}
              />
            </div>
          </Field>

          <Field label="Anything else? (optional)" htmlFor="enq-req">
            <div className="relative">
              <MessageSquare className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-charcoal-400" aria-hidden />
              <textarea
                id="enq-req"
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Catering, decoration, timings…"
                className={`${INPUT} resize-y pl-9 pt-2.5`}
              />
            </div>
          </Field>
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            {error}
          </p>
        )}

        <Button type="submit" variant="gold" size="lg" className="mt-4 w-full" disabled={pending}>
          {pending ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Sending…
            </span>
          ) : (
            "Send Enquiry"
          )}
        </Button>
        <p className="mt-2 text-center text-[11px] text-charcoal-500">
          We will text you a code to verify your number first.
        </p>
      </form>
    </Shell>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────────

const INPUT =
  "min-h-[44px] w-full rounded-xl border border-border px-3 text-sm text-charcoal-900 " +
  "focus:border-maroon-500 focus:outline-none focus:ring-2 focus:ring-maroon-200 disabled:opacity-60";

function Shell({ hall, children }: { hall: Props["hall"]; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ivory-100 pb-16">
      <div className="mx-auto max-w-2xl px-4 py-5 sm:px-6">
        <Link
          href={`/halls/${hall.slug}`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-charcoal-600 hover:text-maroon-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to {hall.name}
        </Link>

        <header className="mt-3 rounded-2xl bg-white p-4 shadow-card">
          <span className="inline-flex items-center rounded-full bg-maroon-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-maroon-700">
            Lead Generation
          </span>
          <h1 className="mt-1.5 font-serif text-xl font-bold text-charcoal-900">{hall.name}</h1>
          <p className="text-xs text-charcoal-500">{hall.city}</p>
          <p className="mt-2 text-sm font-semibold text-maroon-700">
            {formatHallPrice(hall.price_per_day)}
            {hasPrice(hall.price_per_day) && (
              <span className="text-xs font-normal text-charcoal-500"> /day</span>
            )}
          </p>
        </header>

        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label, htmlFor, hint, children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-charcoal-500">{hint}</p>}
    </div>
  );
}
