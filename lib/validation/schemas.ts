// Centralized Zod schemas for Hallnect form & server-action validation.
//
// PURE module — safe to import from client AND server (server actions, route
// handlers, page components). Use this same schema in both places so the rules
// stay in sync. Server-side validation is the security boundary; client-side
// is only for UX. Never trust client output.
//
// Patterns:
//   • All `string` fields go through .trim() first.
//   • Numeric fields parse from string OR number, then enforce range/non-negative.
//   • Text fields enforce max length and run through sanitizeText() to strip
//     control chars and HTML angle brackets (defense-in-depth — React escapes
//     at render, but DB / logs / emails should never carry raw <script>).
//   • Errors return a stable shape via parseSafe() so server actions can map
//     them to ActionResult.

import { z } from "zod";

// ── Primitives ────────────────────────────────────────────────────────────────

/**
 * Strip HTML angle brackets + ASCII control characters (defense in depth).
 * React escapes at render; this guards DB rows, logs, and downstream consumers
 * (email templates, exports) where escaping isn't automatic.
 */
// phone.ts is deliberately pure — no "server-only", no env — so importing it
// here keeps this module client-safe.
import { normalizePhoneE164 } from "@/lib/notifications/phone";

export function sanitizeText(input: unknown, maxLen = 4000): string {
  if (typeof input !== "string") return "";
  return input.replace(/[<>\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLen);
}

const trimmed = (max: number) =>
  z.string().transform((s) => sanitizeText(s, max));

/**
 * Same guarantees as sanitizeText, except that PARAGRAPHS SURVIVE.
 *
 * sanitizeText strips \u0000-\u001f, and that range contains \n (0x0A) and
 * \r (0x0D) — so an owner who wrote a description in paragraphs had it silently
 * flattened into a single block at save time, before it ever reached the
 * database. This is used only for the long free-text fields: a name or a city
 * has no business carrying a line break, and the single-line inputs that
 * collect them cannot produce one anyway.
 *
 * Everything else in the control range still goes, \r\n is normalised to \n,
 * and three or more consecutive newlines collapse to one blank line so a
 * description cannot be padded into pushing the rest of the page off screen.
 */
export function sanitizeMultiline(input: unknown, maxLen = 4000): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[<>\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLen);
}

const optionalTrimmed = (max: number) =>
  z.string().optional().transform((s) => (s ? sanitizeText(s, max) : ""));

/** For long free text where the writer's own line breaks are part of the content. */
const optionalMultiline = (max: number) =>
  z.string().optional().transform((s) => (s ? sanitizeMultiline(s, max) : ""));

// Phone numbers: accept Indian (10-digit) and international (E.164-ish) formats.
// We require 7–15 digits after stripping non-digits. Optional leading +.
export const phoneSchema = z
  .string()
  .trim()
  .refine(
    (v) => {
      if (!v) return true; // optional
      const digits = v.replace(/[^\d]/g, "");
      return digits.length >= 7 && digits.length <= 15;
    },
    { message: "Enter a valid phone number (7–15 digits)." },
  );

export const requiredPhoneSchema = z
  .string()
  .trim()
  .min(1, "Phone is required.")
  .refine(
    (v) => {
      const digits = v.replace(/[^\d]/g, "");
      return digits.length >= 7 && digits.length <= 15;
    },
    { message: "Enter a valid phone number (7–15 digits)." },
  );

// Email — z.string().email() in zod v3, z.email() in v4. Use both layers for
// forward compatibility.
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required.")
  .max(254, "Email is too long.")
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address.");

// Passwords — Supabase enforces its own minimum, but we set a sensible floor.
// Don't enforce excessive complexity rules: NIST guidance prefers length over
// character-class rules.
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password is too long.");

// UUID — accept the standard 36-char form. Used as DB primary key.
export const uuidSchema = z.string().uuid("Invalid id.");

// YYYY-MM-DD date string.
export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date.");

// Indian pincode — 6 digits, optional (some venues may not have one yet).
export const pincodeSchema = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || /^[1-9]\d{5}$/.test(v), {
    message: "Pincode must be 6 digits.",
  });

// Money — accepts number or numeric string, must be non-negative.
/**
 * The least a venue may be listed for, in rupees.
 *
 * moneySchema accepted any n >= 0, so nothing stopped a ₹40 listing — and the
 * platform fee is flat. Capping the fee against the advance (0.25 × advance,
 * see lib/booking-payment.ts) stopped the CUSTOMER being overcharged on a
 * listing like that, but it left the other end open: at ₹40 the capped fee is
 * ₹2.50, which does not cover the payment gateway's own per-transaction cost,
 * so every such booking loses money.
 *
 * ₹2,000 is set where the flat fee is still a sane fraction of the booking
 * (₹200 on a ₹500 advance) rather than where it merely stops being absurd. It
 * is also a floor on what a real wedding venue plausibly charges for a day —
 * the listings below it in practice are tests, typos and placeholders.
 *
 * Existing rows are NOT retro-validated: this bites on create and on edit, so a
 * hall already in the catalogue keeps its price until someone touches it. That
 * is deliberate — silently rejecting an owner's next unrelated edit because of
 * a rule introduced afterwards is a worse failure than a grandfathered price.
 */
export const MIN_HALL_PRICE_RUPEES = 2_000;

export const moneySchema = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : parseFloat(v)))
  .refine((n) => Number.isFinite(n), "Enter a valid amount.")
  .refine((n) => n >= 0, "Amount cannot be negative.");

export const optionalMoneySchema = z
  .union([z.number(), z.string(), z.literal(""), z.null(), z.undefined()])
  .transform((v) => {
    if (v == null || v === "") return null;
    return typeof v === "number" ? v : parseFloat(v);
  })
  .refine((n) => n == null || Number.isFinite(n), "Enter a valid amount.")
  .refine((n) => n == null || n >= 0, "Amount cannot be negative.");

// Capacity — positive integer, capped to a realistic upper bound.
export const capacitySchema = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : parseInt(v, 10)))
  .refine((n) => Number.isInteger(n), "Capacity must be a whole number.")
  .refine((n) => n >= 1, "Capacity must be at least 1.")
  .refine((n) => n <= 100_000, "Capacity is unrealistically large.");

export const optionalCapacitySchema = z
  .union([z.number(), z.string(), z.literal(""), z.null(), z.undefined()])
  .transform((v) => {
    if (v == null || v === "") return null;
    return typeof v === "number" ? v : parseInt(v, 10);
  })
  .refine((n) => n == null || Number.isInteger(n), "Must be a whole number.")
  .refine((n) => n == null || n >= 1, "Must be at least 1.");

// ── Auth ─────────────────────────────────────────────────────────────────────

export const signupSchema = z.object({
  name:     trimmed(120).pipe(z.string().min(2, "Enter your full name.")),
  email:    emailSchema,
  password: passwordSchema,
});
export type SignupInput = z.input<typeof signupSchema>;

export const loginSchema = z.object({
  email:    emailSchema,
  password: z.string().min(1, "Password is required."),
});
export type LoginInput = z.input<typeof loginSchema>;

export const ownerRegisterSchema = signupSchema; // same shape — role differs server-side

// ── Owner business profile ───────────────────────────────────────────────────

// Business identity only. The four payout fields (bank account, IFSC, PAN and
// the business phone Cashfree verifies) moved to payoutDetailsSchema below —
// they are required there, and were optional here, which is how an owner could
// save a business profile that could never be paid.
export const ownerBusinessSchema = z.object({
  businessName:  trimmed(160).pipe(z.string().min(2, "Business name is required.")),
  businessEmail: z.string().trim().optional()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email."),
  gstNumber:     optionalTrimmed(20),
  address:       optionalTrimmed(500),
  city:          optionalTrimmed(80),
  state:         optionalTrimmed(80),
});
export type OwnerBusinessInput = z.input<typeof ownerBusinessSchema>;

// ── Owner payout details ─────────────────────────────────────────────────────
//
// The four fields Cashfree actually needs to pay a venue owner, in one place.
//
// They used to live inside ownerBusinessSchema as OPTIONAL fields on the
// Business Details form — below the Connect button, behind a different submit,
// mixed in with GST and address. An owner had to save one form, scroll back up
// and press a button in another. Here they are required, because a payout
// account with three of the four is not a payout account.
//
// Same rules as the business schema enforced, and the same reasoning: validated
// BEFORE sanitising, since sanitizeText() truncates and would turn an over-long
// value into a different, still-valid one. For fields that identify a person
// and route money, a wrong-but-valid value is worse than a rejection.
export const payoutDetailsSchema = z.object({
  // THE NAME ON THE BANK ACCOUNT, and it is not cosmetic. Cashfree accepts
  // "alphabets and whitespaces only" for beneficiary_name, so a business name
  // carrying "&", "." or "Pvt. Ltd." is rejected outright — but worse,
  // BENE_NAME_DIFFERS is a documented REVERSED status code, so a name that
  // passes the charset filter and does not match the bank's record produces a
  // transfer that reports SUCCESS and unwinds a day later. Easy Split
  // substituted business_name and got away with it because it never sent money.
  accountHolder: z.string()
    .refine((v) => /^[A-Za-z][A-Za-z\s]{1,99}$/.test(v.trim()),
      "Enter the name exactly as it appears on the bank account — letters and spaces only.")
    .transform((s) => sanitizeText(s, 100)),
  accountNumber: z.string()
    .refine((v) => /^[0-9]{6,20}$/.test(v.trim()), "Account number must be 6-20 digits.")
    .transform((s) => sanitizeText(s, 20)),
  ifsc: z.string()
    .refine((v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.trim().toUpperCase()),
      "Enter a valid 11-character IFSC (e.g. HDFC0000001).")
    .transform((s) => sanitizeText(s, 11).toUpperCase()),
  pan: z.string()
    .refine((v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.trim().toUpperCase()),
      "Enter a valid PAN (e.g. ABCDE1234F).")
    .transform((s) => sanitizeText(s, 10).toUpperCase()),
  // Cashfree requires a 10-digit Indian mobile for vendor payouts.
  phone: z.string()
    .refine((v) => {
      const d = v.replace(/\D/g, "");
      return (d.length === 10 && /^[6-9]/.test(d))
          || (d.length === 12 && d.startsWith("91") && /^[6-9]/.test(d.slice(2)));
    }, "Enter a valid 10-digit Indian mobile number.")
    .transform((s) => sanitizeText(s, 20)),
});
export type PayoutDetailsInput = z.input<typeof payoutDetailsSchema>;

export const profileUpdateSchema = z.object({
  fullName: optionalTrimmed(120),
  phone:    phoneSchema.optional(),
});

// ── Hall create / edit ───────────────────────────────────────────────────────

// ── Booking mode ─────────────────────────────────────────────────────────────

/**
 * How a hall takes business.
 *
 *   DIRECT_BOOKING  — the original flow. The customer pays an advance through
 *                     Cashfree, Hallnect retains its commission out of it, and
 *                     the slot is held. Unchanged in every respect.
 *   LEAD_GENERATION — Hallnect introduces the customer and never touches their
 *                     money. The venue negotiates and settles directly; the
 *                     commission is billed to the venue afterwards.
 *
 * UPPERCASE because that is what the brief names, and because these values are
 * pinned by halls_booking_mode_allowed in migration 0073 — the CHECK and this
 * list have to agree exactly or a valid form produces a 500.
 */
export const BOOKING_MODES = ["DIRECT_BOOKING", "LEAD_GENERATION"] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

export function isBookingMode(v: unknown): v is BookingMode {
  return typeof v === "string" && (BOOKING_MODES as readonly string[]).includes(v);
}

/**
 * DEFAULTS TO DIRECT_BOOKING when absent, and that default is load-bearing in
 * two directions.
 *
 * Forward: a Next.js server action DROPS undefined properties, so a caller that
 * does not mention the mode sends a MISSING KEY. Every such caller predates
 * lead generation and means the original behaviour, so answering "Invalid
 * input" would break hall editing for a field the form never had.
 *
 * Backward: it means no existing test, script or call site has to be rewritten
 * to keep doing what it already did — which is the property that lets the whole
 * feature be additive.
 */
export const bookingModeSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v == null || v === "" ? "DIRECT_BOOKING" : String(v).trim()))
  .refine(isBookingMode, `Choose either ${BOOKING_MODES.join(" or ")}.`);

export const hallSchema = z
  .object({
    name:         trimmed(160).pipe(z.string().min(2, "Hall name is required.")),
    city:         trimmed(80).pipe(z.string().min(1, "City is required.")),
    state:        optionalTrimmed(80),
    address:      optionalTrimmed(500),
    pincode:      pincodeSchema,
    capacityMin:  optionalCapacitySchema,
    capacityMax:  capacitySchema,
    // .default() IS LOAD-BEARING, and its absence is a real regression I made
    // and caught here. bookingModeSchema already admits undefined into its
    // union and maps it to DIRECT_BOOKING — but a `.transform()` pipe is a
    // REQUIRED KEY in a Zod object unless the pipe itself opts out, so a
    // caller that omitted the field entirely was rejected before the transform
    // ever ran. Every call site written before lead generation omits it, which
    // is precisely the set that must keep working unchanged.
    //
    // .default() short-circuits on undefined and makes the key optional; the
    // union still handles an explicit null or "" arriving from a form.
    bookingMode:  bookingModeSchema.default("DIRECT_BOOKING"),
    // OPTIONAL AT THE TYPE LEVEL, REQUIRED BY THE REFINE BELOW FOR A DIRECT
    // BOOKING. A lead-generation venue may legitimately publish no price at all
    // ("Contact for pricing"), which is why the column lost its NOT NULL in
    // migration 0073 — but a hall the customer is going to PAY an advance on
    // must have a price, or there is nothing to compute the advance from.
    pricePerDay:  optionalMoneySchema,
    priceMorning: optionalMoneySchema,
    priceEvening: optionalMoneySchema,
    description:  optionalMultiline(4000),
    amenityIds:   z.array(uuidSchema).max(50, "Too many amenities."),
    // At least one is REQUIRED. The homepage and search offer these as
    // filters, so a hall with none declared is invisible in every typed view —
    // which is a worse outcome for the owner than being asked to tick a box.
    // The vocabulary is pinned by a CHECK constraint in migration 0037.
    venueTypes:   z.array(z.enum(["wedding", "reception", "party", "banquet"]))
      .min(1, "Choose at least one type of event your venue hosts.")
      .max(4),
  })
  .refine(
    (d) => d.capacityMin == null || d.capacityMin <= d.capacityMax,
    { message: "Min capacity cannot exceed max.", path: ["capacityMin"] },
  )
  // A DIRECT BOOKING HALL MUST HAVE A PRICE. This is the application-layer half
  // of halls_direct_booking_needs_price (migration 0073): checkout derives the
  // advance, the platform fee cap and the commission base from this number, and
  // a null would not fail loudly — advanceFromTotal would throw deep inside the
  // booking engine, on the customer's checkout page, long after the owner had
  // saved a listing they were told was fine.
  .refine(
    (d) => d.bookingMode !== "DIRECT_BOOKING" || d.pricePerDay != null,
    {
      message: "A direct-booking venue needs a price per day. Switch to Lead Generation to list without one.",
      path: ["pricePerDay"],
    },
  )
  // The floor applies to whatever price IS given, in either mode. A lead
  // venue may publish nothing, but it may not publish ₹40 — the reasoning
  // behind MIN_HALL_PRICE_RUPEES is about what a real venue plausibly charges,
  // and that does not change with the booking mode.
  .refine(
    (d) => d.pricePerDay == null || d.pricePerDay >= MIN_HALL_PRICE_RUPEES,
    {
      message: `A venue must be priced at least ₹${MIN_HALL_PRICE_RUPEES} per day.`,
      path: ["pricePerDay"],
    },
  )
  // A half-day cannot cost more than the whole day. Not pedantry: the booking
  // engine derives the advance from whichever price the chosen slot resolves
  // to, so an inverted pair quietly charges more for less and the customer sees
  // it only at checkout.
  //
  // The null guard on pricePerDay is not a formality. `x <= null` is FALSE in
  // JavaScript, so without it a lead venue that quoted a morning rate and no
  // full-day rate would be rejected with "the morning rate cannot exceed the
  // full-day rate" — a complaint about a field they deliberately left empty.
  .refine(
    (d) => d.priceMorning == null || d.pricePerDay == null || d.priceMorning <= d.pricePerDay,
    { message: "The morning rate cannot exceed the full-day rate.", path: ["priceMorning"] },
  )
  .refine(
    (d) => d.priceEvening == null || d.pricePerDay == null || d.priceEvening <= d.pricePerDay,
    { message: "The evening rate cannot exceed the full-day rate.", path: ["priceEvening"] },
  );

export type HallInput = z.input<typeof hallSchema>;

// ── Hallnect commission, chosen per hall by the owner ────────────────────────

/**
 * The only commission percentages a hall may carry.
 *
 * ONE declaration, exported, because this list has to agree in four places or
 * the feature breaks in a different way at each: the selector the owner sees,
 * this schema, the CHECK constraint in migration 0071, and the admin filter.
 * A value that passes here but fails the CHECK is a 500 on a form the owner
 * filled in correctly; one that passes the CHECK but is missing from the
 * selector is a rate nobody can choose.
 *
 * WHY A FIXED SET AND NOT A RANGE. The commission is charged on the FULL hall
 * price but retained out of the 25% advance, so rate and advance can cross —
 * see MAX_COMMISSION_SHARE_OF_ADVANCE below, which caps the commission at half
 * the advance. At the live 25% advance that ceiling is 12.5%, so every value
 * here clears it with room to spare. A free-text percentage would have to be
 * bounded against the advance at the point of entry by every owner
 * independently, which is a worse design than eight buttons.
 */
export const HALL_COMMISSION_RATES = [1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] as const;

export type HallCommissionRate = (typeof HALL_COMMISSION_RATES)[number];

/** True only for a value the database will also accept. */
export function isAllowedCommissionRate(n: unknown): n is HallCommissionRate {
  return typeof n === "number"
    && (HALL_COMMISSION_RATES as readonly number[]).includes(n);
}

const COMMISSION_CHOICES = HALL_COMMISSION_RATES.join("%, ").concat("%");

/**
 * A commission rate as submitted by the owner's form.
 *
 * Accepts a number or the string an HTML control actually sends, and then
 * admits ONLY the eight values — so "2.4999999", "2.5abc", 0, 6, -1, NaN, null
 * and "" are all rejected with the same message rather than being coerced to
 * something plausible. Membership is tested AFTER parseFloat, on the parsed
 * number, because that is the value that reaches the database.
 *
 * Deliberately NOT a z.coerce.number(): coerce turns "" into 0, and 0 is a
 * commission rate that would silently pay Hallnect nothing while looking like
 * a valid choice.
 */
export const commissionRateSchema = z
  // null and undefined are admitted into the union DELIBERATELY, so that a rate
  // which never arrives is answered with the message below rather than with
  // Zod's bare "Invalid input". This is the same trap couponCreateSchema
  // documents: a Next.js server action DROPS undefined properties, so a field
  // the owner left blank can reach the server as a MISSING KEY rather than as
  // an empty string. Both must fail, and both must say which values are valid —
  // an owner who has just been refused a listing needs to know what to pick.
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v == null) return NaN;
    if (typeof v === "number") return v;
    const s = String(v).trim();
    // NOT parseFloat. parseFloat("2.5%") is 2.5 and parseFloat("2.5abc") is
    // 2.5 — it stops at the first character it cannot use and returns what it
    // has, so a string pretending to be a rate would sail through the
    // membership test below. Only a clean decimal literal is accepted; anything
    // else becomes NaN, which is in no allowed set.
    return /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : NaN;
  })
  .refine(isAllowedCommissionRate, `Choose one of ${COMMISSION_CHOICES}.`);

// Owner-side input also has ownerId on create; edit doesn't need it.
//
// commissionRate lives HERE, on create only, and not on the shared hallSchema.
// Two reasons, and they point the same way: it is required when a hall is
// listed, and migration 0046's column-scoped UPDATE grant deliberately excludes
// money columns, so updateHall could not write it through the session client
// even if it were accepted. Changing the rate later is its own audited action.
export const hallCreateSchema = hallSchema.and(
  z.object({
    ownerId:        uuidSchema,
    commissionRate: commissionRateSchema,
  }),
);

// ── Custom amenities (owner-defined, scoped to one hall) ─────────────────────

/** Centralised limit — do not re-declare this number anywhere else. */
export const CUSTOM_AMENITY_LIMITS = {
  maxPerHall: 15,
  minLength:  2,
  maxLength:  60,
} as const;

/**
 * Normalises a custom amenity for storage AND for duplicate comparison.
 * Collapses internal whitespace and trims, so " bridal   room " and
 * "Bridal Room" compare equal (case handled separately by the caller).
 */
export function normalizeAmenityName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Custom amenity name. Rendered as PLAIN TEXT by React (never
 * dangerouslySetInnerHTML), so the real XSS defence is the renderer; this
 * rejects control characters and angle brackets as defence in depth so stored
 * values can't carry markup into any future non-React consumer (emails, PDFs).
 */
export const customAmenityNameSchema = z
  .string()
  .transform(normalizeAmenityName)
  .refine((v) => v.length >= CUSTOM_AMENITY_LIMITS.minLength, {
    message: `Amenity name must be at least ${CUSTOM_AMENITY_LIMITS.minLength} characters.`,
  })
  .refine((v) => v.length <= CUSTOM_AMENITY_LIMITS.maxLength, {
    message: `Amenity name must be ${CUSTOM_AMENITY_LIMITS.maxLength} characters or fewer.`,
  })
  // Reject angle brackets and any C0/C1 control character. Written as an
  // explicit code-point scan rather than a regex escape so the intent is
  // unambiguous and cannot be mangled by tooling.
  .refine((v) => ![...v].some((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return ch === "<" || ch === ">" || c < 0x20 || c === 0x7f;
  }), {
    message: "Amenity name contains invalid characters.",
  });

/** The whole custom-amenity list submitted with a hall. */
export const customAmenityListSchema = z
  .array(customAmenityNameSchema)
  .max(
    CUSTOM_AMENITY_LIMITS.maxPerHall,
    `You can add up to ${CUSTOM_AMENITY_LIMITS.maxPerHall} custom amenities.`,
  )
  .default([]);

// ── Image upload (client-side file check + server-side url metadata) ─────────

export const IMAGE_LIMITS = {
  maxBytes: 5 * 1024 * 1024, // 5 MB
  allowedTypes: ["image/jpeg", "image/png", "image/webp"] as const,
};

export function validateImageFile(file: File): { ok: true } | { ok: false; error: string } {
  if (!IMAGE_LIMITS.allowedTypes.includes(file.type as (typeof IMAGE_LIMITS.allowedTypes)[number])) {
    return { ok: false, error: "Only JPEG, PNG, and WebP images are allowed." };
  }
  if (file.size > IMAGE_LIMITS.maxBytes) {
    return { ok: false, error: "Image must be under 5 MB." };
  }
  if (file.size === 0) {
    return { ok: false, error: "Image file is empty." };
  }
  return { ok: true };
}

/** Longest alt text we store. 200 is what addHallImageSchema has always used. */
export const ALT_TEXT_MAX = 200;

// Server-side input check: the URL must be on https and not contain javascript:.
// The storage_path must look like {uuid}/{filename} so a malicious client
// can't write to an arbitrary path.
export const addHallImageSchema = z.object({
  hallId:      uuidSchema,
  url:         z.string().trim().min(1).max(2000)
    .refine((v) => /^https?:\/\//i.test(v), "Image URL must be http(s)."),
  storagePath: z.string().trim().min(1).max(500)
    .refine((v) => !v.includes(".."), "Invalid storage path.")
    .refine((v) => /^[a-zA-Z0-9_\-\/.]+$/.test(v), "Storage path has invalid characters."),
  isCover:     z.boolean(),
  altText:     optionalTrimmed(ALT_TEXT_MAX),
});

// REQUIRED, NOT optionalTrimmed — and that is the whole point of a separate
// schema. A server action DROPS undefined keys in transit, and optionalTrimmed
// turns a missing key into "", which THIS action would read as "clear the
// description the owner wrote". A required string makes a malformed call fail
// validation instead of silently wiping a value.
export const updateHallImageAltSchema = z.object({
  hallId:  uuidSchema,
  imageId: uuidSchema,
  altText: z
    .string()
    .max(ALT_TEXT_MAX, `Description must be ${ALT_TEXT_MAX} characters or fewer.`)
    .transform((s) => sanitizeText(s, ALT_TEXT_MAX)),
});

// ── Admin hall drafts (the admin-onboarding pathway, migration 0090) ────────
//
// MIRRORS THE DATABASE CHECKS DELIBERATELY. Every constraint on
// admin_hall_drafts is restated here so an admin gets a sentence instead of a
// Postgres error string — and every constraint on `halls` that the claim will
// eventually hit is among them, because the alternative is the OWNER
// discovering the admin's mistake weeks later when they press Claim.

export const VENUE_TYPE_VALUES = ["wedding", "reception", "party", "banquet"] as const;

export const adminHallDraftSchema = z
  .object({
    name:        trimmed(120),
    description: optionalMultiline(4000),
    city:        trimmed(80),
    state:       optionalTrimmed(80),
    // `area` and `district` live here: halls has no column for either, and a
    // field with nowhere to land on claim would lose what the admin typed.
    address:     optionalTrimmed(500),
    pincode:     optionalTrimmed(10),

    // The trailing .optional() on each of these is LOAD-BEARING, not tidiness.
    // optionalMoneySchema and optionalCapacitySchema are unions that already
    // include z.undefined() — but in zod 4 a MISSING KEY is not an undefined
    // value: it fails with "expected nonoptional". Server actions drop
    // undefined keys in transit, so without this every draft with a blank
    // price is rejected. Caught by lib/__tests__/admin-hall-drafts.test.ts.
    capacityMin: optionalCapacitySchema.optional(),
    capacityMax: capacitySchema,

    pricePerDay:  optionalMoneySchema.optional(),
    priceMorning: optionalMoneySchema.optional(),
    priceEvening: optionalMoneySchema.optional(),

    bookingMode: z.enum(["DIRECT_BOOKING", "LEAD_GENERATION"]),
    venueTypes:  z.array(z.enum(VENUE_TYPE_VALUES)).default([]),

    amenitySlugs:    z.array(z.string().trim().max(80)).max(50).default([]),
    customAmenities: z.array(z.string().trim().max(80)).max(20).default([]),
    photoUrls:       z.array(z.string().trim().url().max(2000)).max(10).default([]),

    ownerName:  trimmed(120),
    // Normalised to E.164 before it reaches the database, because the claim
    // matches it against profiles.phone with plain equality. A draft stored as
    // "93440 40013" would never match and the owner would never see their hall.
    ownerPhone: z
      .string()
      .transform((v) => normalizePhoneE164(v) ?? "")
      .refine((v) => /^\+[1-9][0-9]{7,14}$/.test(v), "Enter a valid mobile number."),
    ownerEmail: z
      .union([z.string().trim().email("Enter a valid email address."), z.literal("")])
      .optional()
      .transform((v) => (v ? v.toLowerCase() : "")),

    adminNotes: optionalTrimmed(2000),
  })
  .refine((d) => d.capacityMin == null || d.capacityMin <= d.capacityMax, {
    message: "Minimum capacity cannot exceed the maximum.",
    path: ["capacityMin"],
  })
  // halls_direct_booking_needs_price. Enforced here so the admin is told now.
  .refine((d) => d.bookingMode !== "DIRECT_BOOKING" || d.pricePerDay != null, {
    message: "A direct-booking venue needs a day rate. Use Lead generation if the price is not known yet.",
    path: ["pricePerDay"],
  });

export const claimHallDraftSchema = z.object({ draftId: uuidSchema });

// ── Photos on an admin-recorded hall (0094) ─────────────────────────────────
// The limits live in lib/hall-draft-photos.ts; restated as literals here only
// where zod needs a number at module load. hall-draft-photos.test.ts pins that
// they agree.

/** Step 1: ask the server for upload slots. It names every file, not the client. */
export const prepareHallDraftPhotosSchema = z.object({
  draftId: uuidSchema,
  files: z
    .array(
      z.object({
        key:  z.string().trim().min(1).max(64),
        type: z.enum(["image/jpeg", "image/png", "image/webp"]),
        // After in-browser resizing. Storage enforces the same 5 MB itself.
        size: z.number().int().min(1).max(5 * 1024 * 1024, "Each photo must be 5 MB or smaller after resizing."),
      }),
    )
    .min(1)
    .max(10, "A listing can have up to 10 photos."),
});

/** Step 2: the complete, ordered list to keep (first = cover). */
export const saveHallDraftPhotosSchema = z.object({
  draftId: uuidSchema,
  paths:   z.array(z.string().max(200)).max(10, "A listing can have up to 10 photos."),
  // Uploads the client knows it will not use (a failed or removed photo), so
  // their files are removed now rather than left for the sweep.
  discard: z.array(z.string().max(200)).max(40).default([]),
});

export const cancelHallDraftSchema = z.object({
  draftId: uuidSchema,
  // .min(1) AFTER the trim: trimmed() happily returns "", and a withdrawal
  // with no reason leaves no way to answer "why did the venue we recorded
  // never go live?".
  reason:  trimmed(500).refine((v) => v.length > 0, "Please say why this listing is being withdrawn."),
});

// ── Availability ─────────────────────────────────────────────────────────────

const ALLOWED_SLOTS = ["morning", "evening", "full_day"] as const;

// ALLOWED_AVAIL_STATUSES, OWNER_EDITABLE_AVAIL_STATUSES, availabilityEntrySchema
// and availabilityBatchSchema WERE HERE. They validated setAvailability, which
// is gone along with the hand-maintained availability grid.
//
// Owners no longer post availability rows at all — the calendar is DERIVED from
// bookings and offline bookings — and migration 0063 revokes
// INSERT/UPDATE/DELETE on `availability` from anon and authenticated outright.
// A schema guarding a request the database now refuses is worse than no schema:
// it implies the request is still a supported shape.

// ── Offline booking ──────────────────────────────────────────────────────────

/**
 * A booking the venue took off-platform.
 *
 * Every customer field is OPTIONAL by design. The point of the feature is that
 * the date stops being sellable; requiring a name and phone before an owner can
 * protect their own calendar would mean an owner who took a booking on a noisy
 * phone line either invents details or leaves the date open to a double
 * booking. The identifying fields improve the record; they do not gate it.
 *
 * The dates are NOT bounded to the future here. A venue reconciling last
 * month's diary is a real thing, and the database is what actually decides
 * whether the inventory is free — see assert_inventory_free. A UI-level "no
 * past dates" rule would only stop someone recording history they already have.
 */
export const offlineBookingSchema = z
  .object({
    hallId:        uuidSchema,
    eventDate:     dateStringSchema,
    endDate:       dateStringSchema,
    slot:          z.enum(ALLOWED_SLOTS),
    customerName:  optionalTrimmed(120),
    customerPhone: optionalTrimmed(20),
    notes:         optionalTrimmed(1000),
    reference:     optionalTrimmed(80),
    // Idempotency key, generated by the browser and reused across retries of
    // the SAME request. Without it a dropped connection leaves the owner with
    // either a duplicate booking or — more often — "those dates are not free",
    // raised by their own first attempt. Optional so a caller that has no
    // opinion still works; the RPC just loses the retry guarantee.
    clientToken:   uuidSchema.optional(),
  })
  .refine((d) => d.endDate >= d.eventDate, {
    message: "The end date cannot be before the start date.",
    path: ["endDate"],
  })
  // Mirrors the RPC's own ceiling. Checked here too so an owner gets a field
  // error rather than a database exception surfaced as a generic failure.
  .refine(
    (d) => (Date.parse(d.endDate) - Date.parse(d.eventDate)) / 86_400_000 <= 30,
    { message: "An offline booking cannot span more than 31 days.", path: ["endDate"] },
  );

export type OfflineBookingInput = z.input<typeof offlineBookingSchema>;

// ── Booking ──────────────────────────────────────────────────────────────────

/**
 * Booking input — enforces no past-date bookings. Uses the local YYYY-MM-DD
 * comparison so the rule matches what the user sees in their calendar.
 */
export const bookingSchema = z
  .object({
    hallId:        uuidSchema,
    eventDate:     dateStringSchema,
    slot:          z.enum(ALLOWED_SLOTS),
    guestCount:    z.union([z.number(), z.string()])
      .transform((v) => (typeof v === "number" ? v : parseInt(v, 10)))
      .refine((n) => Number.isInteger(n) && n >= 1, "Enter the number of guests.")
      .refine((n) => n <= 100_000, "Guest count is unrealistically large."),
    customerNotes: optionalTrimmed(2000),
  })
  .refine(
    (d) => {
      // Block past dates in IST. The DB stores event_date as a DATE so we
      // compare day-precision strings.
      const today = todayYmd();
      return d.eventDate >= today;
    },
    { message: "Event date cannot be in the past.", path: ["eventDate"] },
  );

function todayYmd(): string {
  // Use IST for booking dates. Hallnect users + venues are India-based; using
  // UTC would let a customer at 11pm IST think tomorrow is "today" in the
  // server's clock. ISO date components only — no time math.
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 - now.getTimezoneOffset()) * 60_000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type BookingInput = z.input<typeof bookingSchema>;

// ── Lead generation ──────────────────────────────────────────────────────────

/**
 * The kinds of event a lead can be about.
 *
 * Deliberately the SAME vocabulary as halls.venue_types (pinned by
 * halls_venue_types_allowed in 0037 and by leads.event_type in 0073). One list
 * means an owner who declared "wedding, reception" and a customer who picked
 * "party" are talking about the same four things, and the admin can filter
 * across both without a translation table.
 */
export const LEAD_EVENT_TYPES = ["wedding", "reception", "party", "banquet"] as const;
export type LeadEventType = (typeof LEAD_EVENT_TYPES)[number];

/**
 * What a customer submits to enquire about a lead-generation venue.
 *
 * NOTE WHAT IS ABSENT: any amount, any commission, any owner id, any lead
 * status. A lead carries no money at submission, and everything about who owns
 * the hall is resolved server-side from hallId. The customer supplies contact
 * details and event details, and nothing else.
 *
 * The phone here is the number the OTP will be sent to AND the number the venue
 * will ring. It is stored on the lead rather than read live from the profile,
 * so a later profile edit cannot redirect a call about an event already being
 * planned.
 */
export const leadEnquirySchema = z
  .object({
    hallId:      uuidSchema,
    contactName: trimmed(120).pipe(z.string().min(2, "Enter your name.")),
    // requiredPhoneSchema, not phoneSchema — the latter treats "" as valid
    // because it is used where a phone is genuinely optional. Here the number
    // IS the enquiry: it is what receives the OTP and what the venue rings.
    contactPhone: requiredPhoneSchema,
    eventDate:   dateStringSchema,
    // Optional, because a customer who is still deciding between a reception
    // and a full wedding should not be blocked from asking the price.
    eventType:   z
      .union([z.enum(LEAD_EVENT_TYPES), z.literal(""), z.null(), z.undefined()])
      .transform((v) => (v == null || v === "" ? null : v)),
    guestCount:  optionalCapacitySchema,
    requirements: optionalTrimmed(1000),
  })
  .refine((d) => d.eventDate >= todayYmd(), {
    message: "Event date cannot be in the past.",
    path: ["eventDate"],
  });

export type LeadEnquiryInput = z.input<typeof leadEnquirySchema>;

/**
 * The least a confirmed lead may be worth, in rupees.
 *
 * The agreed amount is the COMMISSION BASE and it is typed by the party who
 * pays the commission, so it is the one number in this feature with an obvious
 * incentive to be wrong. A floor does not stop under-reporting — nothing in the
 * software can, because Hallnect never sees the money — but it does stop the
 * degenerate case of confirming every lead at ₹1 and it makes a nonsense entry
 * visible rather than silently producing a ₹0.03 commission nobody chases.
 *
 * Set equal to MIN_HALL_PRICE_RUPEES: the smallest number a venue may be listed
 * at is also the smallest number a venue may claim to have been booked for.
 */
export const MIN_LEAD_AGREED_AMOUNT = MIN_HALL_PRICE_RUPEES;

/**
 * What the owner supplies when they tick Confirm.
 *
 * agreedAmount is REQUIRED and has no default. A lead-generation venue may have
 * published no price at all, so there is nothing to fall back to — and falling
 * back to the listed price where one exists would be worse than asking, because
 * it would quietly bill commission on a number nobody agreed to.
 */
export const leadConfirmSchema = z.object({
  agreedAmount: z
    // The same union shape as commissionRateSchema, and for the same reason: a
    // server action drops undefined, so a field the owner left blank arrives as
    // a MISSING KEY. Admitting null/undefined into the union is what turns
    // Zod's bare "Invalid input" into the sentence below.
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (v == null) return NaN;
      if (typeof v === "number") return v;
      // NOT parseFloat. parseFloat("50,000") is 50 and parseFloat("2000abc") is
      // 2000 — it stops at the first character it cannot use and returns what it
      // has, so "50,000" would be read as fifty rupees and rejected as below the
      // floor with a message about the floor, which tells the owner nothing
      // about the comma that caused it.
      const s = String(v).trim().replace(/\s/g, "");
      return /^\d+(?:\.\d{1,2})?$/.test(s) ? Number(s) : NaN;
    })
    .refine(
      (n) => Number.isFinite(n) && n >= MIN_LEAD_AGREED_AMOUNT,
      `Enter the amount agreed with the customer — at least ₹${MIN_LEAD_AGREED_AMOUNT}, digits only.`,
    ),
  ownerNotes: optionalTrimmed(1000),
});

export type LeadConfirmInput = z.input<typeof leadConfirmSchema>;

// ── Payment session ──────────────────────────────────────────────────────────

export const paymentSessionSchema = z.object({
  bookingId: uuidSchema,
  name:      optionalTrimmed(120),
  phone:     phoneSchema.optional(),
});

// ── Review ───────────────────────────────────────────────────────────────────

const ratingSchema = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : parseInt(String(v), 10)))
  .refine((n) => Number.isInteger(n) && n >= 1 && n <= 5, "Rating must be 1–5.");

const optionalRatingSchema = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .optional()
  .transform((v) => {
    if (v == null || v === "") return undefined;
    const n = typeof v === "number" ? v : parseInt(String(v), 10);
    return Number.isFinite(n) ? n : undefined;
  })
  .refine(
    (n) => n === undefined || (Number.isInteger(n) && n >= 1 && n <= 5),
    "Sub-rating must be 1–5.",
  );

export const reviewSchema = z.object({
  hallId:            uuidSchema,
  bookingId:         uuidSchema,
  rating:            ratingSchema,
  title:             optionalTrimmed(200),
  comment:           optionalTrimmed(4000),
  cleanlinessRating: optionalRatingSchema,
  valueRating:       optionalRatingSchema,
  locationRating:    optionalRatingSchema,
  serviceRating:     optionalRatingSchema,
});

export type ReviewInput = z.input<typeof reviewSchema>;

// ── Support ticket ───────────────────────────────────────────────────────────

export const ticketSchema = z.object({
  subject:  trimmed(200).pipe(z.string().min(3, "Subject is too short.")),
  message:  trimmed(4000).pipe(z.string().min(10, "Please describe the issue in at least 10 characters.")),
  category: optionalTrimmed(60),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
});

export type TicketInput = z.input<typeof ticketSchema>;

export const ticketResponseSchema = z.object({
  status:         z.enum(["open", "in_progress", "resolved", "closed"]),
  adminResponse:  optionalTrimmed(4000),
  internalNotes:  optionalTrimmed(4000),
});

// ── Admin actions ────────────────────────────────────────────────────────────

export const adminIdSchema = z.object({ id: uuidSchema });

export const premiumListingSchema = z.object({
  hallId:    uuidSchema,
  planSlug:  z.enum(["premium", "pro"]),
  startDate: dateStringSchema,
  endDate:   dateStringSchema,
  amount:    moneySchema,
  /**
   * 'paid' is a listing bought through Cashfree; 'complimentary' is one an
   * admin granted at no charge. Defaulted, so every existing caller — the
   * webhook included — keeps writing 'paid' without being touched.
   */
  grantType: z.enum(["paid", "complimentary"]).optional().default("paid"),
  /** Internal note. Admin-facing only; never shown to the owner. */
  grantReason: optionalTrimmed(500).optional(),
}).refine((d) => d.endDate >= d.startDate, {
  message: "End date must be after start date.",
  path:    ["endDate"],
}).refine((d) => d.grantType !== "complimentary" || d.amount === 0, {
  // Mirrors premium_listings_complimentary_is_free. A free grant with a price
  // on it is a fake transaction, which is the one thing the brief rules out
  // twice — so it is refused here AND by the database.
  message: "A complimentary offer cannot carry an amount.",
  path:    ["amount"],
});

/** Withdrawing a complimentary offer early. */
export const revokePremiumOfferSchema = z.object({
  listingId: uuidSchema,
  reason:    trimmed(500).refine((v) => v.length > 0, "Please say why the offer is being withdrawn."),
});

export const premiumPlanUpdateSchema = z.object({
  slug:          z.enum(["premium", "pro"]),
  monthly_price: moneySchema,
  duration_days: z.union([z.number(), z.string()])
    .transform((v) => (typeof v === "number" ? v : parseInt(String(v), 10)))
    .refine((n) => Number.isInteger(n) && n > 0, "Duration must be a positive integer."),
});

/**
 * SHAPE AND RANGE ONLY — this is not the whole rule.
 *
 * A commission percent that is well-formed and inside [0,100] can still be
 * unusable, because it is not independent of the advance percentage. Anything
 * writing this value must ALSO run checkCommissionAgainstAdvance() below; the
 * range check on its own is what let a rate through that throws at checkout.
 */
export const commissionPercentSchema = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : parseFloat(String(v))))
  .refine((n) => Number.isFinite(n), "Enter a valid number.")
  .refine((n) => n >= 0 && n <= 100, "Rate must be between 0 and 100.");

/**
 * The commission may take at most HALF the advance.
 *
 * WHY THE TWO PERCENTAGES ARE NOT INDEPENDENT. Hallnect charges its commission
 * on the FULL HALL PRICE but retains it out of the (much smaller) ADVANCE, so
 * the base and the source are different numbers and they can cross. When they
 * do, calculateBookingPayment() throws a RangeError rather than emit a negative
 * owner payout — and that throw lands at CHECKOUT, on every hall, for every
 * customer, with nothing on the settings screen to say what broke. Two fields
 * that each look individually reasonable brick the whole catalogue.
 *
 * WHY HALF, AND NOT SIMPLY `commission < advance`. `commission < advance` is
 * the invariant the engine asserts, but it is not a safe bound on the RATES,
 * because the two amounts are rounded differently: the advance is rounded to
 * whole rupees (advanceFromTotal) while the commission is floored to paise. A
 * pair a hair apart still crosses — a 2.51% advance against a 2.50% commission
 * on a ₹1,000 hall gives an advance that rounds down to ₹25.00 and a commission
 * of exactly ₹25.00, which is not less than it, so that hall cannot be booked.
 *
 * Half is the bound that is PROVABLE for every hall price T, including the
 * pathological ones nothing currently stops an owner listing. Writing a for the
 * advance percent and c for the commission percent, in paise:
 *     commissionPaise = floor(T·c)            ≤ T·a/2        (given c ≤ a/2)
 *     advancePaise    = 100·max(1, round(T·a/100)) ≥ max(100, T·a − 50)
 *   • T·a ≤ 100 → the ₹1 advance floor gives ≥ 100, and T·a/2 ≤ 50 < 100.
 *   • T·a > 100 → T·a − 50 > T·a/2, so the advance strictly exceeds it.
 *
 * BE HONEST ABOUT WHAT HALF IS: sufficient, not necessary. Swept against the
 * real engine, the ratio where hall prices actually start breaking is about
 * two-thirds — at c/a = 0.7 a 25% advance with a 17.5% commission already
 * bricks a ₹5.72 hall, while c/a = 0.6 breaks nothing. Half is the round number
 * below that tipping point which the two lines above actually prove, and it
 * leaves the margin that makes the rule checkable HERE, from the two rates
 * alone, without knowing what any hall costs. Do not "tighten" it to
 * `commission < advance`; that is the engine's per-booking assertion, and it is
 * not a safe bound on the rates.
 *
 * At the live rates — 2.5% commission against a 25% advance — this leaves a
 * factor of five of headroom, so it binds only on a misconfiguration. Raising
 * the commission past half the advance is a real business decision (it needs
 * the advance raised with it), not a validation to relax.
 */
export const MAX_COMMISSION_SHARE_OF_ADVANCE = 0.5;

/** Trims a percent for display: 12.5 → "12.5", 12.00 → "12". */
function fmtPercent(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * The cross-field rule, checked at the point of write by BOTH admin actions —
 * the one that sets the commission and the one that sets the advance. Pure, so
 * the same rule is available to a client-side preview without a database read.
 *
 * `editing` only chooses the wording: an admin who just typed a commission
 * needs to be told to raise the advance, and vice versa. Telling them the rule
 * without telling them which number to move is how a launch-day settings change
 * becomes a support ticket.
 */
export function checkCommissionAgainstAdvance(
  commissionPercent: number,
  advancePercent: number,
  editing: "commission" | "advance",
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
    return { ok: false, error: "Commission rate must be between 0 and 100." };
  }
  // Strictly positive: advanceFromTotal() throws on a 0% advance, so a zero here
  // is the same brick-the-catalogue outcome by a different route.
  if (!Number.isFinite(advancePercent) || advancePercent <= 0 || advancePercent > 100) {
    return {
      ok: false,
      error: "Default advance percentage must be more than 0 and at most 100.",
    };
  }

  const ceiling = advancePercent * MAX_COMMISSION_SHARE_OF_ADVANCE;
  if (commissionPercent <= ceiling) return { ok: true };

  const floorForAdvance = commissionPercent / MAX_COMMISSION_SHARE_OF_ADVANCE;
  return {
    ok: false,
    error:
      editing === "commission"
        ? `A ${fmtPercent(commissionPercent)}% commission cannot be retained from a ` +
          `${fmtPercent(advancePercent)}% advance — the commission is charged on the full hall ` +
          `price but taken out of the advance, so bookings would fail at checkout. Enter ` +
          `${fmtPercent(ceiling)}% or less, or raise the advance to ` +
          `${fmtPercent(floorForAdvance)}% first.`
        : `A ${fmtPercent(advancePercent)}% advance is too small to cover the current ` +
          `${fmtPercent(commissionPercent)}% commission, which is charged on the full hall price ` +
          `but taken out of the advance — bookings would fail at checkout. Enter ` +
          `${fmtPercent(floorForAdvance)}% or more, or lower the commission to ` +
          `${fmtPercent(ceiling)}% first.`,
  };
}

// ── Coupons ─────────────────────────────────────────────────────────────────

/**
 * A promo code as typed by a customer or an admin.
 *
 * The transform is the SAME canonicalisation as normalizeCouponCode() in
 * lib/coupons.ts, and the pattern is the same as the coupons_code_format CHECK
 * in migration 0045. All three must move together: a code that passes here but
 * fails the CHECK becomes a 500 on an admin form, and one that passes here but
 * fails normalisation silently never matches a row.
 *
 * The 8-character floor is a security bound — see lib/coupons.ts.
 */
export const couponCodeSchema = z
  .string()
  .transform((v) => String(v ?? "").slice(0, 64).normalize("NFKC").replace(/\s+/g, "").toUpperCase())
  .refine((v) => /^[A-Z0-9][A-Z0-9-]{7,23}$/.test(v),
    "Use 8-24 letters, digits or hyphens (for example LAUNCH2026).");

export const couponCreateSchema = z.object({
  code:        couponCodeSchema,
  description: optionalTrimmed(500),
  // Blank means UNLIMITED, which is what "until I stop it" asks for. A cap is
  // opt-in, and is enforced by the database trigger as well as here.
  //
  // THE TRAILING .optional() IS LOAD-BEARING. A Next.js server action drops
  // `undefined` properties when it serialises the argument across the RSC
  // boundary, so a blank field arrives as a MISSING KEY, not as a key holding
  // undefined. Zod 4 treats a .transform() pipe as a required key unless the
  // pipe itself is optional, so without this the admin form failed on every
  // blank optional with "expected nonoptional, received undefined" — while
  // in-process tests passed, because they keep the key.
  maxRedemptions: z
    .union([z.string(), z.number(), z.null()])
    .transform((v) => {
      if (v === null || String(v).trim() === "") return undefined;
      if (typeof v === "number") return v;
      const s = String(v).trim();
      // NOT a bare parseInt. parseInt("2.5") is 2 and parseInt("50%") is 50 —
      // it stops at the first character it cannot use and returns what it has,
      // so a typo silently became a DIFFERENT, valid-looking cap. An admin who
      // typed 2.5 got a coupon that died after two redemptions. Only a clean
      // run of digits is accepted; anything else becomes NaN and is refused.
      return /^\d+$/.test(s) ? Number(s) : NaN;
    })
    .refine((n) => n === undefined || (Number.isInteger(n) && n > 0),
      "Leave blank for unlimited, or enter a positive whole number.")
    .optional(),
  expiresAt: z
    .union([z.string(), z.null()])
    .transform((v) => (v === null || String(v).trim() === "" ? undefined : String(v).trim()))
    .refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v),
      "Enter a date as YYYY-MM-DD, or leave blank for no expiry.")
    .optional(),
});

/**
 * Changing the limits on a coupon that already exists.
 *
 * Reuses couponCreateSchema's two limit fields verbatim — same union, same
 * trailing .optional() for the missing-key case a server action produces, same
 * meaning for blank. If these two ever disagree, a cap acceptable on the create
 * form becomes a 500 on the edit form for the same typed value.
 *
 * `undefined` therefore means "clear it, back to unlimited / no expiry", which
 * is the same thing blank means on create. That is a real thing an admin may
 * want, so it is expressible rather than being silently treated as "leave
 * alone" — the caller passes what the field shows, and what it shows is what
 * gets stored.
 */
export const couponLimitsSchema = couponCreateSchema.pick({
  maxRedemptions: true,
  expiresAt:      true,
});

// ── Helper: parse safely and return ActionResult-shaped errors ───────────────

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Run a schema and return the first issue's message (most informative for a
 * user-facing toast). Server actions wrap this into their ActionResult shape.
 */
export function parseSafe<T extends z.ZodType>(
  schema: T,
  input: unknown,
): ValidationResult<z.output<T>> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const first = result.error.issues[0];
  return { ok: false, error: first?.message ?? "Invalid input." };
}
