"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Phone-verification server actions (Twilio Verify).
//
// SECURITY
//   • Session-derived identity only — the phone is verified FOR the logged-in
//     user; no user id is ever accepted from the client.
//   • Twilio credentials never leave the server (lib/twilio is server-only).
//   • OTP values are never stored or logged here; Twilio owns the code.
//   • Rate limiting: per-user+phone resend cooldown and hourly cap, plus a cap
//     on failed checks per verification. In-memory per server instance — on
//     serverless this resets per instance, which is acceptable for a scaffold
//     because Twilio Verify enforces its own service-side rate limits on top.
//   • Verification alone NEVER changes roles — it only marks the phone
//     verified on the caller's own profile row.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  isTwilioConfigured,
  normalizePhoneE164,
  sendVerificationOtp,
  checkVerificationOtp,
} from "@/lib/twilio";

const RESEND_COOLDOWN_MS = 60_000;       // one send per phone per minute
const MAX_SENDS_PER_HOUR = 5;
const MAX_CHECK_ATTEMPTS = 5;            // per verification window

type Bucket = { lastSentAt: number; sends: number[]; failedChecks: number };
const buckets = new Map<string, Bucket>();

function bucketFor(key: string): Bucket {
  let b = buckets.get(key);
  if (!b) { b = { lastSentAt: 0, sends: [], failedChecks: 0 }; buckets.set(key, b); }
  return b;
}

export type OtpActionResult =
  | { success: true; cooldownSeconds?: number }
  | { error: string };

export async function sendPhoneOtp(rawPhone: string): Promise<OtpActionResult> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in to verify your phone." };

  if (!isTwilioConfigured()) {
    return { error: "Phone verification is not configured yet. Please try again later." };
  }

  const phone = normalizePhoneE164(rawPhone);
  if (!phone) return { error: "Enter a valid mobile number." };

  const b = bucketFor(`${user.id}:${phone}`);
  const now = Date.now();

  const sinceLast = now - b.lastSentAt;
  if (sinceLast < RESEND_COOLDOWN_MS) {
    return { error: `Please wait ${Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000)}s before requesting another code.` };
  }
  b.sends = b.sends.filter((t) => now - t < 3_600_000);
  if (b.sends.length >= MAX_SENDS_PER_HOUR) {
    return { error: "Too many codes requested. Please try again in an hour." };
  }

  const result = await sendVerificationOtp(phone);
  if (!result.ok) {
    switch (result.error) {
      case "invalid_phone":  return { error: "This number can't receive verification codes." };
      case "rate_limited":   return { error: "Too many attempts. Please try again shortly." };
      case "not_configured": return { error: "Phone verification is not configured yet." };
      default:               return { error: "Could not send the code. Please try again." };
    }
  }

  b.lastSentAt = now;
  b.sends.push(now);
  b.failedChecks = 0;
  return { success: true, cooldownSeconds: RESEND_COOLDOWN_MS / 1000 };
}

export async function verifyPhoneOtp(
  rawPhone: string,
  code: string,
): Promise<OtpActionResult> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in to verify your phone." };

  if (!isTwilioConfigured()) {
    return { error: "Phone verification is not configured yet. Please try again later." };
  }

  const phone = normalizePhoneE164(rawPhone);
  if (!phone) return { error: "Enter a valid mobile number." };

  const clean = (code ?? "").replace(/\D/g, "");
  if (!/^\d{4,8}$/.test(clean)) return { error: "Enter the code you received." };

  const b = bucketFor(`${user.id}:${phone}`);
  if (b.failedChecks >= MAX_CHECK_ATTEMPTS) {
    return { error: "Too many incorrect attempts. Request a new code." };
  }

  const result = await checkVerificationOtp(phone, clean);
  if (!result.ok) {
    return { error: "Could not verify the code. Please try again." };
  }
  if (!result.approved) {
    b.failedChecks += 1;
    return { error: "That code is incorrect or has expired." };
  }

  // Success — record verification on the caller's OWN profile row.
  // (profiles_update RLS restricts to auth.uid(); the role column stays locked
  // by the prevent_role_change trigger. 42703 = columns pre-migration-0023;
  // retry without them so the flow degrades instead of crashing.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let { error: upErr } = await db
    .from("profiles")
    .update({ phone, phone_verified: true, phone_verified_at: new Date().toISOString() })
    .eq("id", user.id);

  if (upErr?.code === "42703") {
    ({ error: upErr } = await db.from("profiles").update({ phone }).eq("id", user.id));
  }
  if (upErr) {
    console.error("[verify-phone] profile update failed:", upErr.message);
    return { error: "Verified, but we could not save it. Please try again." };
  }

  buckets.delete(`${user.id}:${phone}`);
  revalidatePath("/verify-phone");
  revalidatePath("/customer/profile");
  revalidatePath("/owner/profile");
  return { success: true };
}
