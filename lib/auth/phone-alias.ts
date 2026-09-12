// ─────────────────────────────────────────────────────────────────────────────
// lib/auth/phone-alias.ts — the placeholder address a mobile-only account needs.
// SERVER-ONLY.
//
// WHY AN ACCOUNT WITH NO EMAIL NEEDS AN EMAIL ANYWAY. Supabase has no
// server-side session-issuing API, so lib/auth/session-mint.ts mints through
// admin.generateLink({type:'magiclink'}) — and generateLink takes an EMAIL.
// GenerateLinkType is 'signup' | 'invite' | 'magiclink' | 'recovery' |
// 'email_change_current' | 'email_change_new'; there is no phone variant. So an
// auth.users row with a null email can never be signed in again by any means we
// control. A mobile-only account therefore needs SOMETHING in auth.users.email,
// and that something must never be mistaken for a way to reach the person.
//
// ── RANDOM, NOT DERIVED FROM THE NUMBER ─────────────────────────────────────
// The obvious alias is 919876543210@…, and it is wrong. auth.users.email is
// visible in the Supabase dashboard, in admin tooling and in any export, so a
// phone-derived alias turns every one of those into a list of customers' mobile
// numbers. A random identifier reveals nothing: the link from account to number
// lives in profiles.phone, behind RLS, where it already was.
//
// ── NO MAIL CAN EVER BE SENT TO IT ──────────────────────────────────────────
// Nothing in this codebase sends to auth.users.email: notifications route on
// profiles.email and profiles.phone, and the mint deliberately never delivers
// the link it generates. The domain is still a real domain we control, and the
// correct hardening is an RFC 7505 null MX record on it —
//     phone.hallnect.com.  IN  MX  0  "."
// — which makes "no mail is accepted here" a published fact rather than a
// property of our own restraint. That is a DNS change; see the launch notes.
//
// ── profiles.email STAYS NULL ───────────────────────────────────────────────
// The alias lives in auth.users and nowhere else. handle_new_user copies
// new.email into profiles, so the caller clears it immediately afterwards. That
// keeps `profiles.email IS NULL` meaning exactly "this person has not given us
// an email", which is what the profile screen, the notification router and the
// add-your-email prompt all rely on. An alias leaking into profiles.email would
// make every one of them believe an unreachable address was reachable.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { randomUUID } from "node:crypto";

/**
 * The domain placeholder addresses live under.
 *
 * Defaults rather than throwing: a mobile-only signup must not fail because an
 * env var nobody set is missing, and the value is not a secret — it is a
 * domain name. Override with PHONE_ALIAS_DOMAIN if the DNS lives elsewhere.
 */
export function phoneAliasDomain(): string {
  const configured = (process.env.PHONE_ALIAS_DOMAIN ?? "").trim().toLowerCase();
  return configured || "phone.hallnect.com";
}

/**
 * A fresh placeholder address for a new mobile-only account.
 *
 * Random per account, never per number: signing up, deleting and signing up
 * again yields a different alias, and two accounts can never collide on
 * auth.users.email's unique constraint by holding the same phone.
 */
export function newPhoneAlias(): string {
  return `u${randomUUID().replace(/-/g, "")}@${phoneAliasDomain()}`;
}

/**
 * True when an address is one of ours rather than something a person typed.
 *
 * Used to make sure a placeholder is never displayed, never emailed and never
 * treated as a contact detail. Compared on the domain alone, so an alias minted
 * under a previously configured domain is still recognised after the domain
 * changes — the alternative is old accounts silently presenting their
 * placeholder as a real address.
 */
export function isPhoneAlias(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  // Any subdomain shaped like a phone-alias domain, not only the current one.
  return domain === phoneAliasDomain() || domain.startsWith("phone.");
}
