"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Registering as a venue owner.
//
// GOOGLE ONLY, and deliberately. The email-and-password form that used to sit
// under it was removed with the rest of password auth: no account in this
// product has ever had a password set, the form implied a reset flow that does
// not exist, and its confirmation email depended on a transport the project
// does not have — so its success state told people to "check your email" for a
// message that would not arrive.
//
// WHY NOT MOBILE HERE, when /login offers it. Owner intent travels in a cookie
// that only this page writes, and it is read and acted on in /auth/callback —
// the OAuth code-exchange path. Signing up by mobile does not pass through the
// callback, so it would create a CUSTOMER and silently drop the intent,
// stranding somebody who came here specifically to list a venue. Making mobile
// work for owners means teaching the phone flow about that cookie, which is a
// change to an auth path and belongs in its own piece of work rather than
// riding along with a deletion.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { Building2 } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { buildAuthCallbackUrl, rememberAuthNext, rememberOwnerIntent } from "@/lib/app-url";
import { GoogleIcon } from "@/components/icons/GoogleIcon";

export function OwnerRegisterForm() {
  function handleGoogleSignUp() {
    // Owner-registration intent, in its OWN cookie that only this page writes.
    // It deliberately does NOT ride in `next`: that value comes from a ?next=
    // query param on the login page, so a crafted link could otherwise promote
    // any customer who signed in. Still only actionable AFTER a verified code
    // exchange in the callback.
    rememberOwnerIntent();
    rememberAuthNext("/auth/redirect");
    getSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: buildAuthCallbackUrl() },
    });
  }

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
