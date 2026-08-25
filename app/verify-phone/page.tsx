import type { Metadata } from "next";
import { noindexMetadata } from "@/lib/seo/metadata";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getProfile } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isTwilioConfigured } from "@/lib/twilio";
import { AppHeader } from "@/components/app/AppHeader";
import { OtpForm } from "./_components/OtpForm";

// SEO: private/transactional page — must never be indexed.
export const metadata: Metadata = noindexMetadata("Verify Phone");

// Any signed-in role may verify their phone; verification never changes roles.
export default async function VerifyPhonePage() {
  const profile = await getProfile();
  if (!profile) redirect("/login?next=/verify-phone");

  // Read current phone-verification state (columns exist after migration 0023;
  // degrade gracefully before it).
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let phone: string | null = null;
  let verified = false;
  const { data, error } = await db
    .from("profiles")
    .select("phone, phone_verified")
    .eq("id", profile.id)
    .maybeSingle();
  if (!error && data) {
    phone = data.phone ?? null;
    verified = Boolean(data.phone_verified);
  } else if (error?.code === "42703") {
    const { data: fallback } = await db
      .from("profiles").select("phone").eq("id", profile.id).maybeSingle();
    phone = fallback?.phone ?? null;
  }

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Verify Phone" />

      <div className="mx-auto max-w-md px-4 py-6 space-y-4">
        <div className="text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-maroon-50 text-maroon-600">
            <ShieldCheck className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="mt-3 font-serif text-2xl font-bold text-charcoal-900">
            Verify your phone
          </h1>
          <p className="mt-1 text-sm text-charcoal-600">
            A verified number helps venue owners and our team reach you about your bookings.
          </p>
        </div>

        {verified && phone ? (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-center text-sm text-green-800">
            <p className="font-semibold">Already verified</p>
            <p className="mt-1">{phone} is linked to your account.</p>
          </div>
        ) : (
          <OtpForm initialPhone={phone} configured={isTwilioConfigured()} />
        )}
      </div>
    </div>
  );
}
