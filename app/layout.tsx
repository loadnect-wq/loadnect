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
  try {
    return new URL(raw ?? "http://localhost:3000");
  } catch {
    throw new Error(`NEXT_PUBLIC_APP_URL is not a valid URL: "${raw}"`);
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
