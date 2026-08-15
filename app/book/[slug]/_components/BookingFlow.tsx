"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle, ArrowLeft, CalendarDays, Check, Clock,
  CreditCard, Receipt, Sparkles, Users,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/mock-data";
import type { DaySlotAvailability } from "@/lib/availability";
import { createBookingRequest, createPaymentSession, submitManualBookingRequest, type CreateBookingResult } from "../actions";

const STEPS = ["Date", "Slot", "Details", "Summary", "Pay", "Done"] as const;
type StepIndex = number;

// ── Cashfree v3 web SDK ─────────────────────────────────────────────────────────
// Loaded on demand from Cashfree's CDN. Exposes a global `Cashfree` factory.
type CashfreeCheckoutOptions = { paymentSessionId: string; redirectTarget?: string };
type CashfreeInstance = { checkout: (o: CashfreeCheckoutOptions) => Promise<unknown> | void };
declare global {
  interface Window {
    Cashfree?: (opts: { mode: "sandbox" | "production" }) => CashfreeInstance;
  }
}

const CASHFREE_SDK_SRC = "https://sdk.cashfree.com/js/v3/cashfree.js";

function loadCashfreeSdk(): Promise<NonNullable<Window["Cashfree"]>> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Not in a browser"));
      return;
    }
    if (window.Cashfree) {
      resolve(window.Cashfree);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CASHFREE_SDK_SRC}"]`);
    const onReady = () => {
      if (window.Cashfree) resolve(window.Cashfree);
      else reject(new Error("Cashfree SDK loaded but unavailable"));
    };
    if (existing) {
      existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Cashfree SDK")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = CASHFREE_SDK_SRC;
    script.async = true;
    script.onload = onReady;
    script.onerror = () => reject(new Error("Failed to load Cashfree SDK"));
    document.head.appendChild(script);
  });
}

type SlotId = "morning" | "evening" | "full_day";

type SlotMeta = {
  id:    SlotId;
  label: string;
  time:  string;
};

const SLOTS: SlotMeta[] = [
  { id: "morning",  label: "Morning",  time: "8 AM – 2 PM"  },
  { id: "evening",  label: "Evening",  time: "5 PM – 11 PM" },
  { id: "full_day", label: "Full Day", time: "8 AM – 11 PM" },
];

const EVENT_TYPES = ["Wedding", "Reception", "Engagement", "Birthday", "Corporate", "Other"] as const;

// Display-only rate. The server recomputes the authoritative fee from
// platform_settings in createBookingRequest — this is purely for UI preview.
const ADVANCE_RATE = 0.25;

export type BookingHall = {
  id:            string;
  slug:          string;
  name:          string;
  city:          string;
  capacity_max:  number;
  price_per_day: number;
  price_morning: number | null;
  price_evening: number | null;
};

interface Props {
  hall:                 BookingHall;
  availability:         DaySlotAvailability[];
  windowDays:           number;
  platformFeePercent:   number;
  onlinePaymentEnabled: boolean;
}

export function BookingFlow({ hall, availability, windowDays, platformFeePercent, onlinePaymentEnabled }: Props) {
  // Multiplier form of the platform fee % (e.g. 5 → 0.05).
  const PLATFORM_FEE_RATE = platformFeePercent / 100;
  const router = useRouter();
  const [step, setStep] = useState<StepIndex>(0);

  const [date,      setDate]      = useState<string>("");
  const [slot,      setSlot]      = useState<SlotId | "">("");
  const [eventType, setEventType] = useState<string>("Wedding");
  const [guests,    setGuests]    = useState<string>("");
  const [name,      setName]      = useState<string>("");
  const [phone,     setPhone]     = useState<string>("");
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);

  const [bookingId,     setBookingId]     = useState<string | null>(null);
  const [expiresAt,     setExpiresAt]     = useState<string | null>(null);
  const [serverError,   setServerError]   = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Index availability by date for O(1) lookup
  const availabilityByDate = new Map(availability.map((a) => [a.date, a]));

  // Compute pricing from DB-provided values (still recomputed server-side at insert)
  function slotPrice(s: SlotId): number {
    if (s === "morning" && hall.price_morning != null) return hall.price_morning;
    if (s === "evening" && hall.price_evening != null) return hall.price_evening;
    return hall.price_per_day;
  }

  const baseAmount  = slot ? slotPrice(slot) : 0;
  const platformFee = Math.round(baseAmount * PLATFORM_FEE_RATE);
  const totalAmount = baseAmount + platformFee;
  const advance     = Math.round(totalAmount * ADVANCE_RATE);

  function next() { setStep((s) => Math.min(s + 1, STEPS.length - 1)); }
  function back() { if (step === 0) router.back(); else setStep((s) => Math.max(s - 1, 0)); }

  // Build the days window
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: windowDays }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });

  // For the date step: a day is "selectable" if AT LEAST one slot is available
  function dayHasAnySlot(iso: string): boolean {
    const a = availabilityByDate.get(iso);
    if (!a) return true; // unknown days assumed available
    return a.morning || a.evening || a.full_day;
  }

  function isSlotAvailable(iso: string, s: SlotId): boolean {
    const a = availabilityByDate.get(iso);
    if (!a) return true;
    return a[s];
  }

  const selectedAvail = date ? availabilityByDate.get(date) : undefined;

  const canContinue =
    (step === 0 && !!date && dayHasAnySlot(date)) ||
    (step === 1 && !!slot && isSlotAvailable(date, slot)) ||
    (step === 2 && !!eventType && !!guests && !!name && !!phone &&
      parseInt(guests, 10) > 0 && parseInt(guests, 10) <= hall.capacity_max) ||
    (step === 3 && termsAccepted) ||
    (step === 4) ||
    step === 5;

  // Step 4 (Pay) action — creates the pending booking (if needed), opens the
  // Cashfree checkout, and lets the gateway redirect to the booking status page.
  // The booking is NOT confirmed here — it stays `pending_payment` until the
  // server verifies the payment with Cashfree on the status page / webhook.
  function handlePayNow() {
    if (!slot) return;
    setServerError(null);
    startTransition(async () => {
      // 1. Ensure a pending booking exists (reuse if a prior attempt created one).
      let id = bookingId;
      if (!id) {
        const result: CreateBookingResult = await createBookingRequest({
          hallId:        hall.id,
          eventDate:     date,
          slot,
          guestCount:    parseInt(guests, 10),
          customerNotes: `${eventType} event. Contact: ${name}, ${phone}.`,
          termsAccepted,
        });

        if ("error" in result) {
          // Server-side availability check failed (race lost, or slot grabbed)
          setServerError(result.error);
          if (
            result.error.toLowerCase().includes("booked")  ||
            result.error.toLowerCase().includes("unavail") ||
            result.error.toLowerCase().includes("taken")
          ) {
            setStep(0);
            setDate("");
            setSlot("");
          }
          return;
        }
        id = result.bookingId;
        setBookingId(result.bookingId);
        setExpiresAt(result.expiresAt);
      }

      // 2. Create a Cashfree order on the server and get a payment_session_id.
      const session = await createPaymentSession(id, { name, phone });
      if ("error" in session) {
        setServerError(session.error);
        return;
      }

      // 3. Open Cashfree checkout. On completion the SDK redirects the browser
      //    to our return_url → /booking/{id}/status, where payment is verified.
      try {
        const Cashfree = await loadCashfreeSdk();
        const cashfree = Cashfree({ mode: session.mode });
        await cashfree.checkout({
          paymentSessionId: session.paymentSessionId,
          redirectTarget:   "_self",
        });
      } catch (e) {
        setServerError(
          e instanceof Error
            ? `Could not open the payment window: ${e.message}`
            : "Could not open the payment window. Please try again.",
        );
      }
    });
  }

  // Manual mode (Cashfree not configured): create the booking and submit it as a
  // request — no online payment. Hallnect confirms + collects payment offline.
  function handleSubmitRequest() {
    if (!slot) return;
    setServerError(null);
    startTransition(async () => {
      let id = bookingId;
      if (!id) {
        const result: CreateBookingResult = await createBookingRequest({
          hallId:        hall.id,
          eventDate:     date,
          slot,
          guestCount:    parseInt(guests, 10),
          customerNotes: `${eventType} event. Contact: ${name}, ${phone}.`,
          termsAccepted,
        });
        if ("error" in result) {
          setServerError(result.error);
          if (
            result.error.toLowerCase().includes("booked")  ||
            result.error.toLowerCase().includes("unavail") ||
            result.error.toLowerCase().includes("taken")
          ) {
            setStep(0); setDate(""); setSlot("");
          }
          return;
        }
        id = result.bookingId;
        setBookingId(result.bookingId);
      }

      const res = await submitManualBookingRequest(id);
      if ("error" in res) { setServerError(res.error); return; }
      setStep(5); // Done
    });
  }

  return (
    <div className="min-h-screen bg-ivory-100 pb-32">

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-white">
        <div className="flex h-14 items-center gap-3 px-4">
          <button
            type="button"
            onClick={back}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-ivory-200"
          >
            <ArrowLeft className="h-4 w-4 text-charcoal-800" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-maroon-500">Booking</p>
            <p className="truncate font-serif text-sm font-semibold text-charcoal-900">{hall.name}</p>
          </div>
          <p className="text-xs text-charcoal-500">Step {step + 1}/{STEPS.length}</p>
        </div>

        <div className="h-1 w-full bg-ivory-200">
          <motion.div
            className="h-full bg-gradient-to-r from-maroon-500 to-gold-500"
            initial={false}
            animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </header>

      {/* Content */}
      <main className="container-app pt-5 lg:max-w-2xl">

        {serverError && (
          <div className="mb-4 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Could not complete booking</p>
              <p className="mt-0.5">{serverError}</p>
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.section
            key={step}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2 }}
          >

            {/* STEP 0 — choose date */}
            {step === 0 && (
              <StepWrap title="Choose a date" subtitle={`Bookings open for the next ${windowDays} days.`}>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {days.map((d) => {
                    const iso       = d.toISOString().slice(0, 10);
                    const active    = date === iso;
                    const a         = availabilityByDate.get(iso);
                    const anyOpen   = !a || a.morning || a.evening || a.full_day;
                    const allClosed = !anyOpen;
                    return (
                      <button
                        key={iso}
                        type="button"
                        disabled={allClosed}
                        onClick={() => { setDate(iso); setSlot(""); }}
                        className={cn(
                          "relative flex flex-col items-center rounded-2xl border px-2 py-3 text-center shadow-sm transition",
                          allClosed         && "border-border bg-ivory-200 text-charcoal-400 line-through",
                          !allClosed && active && "border-maroon-600 bg-maroon-600 text-white",
                          !allClosed && !active && "border-border bg-white text-charcoal-800",
                        )}
                      >
                        <span className="text-[10px] font-semibold uppercase">
                          {d.toLocaleDateString("en-IN", { weekday: "short" })}
                        </span>
                        <span className="text-lg font-bold">{d.getDate()}</span>
                        <span className="text-[10px]">
                          {d.toLocaleDateString("en-IN", { month: "short" })}
                        </span>
                        {/* Tiny availability stripes */}
                        {!allClosed && a && (
                          <div className="mt-1 flex gap-0.5">
                            <span title="Morning" className={cn(
                              "h-1 w-2 rounded-full",
                              a.morning ? (active ? "bg-white/80" : "bg-emerald-400") : "bg-charcoal-300",
                            )} />
                            <span title="Evening" className={cn(
                              "h-1 w-2 rounded-full",
                              a.evening ? (active ? "bg-white/80" : "bg-emerald-400") : "bg-charcoal-300",
                            )} />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-charcoal-500">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" /> Slot available
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-charcoal-300" /> Slot taken
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-3 rounded-full bg-ivory-300 border border-border" /> Fully booked
                  </span>
                </div>
              </StepWrap>
            )}

            {/* STEP 1 — choose slot */}
            {step === 1 && (
              <StepWrap
                title="Select a slot"
                subtitle={date ? `For ${new Date(date).toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric" })}` : ""}
              >
                <div className="space-y-2.5">
                  {SLOTS.map((s) => {
                    const active = slot === s.id;
                    const open   = isSlotAvailable(date, s.id);
                    const price  = slotPrice(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={!open}
                        onClick={() => setSlot(s.id)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-2xl border px-4 py-3.5 text-left shadow-sm transition",
                          !open           && "border-border bg-ivory-200 opacity-60 cursor-not-allowed",
                          open && active  && "border-maroon-600 bg-maroon-50",
                          open && !active && "border-border bg-white",
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <span className={cn(
                            "flex h-10 w-10 items-center justify-center rounded-full",
                            !open        ? "bg-charcoal-200 text-charcoal-400" :
                            active       ? "bg-maroon-600 text-white" :
                                           "bg-ivory-200 text-charcoal-700",
                          )}>
                            <Clock className="h-4 w-4" />
                          </span>
                          <div>
                            <p className={cn("text-sm font-bold", open ? "text-charcoal-900" : "text-charcoal-500")}>
                              {s.label}
                            </p>
                            <p className="text-xs text-charcoal-500">
                              {open ? s.time : "Unavailable"}
                            </p>
                          </div>
                        </div>
                        <p className={cn(
                          "font-serif text-base font-bold",
                          open ? "text-maroon-700" : "text-charcoal-400 line-through",
                        )}>
                          {formatPrice(price)}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {selectedAvail && !selectedAvail.morning && !selectedAvail.evening && !selectedAvail.full_day && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    All slots are taken for this date. Pick a different date.
                  </div>
                )}
              </StepWrap>
            )}

            {/* STEP 2 — event details */}
            {step === 2 && (
              <StepWrap title="Event details" subtitle="Tell us a bit about your event.">
                <div className="space-y-4">
                  <div>
                    <Label>Event type</Label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {EVENT_TYPES.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setEventType(t)}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-xs font-semibold",
                            eventType === t
                              ? "border-maroon-600 bg-maroon-600 text-white"
                              : "border-border bg-white text-charcoal-700",
                          )}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="guests">Expected guests (max {hall.capacity_max})</Label>
                    <Input
                      id="guests" type="number" min="1" max={hall.capacity_max}
                      value={guests} onChange={(e) => setGuests(e.target.value)}
                      placeholder={`Up to ${hall.capacity_max}`}
                    />
                  </div>

                  <div>
                    <Label htmlFor="contactName">Your name</Label>
                    <Input id="contactName" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
                  </div>

                  <div>
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 9876543210" />
                  </div>
                </div>
              </StepWrap>
            )}

            {/* STEP 3 — summary */}
            {step === 3 && (
              <StepWrap title="Price summary" subtitle="Review before paying the advance.">
                <div className="rounded-2xl bg-white p-4 shadow-card">
                  <Row icon={<CalendarDays className="h-4 w-4" />} label="Date" value={new Date(date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} />
                  <Row icon={<Clock className="h-4 w-4" />} label="Slot" value={`${SLOTS.find((s) => s.id === slot)?.label} · ${SLOTS.find((s) => s.id === slot)?.time}`} />
                  <Row icon={<Sparkles className="h-4 w-4" />} label="Event" value={eventType} />
                  <Row icon={<Users className="h-4 w-4" />} label="Guests" value={guests} />
                </div>

                <div className="mt-4 rounded-2xl bg-white p-4 shadow-card">
                  <PriceLine label="Hall base price"  value={formatPrice(baseAmount)} />
                  <PriceLine label={`Platform fee (${platformFeePercent}%)`} value={formatPrice(platformFee)} />
                  <div className="my-2 h-px bg-border" />
                  <PriceLine label="Total"            value={formatPrice(totalAmount)} bold />
                  <PriceLine label="Advance payable now" value={formatPrice(advance)} highlight />
                  <PriceLine label="Remaining balance" value={formatPrice(totalAmount - advance)} />
                </div>

                {/* Advance + cancellation + refund terms */}
                <div className="mt-4 space-y-2 rounded-2xl border border-border bg-ivory-50 p-4 text-[11px] leading-relaxed text-charcoal-600">
                  <p>
                    <strong className="text-charcoal-800">Advance:</strong> Your advance amount secures your
                    booking request for the selected hall and date. The remaining balance must be paid as per
                    the hall owner&apos;s final confirmation and Hallnect booking policy.
                  </p>
                  <p>
                    <strong className="text-charcoal-800">Cancellation &amp; refund:</strong> Cancellation and
                    refund eligibility depend on the cancellation date, hall owner policy, and Hallnect policy.
                    Any applicable refund will be processed after verification. See our{" "}
                    <Link href="/cancellation-policy" className="text-maroon-600 underline">Cancellation Policy</Link>{" "}
                    and <Link href="/refund-policy" className="text-maroon-600 underline">Refund Policy</Link>.
                  </p>
                </div>

                {/* Mandatory acknowledgement */}
                <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-2xl border border-border bg-white p-3.5 text-xs text-charcoal-700 shadow-card">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-charcoal-300 text-maroon-600 focus:ring-maroon-500"
                  />
                  <span>
                    I agree to the booking, cancellation, and remaining balance terms, and to Hallnect&apos;s{" "}
                    <Link href="/terms" className="text-maroon-600 underline">Terms</Link>.
                  </span>
                </label>
                {!termsAccepted && (
                  <p className="mt-2 text-center text-[11px] text-charcoal-400">
                    Please accept the terms to continue.
                  </p>
                )}
              </StepWrap>
            )}

            {/* STEP 4 — pay (online) OR confirm request (manual) */}
            {step === 4 && onlinePaymentEnabled && (
              <StepWrap title="Pay the advance" subtitle="Secured by Cashfree Payments">
                <div className="rounded-2xl bg-white p-5 shadow-card text-center">
                  <CreditCard className="mx-auto h-10 w-10 text-maroon-500" />
                  <p className="mt-3 text-xs text-charcoal-500">Pay advance</p>
                  <p className="font-serif text-3xl font-bold text-maroon-700">{formatPrice(advance)}</p>
                  <p className="mt-1 text-[11px] text-charcoal-500">Balance {formatPrice(totalAmount - advance)} due before event</p>
                </div>
                <div className="mt-4 rounded-2xl bg-amber-50 border border-amber-200 p-3 text-center text-[11px] text-amber-800">
                  <strong>Final availability check happens server-side.</strong> If the slot is no longer free, you&apos;ll be sent back to pick again. You&apos;ll be redirected to Cashfree&apos;s secure checkout to pay the advance; your booking is confirmed only after the payment is verified.
                </div>
              </StepWrap>
            )}
            {step === 4 && !onlinePaymentEnabled && (
              <StepWrap title="Submit booking request" subtitle="No online payment needed right now.">
                <div className="rounded-2xl bg-white p-5 shadow-card text-center">
                  <Receipt className="mx-auto h-10 w-10 text-maroon-500" />
                  <p className="mt-3 text-xs text-charcoal-500">Estimated advance</p>
                  <p className="font-serif text-3xl font-bold text-maroon-700">{formatPrice(advance)}</p>
                  <p className="mt-1 text-[11px] text-charcoal-500">Total {formatPrice(totalAmount)} · payable to the venue on confirmation</p>
                </div>
                <div className="mt-4 rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-center text-[11px] text-emerald-800">
                  <strong>Online payment is coming soon.</strong> Submit your request now and the Hallnect team will contact you to confirm availability and arrange payment. Your slot is held as a request.
                </div>
              </StepWrap>
            )}

            {/* STEP 5 — done */}
            {step === 5 && (
              <StepWrap title="Booking requested!" subtitle="We've sent your request to the owner.">
                <div className="rounded-2xl bg-white p-6 text-center shadow-card">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
                    <Check className="h-8 w-8" />
                  </div>
                  <p className="mt-4 font-serif text-lg font-bold text-charcoal-900">All set!</p>
                  <p className="mt-1 text-sm text-charcoal-600">
                    {hall.name} for {new Date(date).toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric" })}
                  </p>
                  {bookingId && (
                    <p className="mt-2 font-mono text-[11px] text-charcoal-500">
                      Booking #{bookingId.slice(0, 8).toUpperCase()}
                    </p>
                  )}
                  <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">
                    <Receipt className="h-3 w-3" /> Awaiting owner confirmation
                  </p>
                  {!onlinePaymentEnabled && (
                    <p className="mt-3 text-xs text-charcoal-600">
                      Your booking request has been submitted. Hallnect will contact you for confirmation and payment.
                    </p>
                  )}
                  {onlinePaymentEnabled && expiresAt && <PendingExpiryCountdown expiresAt={expiresAt} />}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Link href="/customer/bookings"><Button variant="outline" className="w-full">My Bookings</Button></Link>
                  <Link href="/"><Button variant="gold" className="w-full">Done</Button></Link>
                </div>
              </StepWrap>
            )}
          </motion.section>
        </AnimatePresence>
      </main>

      {/* Sticky action */}
      {step < STEPS.length - 1 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-white pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 px-4">
          <div className="mx-auto flex max-w-lg items-center gap-3">
            {step > 0 && (
              <Button variant="outline" onClick={back} className="px-4">Back</Button>
            )}
            <Button
              variant="gold"
              size="lg"
              className="flex-1"
              onClick={step === 4 ? (onlinePaymentEnabled ? handlePayNow : handleSubmitRequest) : next}
              disabled={!canContinue || pending}
              isLoading={pending}
            >
              {step === 3
                ? (onlinePaymentEnabled ? "Proceed to payment" : "Review request")
                : step === 4
                  ? (onlinePaymentEnabled ? `Pay ${formatPrice(advance)} with Cashfree` : "Submit Booking Request")
                  : "Continue"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepWrap({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="font-serif text-xl font-bold text-charcoal-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-charcoal-500">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="flex items-center gap-2 text-charcoal-500">
        <span className="text-maroon-500">{icon}</span>
        {label}
      </span>
      <span className="font-semibold text-charcoal-900">{value}</span>
    </div>
  );
}

function PendingExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(() => {
    return Math.max(0, new Date(expiresAt).getTime() - Date.now());
  });

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (remaining === 0) {
    return (
      <p className="mt-2 text-[11px] font-semibold text-red-600">
        Pending booking expired — slot has been released.
      </p>
    );
  }

  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return (
    <p className="mt-2 text-[11px] text-charcoal-500">
      Pending payment window:{" "}
      <span className="font-mono font-semibold text-charcoal-800">
        {minutes.toString().padStart(2, "0")}:{seconds.toString().padStart(2, "0")}
      </span>
      <span className="ml-1 text-charcoal-400">remaining</span>
    </p>
  );
}

function PriceLine({ label, value, bold, highlight }: { label: string; value: string; bold?: boolean; highlight?: boolean }) {
  return (
    <div className={cn(
      "flex items-center justify-between py-1 text-sm",
      bold && "text-base font-bold text-charcoal-900",
      highlight && "mt-1 rounded-xl bg-maroon-50 px-2 py-2 font-bold text-maroon-700",
    )}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
