import type { NextConfig } from "next";

/**
 * The Supabase storage host, derived from the project URL rather than
 * wildcarded. `*.supabase.co` matched EVERY Supabase project on the internet,
 * so anyone with a free project could have their objects proxied and re-served
 * from hallnect.com by /_next/image. Falls back to the wildcard only when the
 * env var is absent (local tooling), never in a real deployment.
 */
function supabaseImageHost(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return "*.supabase.co";
  try {
    return new URL(raw).hostname;
  } catch {
    return "*.supabase.co";
  }
}

const nextConfig: NextConfig = {
  images: {
    // SECURITY: this was hostname "**", which matches EVERY host. Next's image
    // optimizer will fetch and re-serve any URL it is given, so a wildcard
    // turns /_next/image into an open proxy on our own domain: an attacker
    // could serve arbitrary remote content from hallnect.com (brand-laundered
    // phishing) and burn our bandwidth and image cache doing it.
    //
    // Every remote <Image> src in this app comes from Supabase Storage via
    // getPublicUrl (lib/supabase/storage.ts); local assets like /logo.png are
    // covered separately by the default local patterns. So the allow-list is
    // exactly THIS project's Supabase storage host, scoped to its public path.
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseImageHost(),
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },

  /**
   * Security headers. The site previously sent none, so it was framable by any
   * origin — a clickjacking frame over the owner dashboard's Accept button, or
   * over checkout, needs nothing more than an iframe.
   *
   * The CSP is deliberately conservative about what it asserts:
   *   • frame-ancestors 'none' is the real prize and cannot be set by a meta
   *     tag, which is why it belongs here.
   *   • script-src keeps 'unsafe-inline'/'unsafe-eval' because Next's runtime
   *     and the Cashfree SDK both need them; claiming otherwise would break
   *     checkout. A nonce-based policy is the follow-up, not a launch blocker.
   *   • connect/img/frame sources name the third parties this app genuinely
   *     talks to: Supabase (data + storage) and Cashfree (checkout).
   */
  async headers() {
    const supabaseOrigin = (() => {
      const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
      try { return raw ? new URL(raw).origin : "https://*.supabase.co"; }
      catch { return "https://*.supabase.co"; }
    })();

    // Every Cashfree host the checkout touches. Kept in one place because the
    // SDK moves the browser between them and missing any one of them breaks
    // payment in a way that produces NO server error at all.
    const cashfree = [
      "https://sdk.cashfree.com",
      "https://payments.cashfree.com",
      "https://payments-test.cashfree.com",
      "https://api.cashfree.com",
      "https://sandbox.cashfree.com",
    ].join(" ");

    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      // MUST include the Cashfree payment hosts. The v3 SDK completes checkout
      // by SUBMITTING A FORM to Cashfree's payment domain, and form-action is
      // not covered by default-src — so `form-action 'self'` silently blocked
      // every payment, client-side, with nothing in the server logs. No payment
      // succeeded between this header shipping and this line being added.
      `form-action 'self' ${cashfree}`,
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.cashfree.com",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      `img-src 'self' data: blob: ${supabaseOrigin} https://*.supabase.co`,
      `connect-src 'self' ${supabaseOrigin} https://*.supabase.co wss://*.supabase.co ${cashfree}`,
      // Cashfree renders its payment step in a frame.
      `frame-src 'self' ${cashfree}`,
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Camera/mic/geolocation are genuinely unused, so stay denied.
          // `payment` is NOT unused: it gates the Payment Request API, which is
          // how Cashfree offers Google Pay and other one-tap methods. It was
          // denied outright here, which quietly removed those options from
          // checkout. Allowed for this origin and Cashfree's payment frames.
          {
            key: "Permissions-Policy",
            value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://payments.cashfree.com" "https://payments-test.cashfree.com")',
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
