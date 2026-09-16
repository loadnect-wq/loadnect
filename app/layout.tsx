import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Navbar }     from "@/components/layout/Navbar";
import { Footer }     from "@/components/layout/Footer";
import { AnalyticsConsent } from "@/components/analytics/AnalyticsConsent";
import { BottomNav }  from "@/components/app/BottomNav";
import { Toaster }    from "@/components/ui/toaster";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/constants";
import { getAppUrl } from "@/lib/env";
import { REVEAL_BOOT_SCRIPT } from "@/lib/motion";
import { SITE_LANG } from "@/lib/seo/config";
import { RevealObserver } from "@/components/motion/RevealObserver";

const inter = Inter({
  subsets:  ["latin"],
  variable: "--font-inter",
  display:  "swap",
});

const playfair = Playfair_Display({
  subsets:  ["latin"],
  variable: "--font-playfair",
  display:  "swap",
  weight:   ["400", "500", "600", "700", "800"],
  style:    ["normal", "italic"],
});

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: APP_DESCRIPTION,
  // Hardened resolver (lib/env) — tolerates a scheme-less NEXT_PUBLIC_APP_URL
  // and never throws, so a bad env value can't 500 every page.
  metadataBase: new URL(getAppUrl()),
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  openGraph: { type: "website", siteName: APP_NAME, title: APP_NAME, description: APP_DESCRIPTION },
  twitter:   { card: "summary_large_image", title: APP_NAME, description: APP_DESCRIPTION },
  // Google Search Console ownership proof for the https://hallnect.com
  // property. Emitted site-wide as
  //   <meta name="google-site-verification" content="..." />
  // Google re-checks this periodically, so it must NOT be removed after
  // verification succeeds or the property silently loses ownership.
  verification: { google: "-NpXvVXPqo0ifxqQvyUdyQxcnin43rtVfea-Uy2CYMQ" },
};

export const viewport: Viewport = {
  themeColor: "#5C0E17",
  width:      "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      // en-IN, matching SITE_LOCALE/og:locale. Plain "en" contradicted the
      // Indian-English locale every page declares, and left SITE_LANG unused.
      lang={SITE_LANG}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${playfair.variable}`}
    >
      <head>
        {/* Scroll-reveal boot. BLOCKING AND INLINE ON PURPOSE: it has to run
            before the body paints, or the page would render visible, then be
            hidden by the CSS once the class landed, and flash. It only ever
            ADDS the ability to hide — see lib/motion.ts and the contract at the
            bottom of app/globals.css. `unsafe-inline` is already in the CSP's
            script-src, so this needs no config change. */}
        <script dangerouslySetInnerHTML={{ __html: REVEAL_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col bg-ivory-100 text-foreground antialiased">
        {/* Skip link — the first focusable thing on every page (WCAG 2.4.1).
            Without it, a keyboard or screen-reader user has to tab past the
            whole Navbar — the logo link, every NAV_LINKS entry, then the
            dashboard/sign-out or sign-in/register/get-started buttons — again
            on every single navigation before reaching the page they asked for.
            Invisible until focused, so nothing changes for a mouse user.
            z sits above the Navbar's sticky z-50 header, or the link would take
            focus and be painted underneath it. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-maroon-700 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white focus:shadow-elevated"
        >
          Skip to main content
        </a>

        {/* Desktop navbar. NOT wrapped in a `hidden lg:block` div any more:
            a position:sticky element can only travel within its containing
            block, and that wrapper was exactly the header's own height, so the
            navbar scrolled away instead of sticking (measured: top -1750px at
            scrollY 1750). The breakpoint lives on the <header> itself now, so
            its containing block is <body> and it can actually stick. */}
        <Navbar />

        {/* tabIndex={-1} is what makes the skip link actually land: following a
            fragment link does not move focus to a non-focusable element in
            every browser, and without focus the next Tab goes back to the top
            of the nav. -1 keeps it out of the tab order otherwise.
            No focus:outline-none here on purpose: the browser draws its ring
            only for :focus-visible, so following the skip link confirms where
            focus landed and a stray click on the page does not. */}
        <main
          id="main"
          tabIndex={-1}
          className="flex-1 pb-[calc(var(--bottom-nav-h,4.5rem)+env(safe-area-inset-bottom))] lg:pb-0"
        >
          {children}
        </main>

        {/* Footer — rendered at EVERY viewport.
            SEO: it used to sit inside `hidden lg:block`. Google indexes
            mobile-first at a ~412px viewport, so display:none removed the
            entire site-wide link graph (cities, categories, legal, contact)
            from what Googlebot could see and follow. The app feel is preserved
            by the padding below, which keeps the footer clear of BottomNav. */}
        <div className="pb-[calc(var(--bottom-nav-h,4.5rem)+env(safe-area-inset-bottom))] lg:pb-0">
          <Footer />
        </div>

        {/* Mobile bottom nav */}
        <BottomNav />

        {/* Cookie banner and, only after a yes, the Google Analytics tag.
            Client-side by design: the public pages are prerendered and served
            from cache identically to everyone, so reading a consent cookie on
            the server would make every route dynamic again. */}
        <AnalyticsConsent />

        {/* The single IntersectionObserver behind every `data-reveal` in the
            app. Renders nothing; mounted here so one instance covers every
            route, including content added after the first paint. */}
        <RevealObserver />

        <Toaster />
      </body>
    </html>
  );
}
