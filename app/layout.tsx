import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Navbar }     from "@/components/layout/Navbar";
import { Footer }     from "@/components/layout/Footer";
import { BottomNav }  from "@/components/app/BottomNav";
import { Toaster }    from "@/components/ui/toaster";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/constants";

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

function resolveAppUrl(raw: string | undefined): URL {
  const fallback = new URL("http://localhost:3000");
  if (!raw || raw.trim() === "") return fallback;
  // Tolerate a scheme-less value (a common deploy mistake: "myapp.vercel.app"
  // instead of "https://myapp.vercel.app").
  const candidate = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  try {
    return new URL(candidate);
  } catch {
    // PRODUCTION SAFETY: metadataBase is cosmetic (OG/canonical URLs). A bad
    // NEXT_PUBLIC_APP_URL must NEVER crash the root layout, which renders on
    // every page — that would 500 the entire site. Log and fall back instead.
    // The value is a public URL (not a secret), so it's safe to log.
    console.error(`[layout] NEXT_PUBLIC_APP_URL is not a valid URL ("${raw}") — using fallback.`);
    return fallback;
  }
}

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: APP_DESCRIPTION,
  metadataBase: resolveAppUrl(process.env.NEXT_PUBLIC_APP_URL),
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  openGraph: { type: "website", siteName: APP_NAME, title: APP_NAME, description: APP_DESCRIPTION },
  twitter:   { card: "summary_large_image", title: APP_NAME, description: APP_DESCRIPTION },
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

        {/* Desktop footer (hidden on mobile to preserve app feel) */}
        <div className="hidden lg:block">
          <Footer />
        </div>

        {/* Mobile bottom nav */}
        <BottomNav />

        <Toaster />
      </body>
    </html>
  );
}
