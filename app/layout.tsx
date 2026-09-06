import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Navbar }     from "@/components/layout/Navbar";
import { Footer }     from "@/components/layout/Footer";
import { BottomNav }  from "@/components/app/BottomNav";
import { Toaster }    from "@/components/ui/toaster";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/constants";
import { getAppUrl } from "@/lib/env";

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
      lang="en"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${playfair.variable}`}
    >
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

        {/* Desktop navbar (hidden on mobile) */}
        <div className="hidden lg:block">
          <Navbar />
        </div>

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

        <Toaster />
      </body>
    </html>
  );
}
