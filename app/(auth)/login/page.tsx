"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Sign in. Google leads, mobile follows, email is a link.
//
// THE ORDER IS THE DESIGN, and it is ranked by how likely each is to just work:
//   1. GOOGLE — no typing, no code, no carrier involved, and every account that
//      exists today is already a Google identity. After it, /auth/redirect asks
//      once for a mobile number, skippable, because the number is what venues
//      actually reach people on.
//   2. MOBILE — one number, one code, and it BOTH signs in and signs up: a
//      number with no account gets one the moment MSG91 approves the code.
//   3. EMAIL — a text link, not a button. It is the slowest of the three and,
//      until custom SMTP is configured on the Supabase project, a link does not
//      reach anyone. The error below says so rather than spinning.
//
// Password sign-in is kept behind the email step for anyone who has one. No
// live account does.
//
// The step machine is deliberately flat: one screen does one thing, and Back
// always returns to the chooser. A single form that grows extra fields as you
// go is how OTP screens end up with a stale phone number in a hidden input.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Lock, Mail, Phone, Smartphone } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { buildAuthCallbackUrl, rememberAuthNext } from "@/lib/app-url";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import { OtpInput } from "@/components/auth/OtpInput";
import { loginSchema } from "@/lib/validation/schemas";
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
const ALLOWED_NEXT_PREFIXES = ["/auth/redirect", "/book/", "/customer", "/owner/", "/halls"];

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
type Step = "choose" | "mobile" | "code" | "email";

/**
 * Is this address one Google already signs in?
 *
 * Every account on Hallnect today is @gmail.com, and for those people the email
 * LINK is strictly the worse path: it needs an inbox round trip, it depends on
 * an email transport this project does not have, and the Google button proves
 * the same address instantly. Recognising them and saying so is better than
 * sending them to a link that may never arrive.
 *
 * Consumer domains only. A Google Workspace address on a custom domain is
 * indistinguishable from any other domain without a DNS lookup, and guessing
 * wrong would push somebody at a button that cannot sign them in.
 */
function isGoogleAddress(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return domain === "gmail.com" || domain === "googlemail.com";
}

/** "+91 98765 43210" from the ten digits, for the confirmation line. */
function prettyPhone(ten: string): string {
  return ten.length === 10 ? `+91 ${ten.slice(0, 5)} ${ten.slice(5)}` : `+91 ${ten}`;
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const authError = AUTH_ERROR_MESSAGES[searchParams.get("error") ?? ""] ?? null;

  const [step, setStep] = useState<Step>("choose");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Mobile
  const [ten, setTen] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [cooldown, setCooldown] = useState(0);

  // Email
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [useGoogleInstead, setUseGoogleInstead] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  function go(next: Step) {
    setError(null);
    setStep(next);
  }

  // ── Mobile ────────────────────────────────────────────────────────────────
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
      // branch to handle — signing in and signing up end in the same place.
      // The session cookie is already written by the server action. refresh()
      // makes the server components re-read it before we navigate.
      router.refresh();
      router.push(nextPath);
    });
  }

  // ── Email ─────────────────────────────────────────────────────────────────
  function sendMagicLink() {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    // A Gmail address never needs the link. Handled before the network call so
    // nobody waits on a request whose best outcome is still slower than the
    // button one tap away.
    if (isGoogleAddress(email)) {
      setUseGoogleInstead(true);
      return;
    }

    startTransition(async () => {
      rememberAuthNext(nextPath);
      const { error: e } = await getSupabaseClient().auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: buildAuthCallbackUrl() },
      });
      if (e) {
        // Almost always the project's email transport, not the address. Saying
        // "check your email" here would leave somebody waiting for a message
        // that is never coming.
        setError(
          "We could not send the sign-in link. Please use Google or your mobile number for now.",
        );
        return;
      }
      setLinkSent(true);
    });
  }

  function passwordLogin(e: React.FormEvent) {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast({ title: "Check your details", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }
    startTransition(async () => {
      const { error: e } = await getSupabaseClient().auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (e) { setError("That email and password did not match."); return; }
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

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-ivory-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 text-center">
          <Link href="/" className="inline-flex flex-col items-center gap-2" aria-label="Hallnect home">
            <span className="relative block h-14 w-14">
              <Image src="/logo.png" alt="" fill sizes="56px" className="object-contain" priority />
            </span>
            <span className="font-serif text-xl font-bold text-maroon-800">Hallnect</span>
          </Link>
          <h1 className="mt-5 font-serif text-3xl font-bold text-charcoal-900">
            Welcome to Hallnect
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-sm text-charcoal-600">
            Sign in to discover, book and manage your perfect venue.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-card">
          {(authError || error) && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error ?? authError}
            </div>
          )}

          {/* ── Choose a door ─────────────────────────────────────────────── */}
          {/* GOOGLE FIRST, and sized like the answer rather than an option.
              Every account that exists today is a Google identity, it needs no
              code and no typing, and it is the one path that cannot fail on a
              carrier. Mobile sits under it for people coming back to a number
              they have already verified. Email is a text link because it is the
              slowest of the three and, until SMTP is configured, the least
              likely to work. */}
          {step === "choose" && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={googleLogin}
                className="flex min-h-[52px] w-full items-center justify-center gap-3 rounded-xl bg-charcoal-900 px-4 text-sm font-semibold text-white transition hover:bg-charcoal-800 active:scale-[0.99] motion-reduce:active:scale-100"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
                  <GoogleIcon />
                </span>
                Continue with Google
              </button>

              <button
                type="button"
                onClick={() => go("mobile")}
                className="flex min-h-[52px] w-full items-center justify-center gap-3 rounded-xl border border-border bg-white px-4 text-sm font-semibold text-charcoal-800 transition hover:border-maroon-300 hover:bg-ivory-50 active:scale-[0.99] motion-reduce:active:scale-100"
              >
                <Smartphone className="h-5 w-5 text-maroon-700" aria-hidden />
                Continue with mobile
              </button>

              <p className="pt-1 text-center text-xs text-charcoal-500">
                <button
                  type="button"
                  onClick={() => go("email")}
                  className="font-semibold text-charcoal-600 underline-offset-2 hover:text-maroon-700 hover:underline"
                >
                  Use email instead
                </button>
              </p>
            </div>
          )}

          {/* ── Mobile number ─────────────────────────────────────────────── */}
          {step === "mobile" && (
            <div className="space-y-4">
              <BackLink onClick={() => go("choose")} />
              <div>
                <Label htmlFor="mobile">Mobile number</Label>
                <div className="mt-1.5 flex gap-2">
                  <span className="inline-flex min-h-[48px] shrink-0 items-center rounded-xl border border-border bg-ivory-50 px-3 text-sm font-medium text-charcoal-600">
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
                      className="min-h-[48px] pl-9"
                      value={ten}
                      onChange={(e) => setTen(e.target.value.replace(/\D/g, "").slice(0, 10))}
                      onKeyDown={(e) => { if (e.key === "Enter" && canSend) sendCode(false); }}
                      aria-describedby="mobile-hint"
                    />
                  </div>
                </div>
                <p id="mobile-hint" className="mt-2 text-xs text-charcoal-500">
                  Indian mobile numbers only. Standard SMS rates may apply.
                </p>
              </div>
              <Button className="w-full" onClick={() => sendCode(false)} disabled={!canSend || pending} isLoading={pending}>
                {pending ? "Sending…" : "Send code"}
              </Button>
            </div>
          )}

          {/* ── Code ──────────────────────────────────────────────────────── */}
          {step === "code" && (
            <div className="space-y-4">
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
            </div>
          )}

          {/* ── Email ─────────────────────────────────────────────────────── */}
          {step === "email" && (
            <div className="space-y-4">
              <BackLink onClick={() => { setLinkSent(false); setUseGoogleInstead(false); go("choose"); }} />

              {linkSent ? (
                <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-center">
                  <Mail className="mx-auto h-8 w-8 text-green-600" aria-hidden />
                  <p className="mt-2 font-serif text-lg font-bold text-charcoal-900">Check your email</p>
                  <p className="mt-1 text-sm text-charcoal-600">
                    We sent a sign-in link to <span className="font-medium">{email.trim()}</span>.
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <Label htmlFor="email">Email address</Label>
                    <div className="relative mt-1.5">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal-400" aria-hidden />
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        autoFocus
                        placeholder="you@example.com"
                        className="min-h-[48px] pl-9"
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); setUseGoogleInstead(false); }}
                      />
                    </div>
                  </div>

                  {useGoogleInstead && (
                    <div className="rounded-xl border border-gold-200 bg-gold-50 p-4 text-center">
                      <p className="text-sm text-charcoal-800">
                        That is a Google address. Signing in with Google is faster and
                        needs no code.
                      </p>
                      <button
                        type="button"
                        onClick={googleLogin}
                        className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-3 rounded-xl bg-charcoal-900 px-4 text-sm font-semibold text-white transition hover:bg-charcoal-800"
                      >
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
                          <GoogleIcon />
                        </span>
                        Continue with Google
                      </button>
                    </div>
                  )}

                  {showPassword ? (
                    <form onSubmit={passwordLogin} className="space-y-3">
                      <div>
                        <Label htmlFor="password">Password</Label>
                        <div className="relative mt-1.5">
                          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal-400" aria-hidden />
                          <Input
                            id="password"
                            type="password"
                            autoComplete="current-password"
                            placeholder="••••••••"
                            className="min-h-[48px] pl-9"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            minLength={6}
                          />
                        </div>
                      </div>
                      <Button type="submit" className="w-full" isLoading={pending}>Sign in</Button>
                    </form>
                  ) : (
                    <Button className="w-full" onClick={sendMagicLink} isLoading={pending}>
                      {pending ? "Sending…" : "Email me a sign-in link"}
                    </Button>
                  )}

                  <button
                    type="button"
                    onClick={() => { setShowPassword((v) => !v); setError(null); }}
                    className="w-full text-center text-xs font-semibold text-maroon-700 hover:underline"
                  >
                    {showPassword ? "Email me a link instead" : "I have a password"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 space-y-1.5 text-center text-sm text-charcoal-600">
          <p>
            New to Hallnect?{" "}
            <Link href="/signup" className="font-semibold text-maroon-600 hover:underline">
              Create an account
            </Link>
          </p>
          <p className="text-xs">
            Own a venue?{" "}
            <Link href="/owner/register" className="font-semibold text-maroon-600 hover:underline">
              List your hall
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function BackLink({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 inline-flex items-center gap-1 text-sm font-medium text-charcoal-500 transition hover:text-maroon-700"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}
