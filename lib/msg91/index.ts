// ─────────────────────────────────────────────────────────────────────────────
// lib/msg91/index.ts — the MSG91 surface, re-exported.
//
//   config.ts — credentials, sender header, switches, admin status
//   client.ts — the one HTTP path; turns MSG91's HTTP-200-on-failure into
//               ok:false so no caller can read a wrong OTP as a success
//   otp.ts    — phone-ownership OTP (MSG91 generates, stores and checks it)
//   sms.ts    — transactional SMS over the Flow API
//
// MSG91 is the ONLY messaging provider. There is no second transport and no
// fallback: a message either goes over MSG91 or it is recorded as not sent,
// with the reason. A stale import of a removed provider is a build error
// rather than a silent second channel.
// ─────────────────────────────────────────────────────────────────────────────

export {
  MSG91_API_BASE,
  MSG91_TIMEOUT_MS,
  msg91AuthKey,
  msg91SenderId,
  hasMalformedSenderId,
  msg91OtpTemplateId,
  hasMalformedOtpTemplateId,
  isSmsEnabled,
  isMsg91Configured,
  isOtpConfigured,
  isSmsTestMode,
  smsTestRecipient,
  msg91WebhookSecret,
  getMsg91Status,
  type Msg91Status,
} from "./config";

export {
  msg91Request,
  toMsg91Mobile,
  isTransientMsg91Error,
  isPermanentMsg91Error,
  type Msg91ErrorKind,
  type Msg91Response,
} from "./client";

export {
  sendVerificationOtp,
  resendVerificationOtp,
  checkVerificationOtp,
  type OtpSendResult,
  type OtpCheckResult,
  type OtpFailure,
} from "./otp";

export {
  sendTemplatedSms,
  type SendSmsInput,
  type SendSmsResult,
} from "./sms";

// normalizePhoneE164 lives in lib/notifications/phone.ts (pure, client-safe);
// re-exported here so server code that reaches for it via the messaging module
// keeps working.
export { normalizePhoneE164 } from "@/lib/notifications/phone";
