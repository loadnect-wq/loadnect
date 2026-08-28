import Link from "next/link";
import { Camera, Globe, MessageCircle, PlayCircle, Mail, Phone, MapPin } from "lucide-react";
import { APP_NAME, FOOTER_LINKS, CONTACT } from "@/lib/constants";

// Hallnect has no social accounts yet. These were four icons all pointing at
// "#", on every page of the site — a visitor tapping one stayed exactly where
// they were. An empty list renders nothing; add real URLs here when the
// accounts exist and the row comes back on its own.
const SOCIAL_LINKS: { Icon: typeof Camera; href: string; label: string }[] = [];

export function Footer() {
  return (
    <footer className="bg-maroon-950 text-ivory-200" aria-label="Site footer">
      {/* Gold top rule */}
      <div
        className="h-px bg-gradient-to-r from-transparent via-gold-500 to-transparent"
        aria-hidden
      />

      <div className="container-page py-14">
        {/* ── Grid ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">

          {/* Brand column */}
          <div className="space-y-5 lg:col-span-1">
            <div>
              <p className="font-serif text-2xl font-bold tracking-tight text-ivory-100">
                {APP_NAME}
                <span className="ml-1.5 text-gold-400" aria-hidden>✦</span>
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ivory-400 max-w-xs">
                Discover and book verified wedding halls and event venues across Tamil Nadu — secure booking, owner-approved listings.
              </p>
            </div>

            {/* Contact */}
            <ul className="space-y-2 text-sm text-ivory-400">
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4 shrink-0 text-gold-400" aria-hidden />
                <a href={`mailto:${CONTACT.email}`} className="hover:text-ivory-100">{CONTACT.email}</a>
              </li>
              <li className="flex items-center gap-2">
                <Phone className="h-4 w-4 shrink-0 text-gold-400" aria-hidden />
                <a href={CONTACT.phoneHref} className="hover:text-ivory-100">{CONTACT.phone}</a>
              </li>
              <li className="flex items-start gap-2">
                <MapPin className="h-4 w-4 shrink-0 text-gold-400" aria-hidden />
                <span>{CONTACT.address}</span>
              </li>
            </ul>

            {/* Social */}
            <div className="flex items-center gap-2">
              {SOCIAL_LINKS.map(({ Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-maroon-800 text-ivory-500 transition-colors hover:border-gold-500 hover:text-gold-400"
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </a>
              ))}
            </div>
          </div>

          {/* Explore */}
          <div>
            <h3 className="mb-4 font-serif text-xs font-semibold uppercase tracking-widest text-gold-400">
              Explore
            </h3>
            <ul className="space-y-2.5">
              {FOOTER_LINKS.explore.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-ivory-500 transition-colors hover:text-ivory-100"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Support */}
          <div>
            <h3 className="mb-4 font-serif text-xs font-semibold uppercase tracking-widest text-gold-400">
              Support
            </h3>
            <ul className="space-y-2.5">
              {FOOTER_LINKS.support.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-ivory-500 transition-colors hover:text-ivory-100"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="mb-4 font-serif text-xs font-semibold uppercase tracking-widest text-gold-400">
              Legal
            </h3>
            <ul className="space-y-2.5">
              {FOOTER_LINKS.legal.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-ivory-500 transition-colors hover:text-ivory-100"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ── Bottom bar ───────────────────────────────────────── */}
        <div className="mt-12 flex flex-col items-center gap-2 border-t border-maroon-900 pt-6 sm:flex-row sm:justify-between">
          <p className="text-xs text-ivory-600">
            &copy; <span suppressHydrationWarning>{new Date().getFullYear()}</span>{" "}
            {CONTACT.legalName}. All rights reserved.
          </p>
          <p className="text-xs text-ivory-600">
            Made in Tamil Nadu <span className="text-rose-400" aria-label="love">♥</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
