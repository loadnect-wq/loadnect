// ─────────────────────────────────────────────────────────────────────────────
// lib/twilio/index.ts — the Twilio surface, re-exported.
//
// This was a single lib/twilio.ts until WhatsApp arrived. It is now a folder so
// each concern stands alone, and this barrel keeps every existing
// `from "@/lib/twilio"` import working unchanged:
//
//   verify.ts     — Verify OTP (phone ownership check)
//   whatsapp.ts   — the WhatsApp transport: the ONLY way this app messages people
//   signature.ts  — X-Twilio-Signature verification for inbound webhooks
//
// THERE IS NO SMS. The former sendSms()/isTwilioSmsEnabled()/getTwilioSmsStatus()
// were deleted rather than deprecated, so nothing can accidentally reach for a
// channel this platform no longer sends on — a stale import is now a build
// error instead of a silent SMS charge.
// ─────────────────────────────────────────────────────────────────────────────

export {
  isTwilioConfigured,
  verifyChannel,
  sendVerificationOtp,
  checkVerificationOtp,
  type TwilioResult,
  type TwilioCheckResult,
} from "./verify";

export {
  toWhatsAppAddress,
  isWhatsAppEnabled,
  isWhatsAppConfigured,
  isWhatsAppTestMode,
  getWhatsAppStatus,
  sendWhatsAppTemplate,
  isPermanentWhatsAppError,
  parseDeliveryStatus,
  isFailedDelivery,
  type WhatsAppErrorKind,
  type WhatsAppSendResult,
  type WhatsAppDeliveryStatus,
  type SendTemplateInput,
} from "./whatsapp";

export {
  verifyTwilioWebhookSignature,
  twilioCandidateOrigins,
  type TwilioSignatureResult,
} from "./signature";

// normalizePhoneE164 lives in lib/notifications/phone.ts (pure, client-safe);
// re-exported here so server code that reaches for it via the Twilio module
// keeps working.
export { normalizePhoneE164 } from "@/lib/notifications/phone";
