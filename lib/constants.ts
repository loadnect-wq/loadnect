export const APP_NAME = "Hallnect";
export const APP_DESCRIPTION =
  "Discover and book verified wedding halls and event venues across Tamil Nadu — secure booking, owner-approved listings.";

// Single source of truth for public business contact details. Update here and
// every surface (contact page, footer, support copy) stays in sync.
//   • brandName  → customer-facing product/brand ("Hallnect")
//   • legalName  → registered legal entity ("HALLNECT LLP")
//   • phoneHref  → tel: link (digits only) for tap-to-call on mobile
export const CONTACT = {
  brandName: "Hallnect",
  legalName: "HALLNECT LLP",
  email:     "hallnect@gmail.com",
  phone:     "+91 9344040013",          // primary, for display
  phoneHref: "tel:+919344040013",       // clickable (mobile tap-to-call)
  phones:    ["+91 9344040013"],        // all official numbers (currently one)
  address:   "No. 68, Venkateshwara Nagar, Sundar Nagar Extension, Tirunagar, Madurai – 625006, Tamil Nadu, India",
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
  ],
} as const;

export const HALL_CAPACITIES = [
  { label: "Up to 50 guests", value: "50" },
  { label: "50–150 guests", value: "150" },
  { label: "150–300 guests", value: "300" },
  { label: "300–500 guests", value: "500" },
  { label: "500+ guests", value: "500+" },
] as const;

export const PLATFORM_FEE_PERCENT = 5; // 5 % commission taken from each booking

export function getDashboardPath(role: string): string {
  switch (role) {
    case "customer":       return "/customer";
    case "owner_approved": return "/owner/dashboard";
    // Legacy value — owner joining approval was removed (migration 0019).
    // Any stale session carrying it lands on the owner dashboard.
    case "owner_pending":  return "/owner/dashboard";
    case "admin":          return "/admin/dashboard";
    default:               return "/";
  }
}
