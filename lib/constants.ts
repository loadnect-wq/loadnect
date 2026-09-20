export const APP_NAME = "Hallnect";

// THE WORD "VERIFIED" MUST NOT COME BACK HERE.
//
// This string is the site-wide meta description (app/layout.tsx feeds it to
// <meta name="description">, Open Graph and Twitter) and it is repeated
// verbatim in the footer of every page. It used to read "Discover and book
// verified wedding halls…", which directly contradicts Terms section 5:
// "Hallnect displays venue information as provided by owners and does not
// independently verify every listing detail."
//
// One of the two had to be false, and the Terms are the accurate one — nobody
// visits a venue before it goes live. A marketplace-wide "verified" claim that
// the operator's own contract disclaims is a misleading advertisement under
// section 2(28) of the Consumer Protection Act 2019, and it is the first thing
// a complainant would quote. "Owner-submitted" is what the homepage trust strip
// already says and it is what actually happens.
// WIDENED IN 0102, NOT REPLACED. Hallnect is a multi-purpose venue marketplace
// now — weddings, parties, meetings and twenty-five other occasions — but
// "wedding halls" stays at the front of this sentence deliberately: it is what
// the platform's inventory actually is today, and it is the phrase the only
// pages that currently rank were built on. The breadth is added; nothing is
// taken away. Do not reverse the order to make the positioning sound bolder.
export const APP_DESCRIPTION =
  "Discover and book wedding halls, party halls and meeting venues across Tamil Nadu — owner-submitted listings, secure booking, and a clear answer from the venue.";

// Single source of truth for public business contact details. Update here and
// every surface (contact page, footer, support copy) stays in sync.
//   • brandName  → customer-facing product/brand ("Hallnect")
//   • legalName  → registered legal entity ("HALLNECT LLP")
//   • phoneHref  → tel: link (digits only) for tap-to-call on mobile
//
// WHAT BELONGS IN HERE, AND WHAT MUST NEVER.
//
// `llpin` and `gstin` are PUBLIC-REGISTER identifiers, verifiable on mca.gov.in
// and the GST portal, and both belong on invoices and official correspondence.
//
// THE GSTIN CONTAINS THE PAN. A GSTIN is [state][PAN][entity][Z][checksum], so
// characters 3–12 of the value below ARE the LLP's PAN. Storing it here is
// correct — a tax invoice cannot be issued without it — but it means the gstin
// field must be treated with the care its PAN deserves:
//
//   • It belongs on an INVOICE, disclosed to the counterparty who needs it.
//   • It does NOT belong in the site footer, on every page, or in JSON-LD.
//     No rule requires it there: CGST Rule 18 governs the name board at the
//     physical place of business, not a website. Scraped from a public footer,
//     a GSTIN is raw material for bogus-invoice and fake-ITC schemes run in
//     this entity's name.
//
// The LLP's TAN is NOT here and must not be added. It is quoted only in TDS
// returns and challans, no display rule reaches it, and it authenticates the
// entity to the tax department. The same goes for bank details, partner
// personal identifiers, and any scan of the incorporation or GST certificate.
//
// `address` is the registered office exactly as recorded at the Registrar of
// Companies. Keep it byte-identical to the MCA record — a marketplace's
// published address is what a consumer forum serves notice to.
export const CONTACT = {
  brandName: "Hallnect",
  legalName: "HALLNECT LLP",
  /** LLP Identification Number, Registrar of Companies. Public register data. */
  llpin:     "ADA-7588",
  /** GSTIN, Tamil Nadu (state code 33). Regular registration, liable from 2026-08-21. */
  gstin:     "33AATFH8253K1ZT",
  email:     "hallnect@gmail.com",
  phone:     "+91 9344040013",          // primary, for display
  phoneHref: "tel:+919344040013",       // clickable (mobile tap-to-call)
  phones:    ["+91 9344040013"],        // all official numbers (currently one)
  address:   "No. 68, Venkateshwara Nagar, Sundar Nagar Extension, Tirunagar, Madurai – 625006, Tamil Nadu, India",
} as const;

// Support availability. ONE definition, two consumers: app/contact/page.tsx
// renders `label`, and lib/seo/jsonld.ts builds the machine-readable
// OpeningHoursSpecification from the same numbers — so the sentence a customer
// reads and the hours Google parses cannot drift apart.
//
// These MUST stay equal to the hours published on the Google Business Profile.
// Google cross-references a profile against its website, and a customer who
// reads one closing time on the site and another on Maps is failed either way.
// Changing hours means changing this constant AND the profile.
export const SUPPORT_HOURS = {
  // 24-hour local time (IST). Schema.org reads the timezone from the postal
  // address, so these stay bare — there is no timezone field to set.
  opens:  "09:00",
  closes: "21:00",
  days: [
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  ],
  /** Human-readable form of the same fact, for visible copy. */
  label: "every day, 9 AM – 9 PM IST",
} as const;

// NOTE: every href here MUST point to a real, existing route. Marketing stubs
// (/about, /how-it-works, /careers, /blog, /press, /help, /safety) were removed
// because no page files exist for them — they were a source of footer/navbar
// 404s on every page. Re-add a link only when its page actually exists.
export const NAV_LINKS = [
  { label: "Browse Halls",   href: "/halls" },
  { label: "Pricing",        href: "/premium" },
  { label: "List Your Hall", href: "/owner/register" },
  { label: "Contact",        href: "/contact" },
] as const;

export const FOOTER_LINKS = {
  explore: [
    { label: "Browse Halls",   href: "/halls" },
    { label: "About Us",       href: "/about" },
    { label: "Pricing",        href: "/premium" },
    { label: "List Your Hall", href: "/owner/register" },
    { label: "Contact Us",     href: "/contact" },
  ],
  support: [
    { label: "Contact Us",          href: "/contact" },
    { label: "Refund Policy",       href: "/refund-policy" },
    { label: "Cancellation Policy", href: "/cancellation-policy" },
  ],
  legal: [
    { label: "Privacy Policy",      href: "/privacy"              },
    { label: "Terms of Service",    href: "/terms"                },
    { label: "Refund Policy",       href: "/refund-policy"        },
    { label: "Cancellation Policy", href: "/cancellation-policy"  },
    { label: "Disclaimer",          href: "/disclaimer"           },
    { label: "Grievance Redressal", href: "/grievance-redressal"   },
  ],
} as const;

export const HALL_CAPACITIES = [
  { label: "Up to 50 guests", value: "50" },
  { label: "50–150 guests", value: "150" },
  { label: "150–300 guests", value: "300" },
  { label: "300–500 guests", value: "500" },
  { label: "500+ guests", value: "500+" },
] as const;

// Earlier commission models (5%, then per-hall owner-chosen rates) are
// DISCONTINUED. The active money model: the standard commission
// (lib/commission.ts STANDARD_COMMISSION_PERCENT) absorbed inside the advance,
// plus a flat customer platform fee (lib/booking-payment.ts
// PLATFORM_FEE_RUPEES). No rate constant lives here.

export function getDashboardPath(role: string): string {
  switch (role) {
    case "customer":       return "/customer";
    case "owner_approved": return "/owner/dashboard";
    // Legacy value — owner joining approval was removed (migration 0019).
    // MUST NOT point at a role-gated route: /owner/dashboard requires
    // owner_approved, so requireRole would redirect here again and the browser
    // would loop until ERR_TOO_MANY_REDIRECTS. Home is ungated, so a stale
    // owner_pending session lands somewhere usable and can still sign out.
    case "owner_pending":  return "/";
    case "admin":          return "/admin/dashboard";
    default:               return "/";
  }
}

/**
 * How long a suspended or closed account is banned from signing in.
 *
 * GoTrue takes a Go duration string whose largest unit is hours, so there is no
 * "forever" to ask for — an indefinite ban is spelled as a very long one
 * (~100 years). Reactivation lifts it explicitly with 'none' rather than
 * waiting it out.
 *
 * SHARED ON PURPOSE. Two places ban a user — the admin suspension in
 * app/admin/actions.ts and the self-service closure in lib/account-deletion.ts
 * — and both are enforcing the same thing: profiles.is_active is invisible to
 * RLS, so the ban is what actually stops an existing JWT reaching PostgREST.
 * A security constant that exists twice is one that drifts, and the drift is
 * invisible until someone tests the wrong half.
 */
export const SUSPENSION_BAN_DURATION = "876000h";
