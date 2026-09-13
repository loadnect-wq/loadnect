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
  // VAPT: the response carried `X-Powered-By: Next.js` on every request, naming
  // the framework and therefore the advisory list worth trying. It buys an
  // attacker a little reconnaissance and buys us nothing — Next sends it by
  // default and it is one flag to stop.
  //
  // NOT a security control by itself: the stack is still inferable from
  // /_next/ paths and build-manifest shapes. This removes a free hint, it does
  // not hide anything, and nothing else should be built on top of that belief.
  poweredByHeader: false,

  images: {
    // AVIF first, WebP as the fallback. The LCP element on /, /halls and every
    // venue page is a photograph, which is the case AVIF compresses best —
    // typically 20-30% under WebP at the same quality. Anything that does not
    // send `Accept: image/avif` still gets WebP, so nothing regresses; the cost
    // is one extra transformation per (image, width) on a cache miss, and the
    // whole catalogue is nine photos.
    formats: ["image/avif", "image/webp"],

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
   * /pricing is an alias for /premium, and it is the only route on the site
   * that was in neither the sitemap, the disallow list nor a noindex — an
   * orphan that redirected with a 307 TEMPORARY, which tells Google to keep
   * the old URL and re-check it forever. 308 says the move is permanent and
   * passes the signal on to /premium.
   *
   * Declared here rather than as a page that calls redirect(): this way the
   * alias never invokes a function, and the route stops existing as far as the
   * App Router is concerned.
   */
  async redirects() {
    return [{ source: "/pricing", destination: "/premium", permanent: true }];
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

    // Google Analytics, and it needs THREE directives, not one. gtag.js is
    // fetched from googletagmanager.com, the hits go to google-analytics.com
    // (and region-scoped *.analytics.google.com), and GA still falls back to an
    // image beacon when a fetch is unavailable. Miss any one and analytics
    // silently records nothing — the same shape as the form-action bug above,
    // which blocked every payment with no server error at all.
    //
    // These hosts are listed even though gtag only loads after consent: the CSP
    // is a static header and cannot know what a given visitor chose.
    const googleAnalytics = {
      script:  "https://www.googletagmanager.com",
      connect: "https://www.google-analytics.com https://analytics.google.com https://*.analytics.google.com https://*.google-analytics.com",
      img:     "https://www.google-analytics.com https://*.google-analytics.com",
    };

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
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.cashfree.com ${googleAnalytics.script}`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      `img-src 'self' data: blob: ${supabaseOrigin} https://*.supabase.co ${googleAnalytics.img}`,
      `connect-src 'self' ${supabaseOrigin} https://*.supabase.co wss://*.supabase.co ${cashfree} ${googleAnalytics.connect}`,
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
          // A year, subdomains included. `preload` is DELIBERATELY ABSENT and
          // should stay absent until somebody decides to submit the domain.
          //
          // The directive is not the commitment — submitting hallnect.com to
          // hstspreload.org is, and that ships the rule inside browsers where
          // it cannot be withdrawn on our timetable: removal takes months and
          // reaches users only as they update. Until every current and future
          // subdomain is certain to serve HTTPS for ever, the honest state is
          // this header without the claim. Sending `preload` while not
          // submitted is worse than either: it reads as done to anyone
          // auditing the header and does nothing at all.
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
