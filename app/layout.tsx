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
        {/* Desktop navbar (hidden on mobile) */}
        <div className="hidden lg:block">
          <Navbar />
        </div>

        <main className="flex-1 pb-[calc(var(--bottom-nav-h,4.5rem)+env(safe-area-inset-bottom))] lg:pb-0">
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
