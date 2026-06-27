export const APP_NAME = "Hallnect";
export const APP_DESCRIPTION =
  "Discover and book the perfect wedding hall or event venue — trusted by thousands of couples and event planners.";

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
    case "owner_pending":  return "/approval-pending";
    case "admin":          return "/admin/dashboard";
    default:               return "/";
  }
}
