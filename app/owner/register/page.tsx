// ─────────────────────────────────────────────────────────────────────────────
// app/owner/register/page.tsx — the venue owner's first impression.
//
// This is the ONLY page whose job is to turn a hall owner into a listing, so it
// answers what an owner actually asks before signing anything: what does it
// cost me, when do I get paid, and what do I have to do. The signup form alone
// answered none of that.
//
// WHAT THIS PAGE MAY NOT DO. Hallnect has no venue inventory to speak of and no
// reviews, so there is no social proof here — no counts, no testimonials, no
// "trusted by N venues". Inventing any of it would be a lie told to the exact
// people whose trust the business depends on, and the first owner to compare
// notes would find out. The pitch is the terms, which are genuinely good, and
// nothing else.
//
// It also does not promise payout TIMING. The automatic split is real in code
// but not yet switched on at the gateway, so the page describes where the money
// goes, never how fast it arrives.
//
// A Server Component: the commission rate is read live from platform_settings
// rather than written into the copy, so an admin changing the rate can never
// leave this page quoting a number the business no longer charges.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  Gem, IndianRupee, ShieldCheck, CalendarCheck, Images, BadgeCheck,
  ArrowRight, Wallet,
} from "lucide-react";
import { getCommissionPercent } from "@/lib/platform-settings";
import { PLATFORM_FEE_RUPEES } from "@/lib/booking-payment";
import { formatPrice } from "@/lib/mock-data";
import { OwnerRegisterForm } from "./_components/OwnerRegisterForm";

/** A concrete booking, so the terms are arithmetic rather than adjectives. */
const EXAMPLE_HALL_PRICE = 100_000;

export default async function OwnerRegisterPage() {
  const commissionPercent = await getCommissionPercent();

  // Worked from the same rate the platform actually charges.
  const commission = Math.round((EXAMPLE_HALL_PRICE * commissionPercent) / 100);
  const ownerKeeps = EXAMPLE_HALL_PRICE - commission;

  const steps = [
    {
      Icon: BadgeCheck,
      title: "Register and add your hall",
      body: "Photos, capacity, pricing and the dates you are free. It takes one sitting, and you can edit anything later.",
    },
    {
      Icon: ShieldCheck,
      title: "We verify it",
      body: "Our team checks every hall before it goes live, so couples browsing Hallnect are only seeing real venues.",
    },
    {
      Icon: CalendarCheck,
      title: "You approve each booking",
      body: "A request arrives with the date, the customer and the amount. Nothing is confirmed until you accept it.",
    },
  ];

  return (
    <div className="bg-ivory-100">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="bg-maroon-950 px-4 py-14 text-center sm:py-20">
        <div className="container-page">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-maroon-600 text-ivory-100">
              <Gem className="h-4 w-4" />
            </span>
            <span className="font-serif text-xl font-bold text-ivory-100">Hallnect</span>
          </Link>

          <h1 className="mx-auto mt-7 max-w-2xl font-serif text-3xl font-bold leading-tight text-ivory-100 sm:text-5xl">
            List your wedding hall. Keep {100 - commissionPercent}% of every booking.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-ivory-400">
            Hallnect brings couples in Tamil Nadu to your venue, collects the advance
            for you, and never sends you a bill. Listing is free.
          </p>

          <a
            href="#register"
            className="mt-8 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-gold-400 px-7 text-sm font-bold text-charcoal-900 transition-colors hover:bg-gold-300"
          >
            List your hall — free <ArrowRight className="h-4 w-4" />
          </a>
          <p className="mt-3 text-xs text-ivory-400">
            No listing fee. No monthly fee. No lock-in.
          </p>
        </div>
      </section>

      {/* ── The money, first, because it is the first question ───────────── */}
      <section className="container-page py-14">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center font-serif text-2xl font-bold text-charcoal-900 sm:text-3xl">
            What it costs you
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground">
            One commission, taken from the advance Hallnect already holds. There is
            nothing to pay up front and no invoice afterwards.
          </p>

          <div className="mt-8 overflow-hidden rounded-2xl border-2 border-maroon-200 bg-white shadow-card">
            <div className="border-b border-border bg-maroon-50 px-5 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-maroon-800">
                On a {formatPrice(EXAMPLE_HALL_PRICE)} booking
              </p>
            </div>
            <dl className="divide-y divide-border">
              <div className="flex items-baseline justify-between px-5 py-4">
                <dt className="text-sm text-charcoal-700">Your hall price</dt>
                <dd className="font-serif text-lg font-semibold text-charcoal-900">
                  {formatPrice(EXAMPLE_HALL_PRICE)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between px-5 py-4">
                <dt className="text-sm text-charcoal-700">
                  Hallnect commission
                  <span className="ml-1.5 rounded-full bg-charcoal-100 px-2 py-0.5 text-[11px] font-semibold text-charcoal-600">
                    {commissionPercent}%
                  </span>
                </dt>
                <dd className="font-serif text-lg font-semibold text-charcoal-500">
                  − {formatPrice(commission)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between bg-green-50 px-5 py-4">
                <dt className="text-sm font-bold text-green-900">You keep</dt>
                <dd className="font-serif text-2xl font-bold text-green-700">
                  {formatPrice(ownerKeeps)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-white p-4">
              <div className="flex items-start gap-2.5">
                <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-maroon-600" aria-hidden />
                <p className="text-xs leading-relaxed text-charcoal-700">
                  <span className="font-semibold text-charcoal-900">You are never invoiced.</span>{" "}
                  The commission comes out of the advance Hallnect collects from the
                  customer, so no money ever leaves your pocket.
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-white p-4">
              <div className="flex items-start gap-2.5">
                <IndianRupee className="mt-0.5 h-4 w-4 shrink-0 text-maroon-600" aria-hidden />
                <p className="text-xs leading-relaxed text-charcoal-700">
                  <span className="font-semibold text-charcoal-900">
                    The {formatPrice(PLATFORM_FEE_RUPEES)} platform fee is the customer&apos;s.
                  </span>{" "}
                  It is charged on top of the advance and is never deducted from your share.
                </p>
              </div>
            </div>
          </div>

          <p className="mt-4 text-center text-xs text-charcoal-500">
            The customer pays an advance online to hold the date. The balance is
            collected by you, directly, as it always was.
          </p>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="border-y border-border bg-white py-14">
        <div className="container-page">
          <h2 className="text-center font-serif text-2xl font-bold text-charcoal-900 sm:text-3xl">
            How it works
          </h2>
          <ol className="mx-auto mt-8 grid max-w-4xl gap-5 sm:grid-cols-3">
            {steps.map(({ Icon, title, body }, i) => (
              <li key={title} className="rounded-2xl border border-border bg-ivory-50 p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-maroon-100 text-maroon-700">
                  <Icon className="h-4.5 w-4.5" aria-hidden />
                </div>
                <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-maroon-700">
                  Step {i + 1}
                </p>
                <h3 className="mt-0.5 font-serif text-base font-semibold text-charcoal-900">
                  {title}
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-charcoal-600">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── What to have ready — cuts the drop-off mid-form ──────────────── */}
      <section className="container-page py-14">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center font-serif text-2xl font-bold text-charcoal-900 sm:text-3xl">
            What to have ready
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-center text-sm text-muted-foreground">
            Nothing here is needed to register — only to publish your hall and to be
            paid. Worth knowing now rather than halfway through a form.
          </p>
          <ul className="mx-auto mt-7 grid max-w-2xl gap-3 sm:grid-cols-2">
            {[
              { Icon: Images, label: "Photos of the hall", note: "The single biggest thing couples judge a venue on." },
              { Icon: IndianRupee, label: "Your pricing", note: "Full-day rate, and morning or evening rates if you offer them." },
              { Icon: CalendarCheck, label: "Capacity and address", note: "Seating capacity, and where the hall is." },
              { Icon: Wallet, label: "Bank account and PAN", note: "Needed only to receive payouts — you can add it later." },
            ].map(({ Icon, label, note }) => (
              <li key={label} className="flex items-start gap-3 rounded-xl border border-border bg-white p-4">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-maroon-600" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-charcoal-900">{label}</p>
                  <p className="mt-0.5 text-xs text-charcoal-500">{note}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Register ─────────────────────────────────────────────────────── */}
      <section className="border-t border-border bg-white px-4 py-14">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-7 text-center">
            <h2 className="font-serif text-2xl font-bold text-charcoal-900 sm:text-3xl">
              List your hall
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Free to join. You can add your hall straight after registering.
            </p>
          </div>
          <OwnerRegisterForm />
        </div>
      </section>
    </div>
  );
}
