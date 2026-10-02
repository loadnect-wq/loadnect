// ─────────────────────────────────────────────────────────────────────────────
// The printed card itself. A server component: the QR SVG is drawn on the
// server (lib/standee.server.ts) and passed in as markup.
//
// Every size is in container-query units (cqw) of the wrapper, so this same
// markup is the phone preview AND the A5 print — the page's print CSS sets the
// wrapper to 148 mm and everything scales with it.
//
// IT MUST FIT. The card clips (overflow-hidden) so a print can never spill onto
// a second sheet — which means content that overflows is silently cut off. The
// URL line was, at first: the three-line Tamil headline pushed it out. The code
// was shrunk from 58cqw to 50cqw to make room; that still prints squares of
// about 2 mm, which lib/__tests__/qr-standee.test.ts holds to >= 1.5 mm.
//
// Tamil first, English under it: the headline a family reads is the one in
// their language, and many families visiting a Madurai mahal read Tamil first.
// ─────────────────────────────────────────────────────────────────────────────

import Image from "next/image";
import { STANDEE_SCAN_LINE, type StandeeCopy } from "@/lib/standee";

/**
 * Everything but the card disappears on paper; the card fills ONE A5 sheet.
 *
 * Measured, not assumed: with `position: fixed` Chrome repeated the card on
 * every printed page, and the hidden rest of the page (visibility keeps its
 * height) made three of them. So the card is ABSOLUTE at the top of the first
 * page, and html/body are clamped to one sheet's height so nothing paginates.
 */
export const STANDEE_PRINT_CSS = `
@media print {
  @page { size: A5 portrait; margin: 0; }
  html, body {
    background: #fff !important; height: 210mm !important; max-height: 210mm !important;
    overflow: hidden !important; margin: 0 !important; padding: 0 !important;
  }
  body * { visibility: hidden !important; }
  #standee-print, #standee-print * { visibility: visible !important; }
  #standee-print {
    position: absolute; left: 0; top: 0; width: 148mm !important; max-width: none !important;
    margin: 0 !important; box-shadow: none !important;
  }
  #standee-print [data-card] { border-radius: 0 !important; height: 210mm; aspect-ratio: auto !important; }
  #standee-print, #standee-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;

const TAMIL = { fontFamily: "var(--font-tamil), var(--font-inter), sans-serif" } as const;

/**
 * Long names step down in size and stop at two lines, so a name like
 * "Sri Lakshmi Narayana Kalyana Mahal" cannot push the URL off the card.
 */
export function standeeNameSize(name: string): string {
  if (name.length <= 18) return "text-[7.5cqw]";
  if (name.length <= 28) return "text-[6.2cqw]";
  return "text-[5cqw]";
}

export function StandeeCard({
  hallName,
  copy,
  svg,
  shortUrl,
}: {
  hallName: string;
  copy: StandeeCopy;
  /** The QR code as SVG markup, drawn on the server from our own URL. */
  svg: string;
  /** "hallnect.com/q/<slug>", printed under the code for anyone who cannot scan. */
  shortUrl: string;
}) {
  return (
    <div id="standee-print" className="mx-auto w-full max-w-[420px] [container-type:inline-size]">
      <div
        data-card=""
        className="flex aspect-[148/210] flex-col overflow-hidden rounded-2xl bg-white text-charcoal-950 shadow-elevated"
      >
        <div className="flex items-center justify-center gap-[2cqw] bg-maroon-700 px-[6cqw] py-[3cqw]">
          <Image src="/logo.png" alt="" width={48} height={52} className="h-[7cqw] w-auto" />
          <span className="font-serif text-[6cqw] font-bold text-white">Hallnect</span>
        </div>

        <div className="flex flex-1 flex-col items-center px-[7cqw] pt-[3cqw] text-center">
          <p className={`font-serif ${standeeNameSize(hallName)} line-clamp-2 font-bold leading-tight text-maroon-800`}>{hallName}</p>
          <p lang="ta" className="mt-[2cqw] text-[4.1cqw] font-bold leading-snug" style={TAMIL}>
            {copy.ta}
          </p>
          <p className="mt-[1cqw] text-[3.6cqw] text-charcoal-700">{copy.en}</p>

          <div
            className="mt-[3cqw] w-[50cqw] rounded-[2cqw] bg-white p-[3cqw] ring-[0.6cqw] ring-charcoal-200 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
            role="img"
            aria-label={`QR code for ${shortUrl}`}
            // Server-drawn by qrcode from our own URL — no user input reaches it.
            dangerouslySetInnerHTML={{ __html: svg }}
          />

          <p lang="ta" className="mt-[3cqw] text-[3.6cqw] font-bold" style={TAMIL}>
            {STANDEE_SCAN_LINE.ta}
          </p>
          <p className="text-[3.2cqw] text-charcoal-700">{STANDEE_SCAN_LINE.en}</p>
        </div>

        <p className="pb-[3cqw] pt-[1.5cqw] text-center text-[2.9cqw] tabular-nums text-charcoal-600">{shortUrl}</p>
      </div>
    </div>
  );
}
