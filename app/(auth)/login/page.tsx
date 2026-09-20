"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Sign in. Two doors: Google, and a mobile number.
//
// THE EMAIL LINK AND THE PASSWORD FIELD WERE REMOVED, and the reason belongs
// here because it will look like a regression to whoever arrives next.
//
//   • The email sign-in LINK needed an email transport this project does not
//     have. Supabase's built-in sender is a testing facility — rate limited,
//     and on newer projects restricted to team addresses — so it was a button
//     that mostly could not work.
//   • The PASSWORD field had never signed anybody in. Every account that has
//     ever existed here is a Google identity, and a check of auth.users found
//     ZERO accounts with a password set. It also implied a reset flow the
//     product did not have, so the choice was to build password recovery for
//     nobody or to stop offering a credential nobody could recover. This is
//     the second.
//
// What is left is what people already used: Google, which proves an email
// address in one tap, and a mobile number, which both signs in and signs up.
// Nobody is locked out, and there is no longer a credential in the product
// that cannot be recovered.
//
// SIGNING IN AND SIGNING UP ARE THE SAME ACTION. A number with no account gets
// one the moment MSG91 approves the code, and Google creates one on first use,
// so there is no separate "create an account" path to link to.
//
// The step machine is deliberately flat: one screen does one thing, and Back
// always returns to the chooser. A single form that grows extra fields as you
// go is how OTP screens end up with a stale phone number in a hidden input.
//
// THE LOOK (2026-09-18): a split screen — the grand-hall photograph with a slow
// zoom, drifting gold light and a rotating headline on one side, a frosted
// sign-in card on the other; on phones the photograph becomes the header and
// the card rises over it. Every animation is decorative and switched off for
// visitors who ask their system for reduced motion (useReducedMotion). The
// sign-in logic below the visuals is unchanged.
//
// ENTRANCES ARE CSS, NOT FRAMER. The first version faded the card and buttons
// in with framer-motion `initial={{ opacity: 0 }}`, which the server renders as
// inline opacity:0 — so until JavaScript hydrated and requestAnimationFrame ran,
// the sign-in card was invisible. On the live site that showed as a photo and
// an empty column. Anything a visitor must see now enters with a CSS animation
// (tailwindcss-animate), which runs from the server HTML with no JavaScript;
// framer-motion is kept only for things that start visible (hover, step
// changes, the drifting light, the rotating word).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, CheckCircle2, Loader2, Phone, ShieldCheck, Smartphone } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { buildAuthCallbackUrl, rememberAuthNext } from "@/lib/app-url";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import { OtpInput } from "@/components/auth/OtpInput";
import { startPhoneSignIn, verifyPhoneSignIn } from "./phone-actions";

// Destinations a ?next= on the LOGIN page may name. This mirrors the callback's
// allow-list rather than accepting any root-relative path.
//
// SECURITY: an earlier version ended in a bare `return raw`, so ?next= could
// name ANY internal path — including the owner-intent marker
// /auth/set-owner-role, which the callback acts on by promoting the user to
// owner_approved. A link like /login?next=/auth/set-owner-role therefore
// silently escalated any customer who signed in with Google. Owner intent now
// travels in its own cookie that only /owner/register writes, and this list
// makes the login page unable to name a privileged marker even if one is added
// later. DO NOT loosen it.
//
// "/enquiry/" belongs here for the same reason "/book/" does, and its absence
// broke the whole lead funnel: a visitor who taps "Send Enquiry" on a
// LEAD_GENERATION venue is sent to /login?next=/enquiry/<slug>, this list
// refused the value, and they were dropped on /customer having lost the venue
// they came for. It is exactly as safe as "/book/": slug-only, auth-gated,
// notFound on an unknown slug, no privileged side effect.
const ALLOWED_NEXT_PREFIXES = ["/auth/redirect", "/book/", "/enquiry/", "/customer", "/owner/", "/halls"];

function safeNextPath(raw: string | null): string {
  const fallback = "/auth/redirect";
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  try {
    const u = new URL(raw, "https://internal.invalid");
    if (u.origin !== "https://internal.invalid") return fallback;
  } catch {
    return fallback;
  }
  const allowed = ALLOWED_NEXT_PREFIXES.some((p) => raw === p || raw.startsWith(p));
  return allowed ? raw : fallback;
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_failed:     "Google sign-in could not be completed. Please try again.",
  account_disabled: "This account has been deactivated. Contact Hallnect support if you think this is a mistake.",
};

const OTP_LENGTH = 6;
type Step = "choose" | "mobile" | "code";

/** "+91 98765 43210" from the ten digits, for the confirmation line. */
function prettyPhone(ten: string): string {
  return ten.length === 10 ? `+91 ${ten.slice(0, 5)} ${ten.slice(5)}` : `+91 ${ten}`;
}

// ── Visual constants ────────────────────────────────────────────────────────

/** The same events the homepage hero rotates through. */
// The words the hero cycles through.
//
// BROADENED WHEN HALLNECT STOPPED BEING A WEDDING-HALL SITE. It was
// wedding/reception/engagement/celebration — four words that told a visitor,
// before they read anything else, that this was a wedding product. It now
// spans the catalogue's range, because this line is the single most prominent
// statement the site makes about what it is for.
//
// CURATED, NOT THE WHOLE CATALOGUE, and deliberately so. This is a headline,
// not a directory: the words have to fit "Every ___ starts with the right
// hall." and read naturally there. "naming ceremony" and "product launch" are
// real categories and both make that sentence clumsy. The full twenty-eight
// live in the discovery grid, which is the surface that owes completeness.
//
// Kept identical to the sign-in page's list on purpose — the two screens were
// matched deliberately and should be changed together.
const OCCASIONS = [
  "wedding", "reception", "birthday", "party", "meeting", "conference", "celebration",
] as const;

/** The homepage trust points, verbatim — true statements about how Hallnect works. */
const TRUST_POINTS = [
  "Transparent pricing",
  "Listed by venue owners",
  "Approved before going live",
  "Free to enquire",
] as const;

/**
 * Drifting gold motes. FIXED positions, not Math.random(): the page is
 * server-rendered first, and random values would differ between the server
 * HTML and the first client render (a hydration mismatch).
 */
const SPARKS = [
  { left: "8%",  top: "72%", size: 5, delay: 0,   duration: 9 },
  { left: "18%", top: "38%", size: 3, delay: 1.2, duration: 11 },
  { left: "27%", top: "84%", size: 4, delay: 2.5, duration: 10 },
  { left: "36%", top: "22%", size: 2, delay: 0.6, duration: 12 },
  { left: "46%", top: "64%", size: 5, delay: 3.1, duration: 9.5 },
  { left: "55%", top: "30%", size: 3, delay: 1.8, duration: 10.5 },
  { left: "63%", top: "78%", size: 4, delay: 4.2, duration: 11.5 },
  { left: "71%", top: "46%", size: 2, delay: 2.2, duration: 8.5 },
  { left: "80%", top: "68%", size: 5, delay: 0.9, duration: 12.5 },
  { left: "88%", top: "26%", size: 3, delay: 3.6, duration: 10 },
  { left: "93%", top: "58%", size: 4, delay: 5,   duration: 9 },
] as const;

const EASE = [0.22, 1, 0.36, 1] as const;

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const authError = AUTH_ERROR_MESSAGES[searchParams.get("error") ?? ""] ?? null;

  const [step, setStep] = useState<Step>("choose");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [ten, setTen] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [cooldown, setCooldown] = useState(0);

  const reduceMotion = useReducedMotion() ?? false;

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  function go(next: Step) {
    setError(null);
    setStep(next);
  }

  function sendCode(resend = false) {
    setError(null);
    startTransition(async () => {
      const r = await startPhoneSignIn(`+91${ten}`, resend);
      if ("error" in r) { setError(r.error); return; }
      setCooldown(r.cooldownSeconds);
      // Only a FRESH send invalidates the previous code. MSG91's retry
      // re-delivers the same one, so clearing the boxes there would throw away
      // a code the user may already be looking at.
      if (!resend) setDigits(Array(OTP_LENGTH).fill(""));
      setStep("code");
    });
  }

  function submitCode(code: string) {
    setError(null);
    startTransition(async () => {
      const r = await verifyPhoneSignIn(`+91${ten}`, code);
      if ("error" in r) {
        setError(r.error);
        setDigits(Array(OTP_LENGTH).fill(""));
        return;
      }
      // A number with no account got one, so there is no "please sign up"
      // branch — signing in and signing up end in the same place. The session
      // cookie is already written by the server action; refresh() makes the
      // server components re-read it before we navigate.
      router.refresh();
      router.push(nextPath);
    });
  }

  function googleLogin() {
    // Destination travels in a cookie: appending ?next= to redirect_to breaks
    // Supabase's allow-list match and drops us on the SSO-walled Site URL.
    rememberAuthNext(nextPath);
    getSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: buildAuthCallbackUrl() },
    });
  }

  const canSend = /^[6-9]\d{9}$/.test(ten);
  const shownError = error ?? authError;

  // Step panels slide sideways; with reduced motion they simply cross-fade.
  const stepMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, x: 28, filter: "blur(4px)" },
        animate: { opacity: 1, x: 0, filter: "blur(0px)" },
        exit: { opacity: 0, x: -28, filter: "blur(4px)" },
      };

  return (
    <div className="relative isolate flex min-h-[100dvh] flex-col overflow-hidden bg-ivory-100 lg:grid lg:min-h-[calc(100vh-4rem)] lg:grid-cols-[1.05fr_1fr]">
      {/* ── Showcase: the hall ─────────────────────────────────────────────── */}
      <section
        aria-hidden
        className="relative h-[42vh] min-h-[280px] overflow-hidden bg-maroon-950 lg:h-auto lg:min-h-0"
      >
        <motion.div
          className="absolute inset-0"
          initial={{ scale: reduceMotion ? 1.05 : 1.18 }}
          animate={reduceMotion ? { scale: 1.05 } : { scale: [1.18, 1.05, 1.1] }}
          transition={reduceMotion ? { duration: 0 } : { duration: 24, ease: "easeInOut", repeat: Infinity, repeatType: "mirror" }}
        >
          <Image
            src="/scrub/hall-walkthrough-poster.jpg"
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 55vw, 100vw"
            className="object-cover"
          />
        </motion.div>

        {/* Colour grade: maroon from below, darker at the edges. */}
        <div className="absolute inset-0 bg-gradient-to-t from-maroon-950 via-maroon-950/55 to-maroon-950/10" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(26,6,10,0.65)_100%)]" />

        {/* Drifting gold light */}
        {!reduceMotion && (
          <div className="pointer-events-none absolute inset-0">
            {SPARKS.map((s, i) => (
              <motion.span
                key={i}
                className="absolute rounded-full bg-gold-300 shadow-[0_0_12px_3px_rgba(224,168,32,0.55)]"
                style={{ left: s.left, top: s.top, width: s.size, height: s.size }}
                initial={{ opacity: 0, y: 0 }}
                animate={{ opacity: [0, 0.9, 0], y: [0, -90, -170] }}
                transition={{ duration: s.duration, delay: s.delay, repeat: Infinity, ease: "easeOut" }}
              />
            ))}
          </div>
        )}

        {/* Copy — the headline block is decorative on phones (small header). */}
        <div className="absolute inset-x-0 bottom-0 z-10 px-6 pb-16 sm:px-10 lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 lg:px-14 lg:pb-0">
          <p className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:delay-[150ms] inline-flex items-center gap-2 rounded-full border border-gold-400/40 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-200 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-gold-400" />
            Halls for every occasion · Tamil Nadu
          </p>

          <h2 className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:delay-[280ms] mt-4 max-w-xl font-serif text-3xl font-bold leading-[1.1] text-ivory-50 sm:text-4xl lg:text-5xl">
            Every{" "}
            <span className="relative inline-block min-w-[6.5ch] align-bottom">
              <RotatingOccasion reduceMotion={reduceMotion} />
            </span>
            <br />
            starts with the right hall.
          </h2>

          <ul className="mt-7 hidden max-w-md grid-cols-2 gap-x-6 gap-y-3 lg:grid">
            {TRUST_POINTS.map((t, i) => (
              <li
                key={t}
                className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:fill-mode-both flex items-center gap-2 text-sm text-ivory-100/90"
                style={{ animationDelay: `${420 + i * 90}ms` }}
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 fill-gold-400 text-maroon-950" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Sign-in ────────────────────────────────────────────────────────── */}
      <section className="relative z-10 -mt-10 flex flex-1 items-start justify-center rounded-t-[2rem] bg-ivory-100 px-4 pb-12 pt-8 lg:mt-0 lg:items-center lg:rounded-none lg:px-10 lg:py-12">
        {/* Soft moving glows behind the card */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <motion.div
            className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-gold-300/30 blur-3xl"
            animate={reduceMotion ? undefined : { x: [0, -30, 0], y: [0, 40, 0], scale: [1, 1.12, 1] }}
            transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-maroon-300/25 blur-3xl"
            animate={reduceMotion ? undefined : { x: [0, 40, 0], y: [0, -30, 0], scale: [1, 1.08, 1] }}
            transition={{ duration: 17, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        <div className="w-full max-w-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-8 motion-safe:zoom-in-[0.98] motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:delay-100">
          <div className="mb-7 text-center">
            <Link href="/" className="group inline-flex flex-col items-center gap-2" aria-label="Hallnect home">
              <motion.span
                className="relative block h-16 w-16 rounded-full bg-white p-2.5 shadow-gold ring-1 ring-gold-400/40 motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:spin-in-12 motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:delay-300"
                whileHover={reduceMotion ? undefined : { rotate: 6, scale: 1.06 }}
              >
                <span className="relative block h-full w-full">
                  <Image src="/logo.png" alt="" fill sizes="44px" className="object-contain" priority />
                </span>
              </motion.span>
              <span className="font-serif text-xl font-bold text-maroon-800">Hallnect</span>
            </Link>
            <h1 className="mt-4 font-serif text-3xl font-bold text-charcoal-900">
              Welcome to{" "}
              <span className="bg-[linear-gradient(90deg,#BA8017,#E0A820,#F2CF6B,#E0A820,#BA8017)] bg-[length:200%_100%] bg-clip-text text-transparent motion-safe:animate-[shimmer_6s_linear_infinite]">
                Hallnect
              </span>
            </h1>
            <p className="mx-auto mt-2 max-w-xs text-sm text-charcoal-600">
              Sign in to discover, book and manage your perfect venue.
            </p>
          </div>

          <div className="relative rounded-3xl p-[1px] shadow-elevated">
            {/* Gold hairline border with a slow travelling highlight */}
            <div aria-hidden className="absolute inset-0 rounded-3xl bg-gradient-to-br from-gold-300/70 via-white/40 to-maroon-200/60" />
            <div className="relative rounded-[calc(1.5rem-1px)] bg-white/85 p-6 backdrop-blur-xl sm:p-7">
              <AnimatePresence initial={false}>
                {shownError && (
                  <motion.div
                    key="error"
                    role="alert"
                    aria-live="polite"
                    initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                    animate={{ opacity: 1, height: "auto", marginBottom: 20, x: reduceMotion ? 0 : [0, -6, 6, -3, 3, 0] }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.35 }}
                    className="overflow-hidden rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  >
                    {shownError}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence mode="wait" initial={false}>
                {/* ── Choose a door ─────────────────────────────────────────── */}
                {/* Google first, and sized like the answer rather than an option:
                    no typing, no code, no carrier involved, and every account
                    that exists today is already a Google identity. Mobile sits
                    under it for anyone who would rather not use Google at all. */}
                {step === "choose" && (
                  <motion.div key="choose" {...stepMotion} transition={{ duration: 0.3, ease: EASE }}>
                    <div className="space-y-3">
                      <motion.button
                        type="button"
                        onClick={googleLogin}
                        whileHover={reduceMotion ? undefined : { y: -2 }}
                        whileTap={reduceMotion ? undefined : { scale: 0.98 }}
                        className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:delay-[350ms] group relative flex min-h-[54px] w-full items-center justify-center gap-3 overflow-hidden rounded-2xl bg-charcoal-900 px-4 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-charcoal-800"
                      >
                        {/* light sweep on hover */}
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 transition-all duration-700 group-hover:left-[120%] group-hover:opacity-100 motion-reduce:hidden"
                        />
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white">
                          <GoogleIcon />
                        </span>
                        Continue with Google
                      </motion.button>

                      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:delay-[430ms] flex items-center gap-3 py-1" aria-hidden>
                        <span className="h-px flex-1 bg-gradient-to-r from-transparent to-gold-300/70" />
                        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-charcoal-400">or</span>
                        <span className="h-px flex-1 bg-gradient-to-l from-transparent to-gold-300/70" />
                      </div>

                      <motion.button
                        type="button"
                        onClick={() => go("mobile")}
                        whileHover={reduceMotion ? undefined : { y: -2 }}
                        whileTap={reduceMotion ? undefined : { scale: 0.98 }}
                        className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:delay-[510ms] group flex min-h-[54px] w-full items-center justify-center gap-3 rounded-2xl border border-gold-300/60 bg-white px-4 text-sm font-semibold text-charcoal-800 shadow-sm transition-colors hover:border-maroon-300 hover:bg-ivory-50"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-maroon-50 transition-colors group-hover:bg-maroon-100">
                          <Smartphone className="h-4 w-4 text-maroon-700" aria-hidden />
                        </span>
                        Continue with mobile
                      </motion.button>

                      {/* PRESENTMENT, NOT A CHECKBOX.
                          /login is the real sign-up for BOTH doors — /signup is
                          only a redirect here — and it carried no Terms or
                          Privacy reference at all, while /owner/register carried
                          browsewrap text on its Google path only. An account was
                          being created with the governing documents named
                          nowhere.

                          Links, not a tick box: adding a consent checkbox here
                          would create a consent artifact with nothing to store it
                          in (profiles has no consent column and its UPDATE grants
                          are column-pinned by 0084), and a recorded consent
                          nobody can produce later is worse than an honest
                          browsewrap. The stored, versioned artifact already
                          exists where money changes hands —
                          bookings.terms_accepted / terms_version. */}
                      <p className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:delay-[590ms] pt-2 text-center text-xs leading-relaxed text-charcoal-500">
                        New here? Either option creates your account. By continuing you agree to our{" "}
                        <Link href="/terms" className="font-semibold text-maroon-700 underline underline-offset-2">
                          Terms of Service
                        </Link>{" "}
                        and{" "}
                        <Link href="/privacy" className="font-semibold text-maroon-700 underline underline-offset-2">
                          Privacy Policy
                        </Link>
                        .
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* ── Mobile number ─────────────────────────────────────────── */}
                {step === "mobile" && (
                  <motion.div key="mobile" {...stepMotion} transition={{ duration: 0.3, ease: EASE }} className="space-y-4">
                    <BackLink onClick={() => go("choose")} />
                    <div>
                      <Label htmlFor="mobile">Mobile number</Label>
                      <div className="mt-1.5 flex gap-2">
                        <span className="inline-flex min-h-[50px] shrink-0 items-center rounded-xl border border-border bg-ivory-50 px-3 text-sm font-semibold text-charcoal-600">
                          +91
                        </span>
                        <div className="relative flex-1">
                          <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal-400" aria-hidden />
                          <Input
                            id="mobile"
                            type="tel"
                            inputMode="numeric"
                            autoComplete="tel-national"
                            autoFocus
                            placeholder="98765 43210"
                            className="min-h-[50px] pl-9 text-base tracking-wide transition-shadow focus-visible:shadow-gold"
                            value={ten}
                            onChange={(e) => setTen(e.target.value.replace(/\D/g, "").slice(0, 10))}
                            onKeyDown={(e) => { if (e.key === "Enter" && canSend) sendCode(false); }}
                            aria-describedby="mobile-hint"
                          />
                        </div>
                      </div>
                      {/* Ten-segment progress under the field: fills as digits are typed. */}
                      <div className="mt-2 flex gap-1" aria-hidden>
                        {Array.from({ length: 10 }, (_, i) => (
                          <motion.span
                            key={i}
                            className="h-1 flex-1 rounded-full"
                            initial={false}
                            animate={{ backgroundColor: i < ten.length ? (canSend ? "#16a34a" : "#C9901A") : "#E8E2D6" }}
                            transition={{ duration: 0.2 }}
                          />
                        ))}
                      </div>
                      <p id="mobile-hint" className="mt-2 text-xs text-charcoal-500">
                        Indian mobile numbers only. Standard SMS rates may apply.
                      </p>
                    </div>
                    <Button className="w-full" onClick={() => sendCode(false)} disabled={!canSend || pending} isLoading={pending}>
                      {pending ? "Sending…" : "Send code"}
                    </Button>
                  </motion.div>
                )}

                {/* ── Code ──────────────────────────────────────────────────── */}
                {step === "code" && (
                  <motion.div key="code" {...stepMotion} transition={{ duration: 0.3, ease: EASE }} className="space-y-4">
                    <BackLink label="Change number" onClick={() => { setDigits(Array(OTP_LENGTH).fill("")); go("mobile"); }} />
                    <div>
                      <p className="font-serif text-lg font-bold text-charcoal-900">Enter the code</p>
                      <p className="mt-1 text-sm text-charcoal-600">
                        Sent to <span className="font-medium text-charcoal-800">{prettyPhone(ten)}</span>
                      </p>
                    </div>
                    <OtpInput
                      label="Verification code"
                      value={digits}
                      onChange={setDigits}
                      onComplete={submitCode}
                      disabled={pending}
                      invalid={Boolean(error)}
                      autoFocus
                    />
                    {pending && (
                      <p className="flex items-center justify-center gap-2 text-sm text-charcoal-500">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking…
                      </p>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <button
                        type="button"
                        onClick={() => sendCode(true)}
                        disabled={cooldown > 0 || pending}
                        className="font-semibold text-maroon-700 hover:underline disabled:cursor-not-allowed disabled:text-charcoal-400 disabled:no-underline"
                      >
                        {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                      </button>
                      <button
                        type="button"
                        onClick={() => submitCode(digits.join(""))}
                        disabled={digits.includes("") || pending}
                        className="font-semibold text-maroon-700 hover:underline disabled:cursor-not-allowed disabled:text-charcoal-400 disabled:no-underline"
                      >
                        Verify
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <p className="mt-6 flex items-center justify-center gap-1.5 border-t border-border/70 pt-4 text-[11px] text-charcoal-500">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                We never ask for a password. Never share your code with anyone.
              </p>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-charcoal-600">
            Own a venue?{" "}
            <Link href="/owner/register" className="font-semibold text-maroon-600 hover:underline">
              List your hall
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}

/** The word in "Every ___ starts with the right hall", swapped every 2.6s. */
function RotatingOccasion({ reduceMotion }: { reduceMotion: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduceMotion) return;
    const t = setInterval(() => setI((n) => (n + 1) % OCCASIONS.length), 2600);
    return () => clearInterval(t);
  }, [reduceMotion]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={OCCASIONS[i]}
        className="inline-block bg-gold-gradient bg-clip-text italic text-transparent"
        initial={{ opacity: 0, y: "0.45em", filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: "-0.45em", filter: "blur(6px)" }}
        transition={{ duration: 0.45, ease: EASE }}
      >
        {OCCASIONS[i]}
      </motion.span>
    </AnimatePresence>
  );
}

function BackLink({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group -ml-1 inline-flex items-center gap-1 text-sm font-medium text-charcoal-500 transition hover:text-maroon-700"
    >
      <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 motion-reduce:transition-none" aria-hidden />
      {label}
    </button>
  );
}
