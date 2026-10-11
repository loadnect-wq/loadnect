"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Registering as a venue owner: with Google, or with a mobile number.
//
// MOBILE ADDED 2026-10-11. Many hall owners do not use Gmail, and "help them
// make a Google account first" was the outreach kit's worst step. A mobile
// number is what every owner has.
//
// HOW EACH DOOR MAKES AN OWNER — the same rule, in one function
// (lib/auth/owner-upgrade.ts), applied only inside a sign-in the person just
// completed themselves:
//   • Google: the owner-intent cookie this page writes is read in
//     /auth/callback, after the OAuth code exchange.
//   • Mobile: verifyPhoneSignIn(…, "owner") upgrades the account after MSG91
//     approves the code and a session has been minted. Before 2026-10-11 the
//     mobile path never passed through the callback and would have created a
//     CUSTOMER, which is why this page used to be Google only.
// Either way the result is customer → owner_approved and nothing more; every
// hall still needs admin approval before families see it.
//
// No email-and-password form: it was removed with password auth (no account
// had a password; the form implied a reset flow and a confirmation email that
// did not exist).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Loader2, Phone, Smartphone } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { buildAuthCallbackUrl, rememberAuthNext, rememberOwnerIntent } from "@/lib/app-url";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import { OtpInput } from "@/components/auth/OtpInput";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startPhoneSignIn, verifyPhoneSignIn } from "@/app/(auth)/login/phone-actions";

const OTP_LENGTH = 6;
type Step = "choose" | "mobile" | "code";

/** The role router: an owner lands on the owner dashboard. */
const AFTER_SIGN_UP = "/auth/redirect";

/** "+91 98765 43210" from the ten digits. */
function prettyPhone(ten: string): string {
  return ten.length === 10 ? `+91 ${ten.slice(0, 5)} ${ten.slice(5)}` : `+91 ${ten}`;
}

export function OwnerRegisterForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("choose");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [ten, setTen] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  function go(next: Step) {
    setError(null);
    setStep(next);
  }

  function handleGoogleSignUp() {
    // Owner-registration intent, in its OWN cookie that only this page writes.
    // It deliberately does NOT ride in `next`: that value comes from a ?next=
    // query param on the login page, so a crafted link could otherwise promote
    // any customer who signed in. Still only actionable AFTER a verified code
    // exchange in the callback.
    rememberOwnerIntent();
    rememberAuthNext(AFTER_SIGN_UP);
    getSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: buildAuthCallbackUrl() },
    });
  }

  function sendCode(resend = false) {
    setError(null);
    startTransition(async () => {
      const r = await startPhoneSignIn(`+91${ten}`, resend);
      if ("error" in r) { setError(r.error); return; }
      setCooldown(r.cooldownSeconds);
      // MSG91's retry re-delivers the SAME code, so only a fresh send clears
      // the boxes (as on /login).
      if (!resend) setDigits(Array(OTP_LENGTH).fill(""));
      setStep("code");
    });
  }

  function submitCode(code: string) {
    setError(null);
    startTransition(async () => {
      // "owner": upgrade this account once the code is approved (see header).
      const r = await verifyPhoneSignIn(`+91${ten}`, code, "owner");
      if ("error" in r) {
        setError(r.error);
        setDigits(Array(OTP_LENGTH).fill(""));
        return;
      }
      // The session cookie is already written by the server action; refresh()
      // makes server components re-read it before the role router runs.
      router.refresh();
      router.push(AFTER_SIGN_UP);
    });
  }

  const canSend = /^[6-9]\d{9}$/.test(ten);

  return (
    <div id="register" className="scroll-mt-6">
      <div className="w-full">
        <div className="rounded-2xl bg-white p-8 shadow-card space-y-5">
          <div className="rounded-xl border-2 border-maroon-200 bg-maroon-50 p-4">
            <div className="flex items-start gap-3">
              <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-maroon-600" />
              <div className="text-sm text-charcoal-700">
                <p className="font-medium text-maroon-800">Owner Account</p>
                <p className="mt-1 text-muted-foreground">
                  Your owner account is ready as soon as you register. Each hall you add is reviewed by our team before it goes live.
                  Once approved, you can list halls and manage bookings.
                </p>
              </div>
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-xl bg-maroon-50 px-4 py-3 text-sm font-medium text-maroon-800">{error}</p>
          )}

          {step === "choose" && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleGoogleSignUp}
                className="flex min-h-[52px] w-full items-center justify-center gap-3 rounded-xl bg-charcoal-900 px-4 text-sm font-semibold text-white transition hover:bg-charcoal-800 active:scale-[0.99] motion-reduce:active:scale-100"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
                  <GoogleIcon />
                </span>
                Continue with Google
              </button>
              <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-widest text-charcoal-500" aria-hidden>
                <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
              </div>
              <button
                type="button"
                onClick={() => go("mobile")}
                className="flex min-h-[52px] w-full items-center justify-center gap-3 rounded-xl border border-gold-300 bg-white px-4 text-sm font-semibold text-charcoal-900 transition hover:border-maroon-300 hover:bg-ivory-50"
              >
                <Smartphone className="h-5 w-5 text-maroon-600" aria-hidden />
                Continue with mobile
              </button>
            </div>
          )}

          {step === "mobile" && (
            <div className="space-y-4">
              <button type="button" onClick={() => go("choose")} className="text-sm font-semibold text-maroon-700 hover:underline">
                ← Back
              </button>
              <div>
                <Label htmlFor="owner-mobile">Mobile number</Label>
                <div className="mt-1.5 flex gap-2">
                  <span className="inline-flex min-h-[50px] shrink-0 items-center rounded-xl border border-border bg-ivory-50 px-3 text-sm font-semibold text-charcoal-600">
                    +91
                  </span>
                  <div className="relative flex-1">
                    <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal-400" aria-hidden />
                    <Input
                      id="owner-mobile"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      autoFocus
                      placeholder="98765 43210"
                      className="min-h-[50px] pl-9 text-base tracking-wide"
                      value={ten}
                      onChange={(e) => setTen(e.target.value.replace(/\D/g, "").slice(0, 10))}
                      onKeyDown={(e) => { if (e.key === "Enter" && canSend) sendCode(false); }}
                      aria-describedby="owner-mobile-hint"
                    />
                  </div>
                </div>
                <p id="owner-mobile-hint" className="mt-2 text-xs text-charcoal-500">
                  We send a one-time code to this number. Indian mobile numbers only; standard SMS rates may apply.
                </p>
              </div>
              <Button className="w-full" onClick={() => sendCode(false)} disabled={!canSend || pending} isLoading={pending}>
                {pending ? "Sending…" : "Send code"}
              </Button>
            </div>
          )}

          {step === "code" && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => { setDigits(Array(OTP_LENGTH).fill("")); go("mobile"); }}
                className="text-sm font-semibold text-maroon-700 hover:underline"
              >
                ← Change number
              </button>
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

          <p className="text-center text-xs text-muted-foreground">
            By registering you agree to our{" "}
            <Link href="/terms" className="underline hover:text-foreground">Terms</Link>
            {" "}and{" "}
            <Link href="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>
          </p>
        </div>

        <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">
          <p>
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-maroon-600 hover:underline">Sign in</Link>
          </p>
          <p>
            Just looking for a venue?{" "}
            <Link href="/login" className="font-semibold text-maroon-600 hover:underline">Sign in to browse</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
