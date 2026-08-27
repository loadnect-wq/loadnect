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
export function sanitizeText(input: unknown, maxLen = 4000): string {
  if (typeof input !== "string") return "";
  return input.replace(/[<>\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLen);
}

const trimmed = (max: number) =>
  z.string().transform((s) => sanitizeText(s, max));

const optionalTrimmed = (max: number) =>
  z.string().optional().transform((s) => (s ? sanitizeText(s, max) : ""));

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

export const hallSchema = z
  .object({
    name:         trimmed(160).pipe(z.string().min(2, "Hall name is required.")),
    city:         trimmed(80).pipe(z.string().min(1, "City is required.")),
    state:        optionalTrimmed(80),
    address:      optionalTrimmed(500),
    pincode:      pincodeSchema,
    capacityMin:  optionalCapacitySchema,
    capacityMax:  capacitySchema,
    pricePerDay:  moneySchema,
    priceMorning: optionalMoneySchema,
    priceEvening: optionalMoneySchema,
    description:  optionalTrimmed(4000),
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
  );

export type HallInput = z.input<typeof hallSchema>;

// Owner-side input also has ownerId on create; edit doesn't need it.
export const hallCreateSchema = hallSchema.and(
  z.object({ ownerId: uuidSchema }),
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
  altText:     optionalTrimmed(200),
});

// ── Availability ─────────────────────────────────────────────────────────────

const ALLOWED_SLOTS = ["morning", "evening", "full_day"] as const;

// The FULL availability_status enum. The calendar posts back every row it
// loaded, including the booked statuses the payment flow writes
// (full_day_booked / morning_booked / evening_booked), so a narrower list here
// rejected the whole batch — meaning an owner could never save their calendar
// again once the hall had taken a single booking.
const ALLOWED_AVAIL_STATUSES = [
  "available", "blocked", "booked", "partially_booked",
  "morning_booked", "evening_booked", "full_day_booked", "maintenance",
] as const;

/** The only statuses an OWNER may actually set. Everything else is written by
 *  the booking flow and is not theirs to change — see setAvailability. */
export const OWNER_EDITABLE_AVAIL_STATUSES = ["available", "blocked", "maintenance"] as const;

export const availabilityEntrySchema = z.object({
  date:   dateStringSchema,
  slot:   z.enum(ALLOWED_SLOTS),
  status: z.enum(ALLOWED_AVAIL_STATUSES),
});

export const availabilityBatchSchema = z.object({
  hallId:  uuidSchema,
  entries: z.array(availabilityEntrySchema).max(500, "Too many entries in one update."),
});

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
}).refine((d) => d.endDate >= d.startDate, {
  message: "End date must be after start date.",
  path:    ["endDate"],
});

export const premiumPlanUpdateSchema = z.object({
  slug:          z.enum(["premium", "pro"]),
  monthly_price: moneySchema,
  duration_days: z.union([z.number(), z.string()])
    .transform((v) => (typeof v === "number" ? v : parseInt(String(v), 10)))
    .refine((n) => Number.isInteger(n) && n > 0, "Duration must be a positive integer."),
});

export const commissionPercentSchema = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : parseFloat(String(v))))
  .refine((n) => Number.isFinite(n), "Enter a valid number.")
  .refine((n) => n >= 0 && n <= 100, "Rate must be between 0 and 100.");

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
