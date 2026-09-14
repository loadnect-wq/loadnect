import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getDashboardPath } from "@/lib/constants";
import { isOtpConfigured } from "@/lib/msg91";

// ─────────────────────────────────────────────────────────────────────────────
// Where a freshly signed-in person lands.
//
// ONE DETOUR ON THE WAY: somebody who has just come back from Google has an
// account but no mobile number, and a mobile number is the thing Hallnect
// actually needs. Booking updates, enquiry alerts and the venue's reply all
// travel by SMS, and a venue owner cannot see a single lead until their number
// is verified. Asking at the moment they arrive — once, skippable — is the only
// point where it is not an interruption of something else they were doing.
//
// It is a DETOUR, not a gate. "Skip for now" goes straight to the dashboard and
// nothing is withheld. A verification wall on first sign-in would cost more
// customers than the missing numbers ever will.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const { data: profile } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Supabase client: this project has no generated Database types, so table names and embedded row shapes are `any` by construction
    .from("profiles" as any)
    .select("role, phone_verified")
    .eq("id", user.id)
    .single();

  const row = profile as { role: string; phone_verified: boolean | null } | null;
  const role = row?.role ?? "customer";
  const home = getDashboardPath(role);

  // Admins are left alone: they arrive to do something specific, they are not
  // a notification recipient in the way a customer or an owner is, and there is
  // exactly one of them. Asking would be noise.
  //
  // Hidden entirely when MSG91 is unconfigured — the page would only be able to
  // say "not available yet", and sending somebody to a dead end on their very
  // first visit is worse than not asking.
  const askForMobile =
    role !== "admin" && !row?.phone_verified && isOtpConfigured();

  if (askForMobile) {
    // `next` is built HERE from the role, never taken from the request, so this
    // redirect cannot be pointed anywhere by a crafted link.
    return NextResponse.redirect(
      `${origin}/verify-phone?next=${encodeURIComponent(home)}&welcome=1`,
    );
  }

  return NextResponse.redirect(`${origin}${home}`);
}
