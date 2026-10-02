// ─────────────────────────────────────────────────────────────────────────────
// Noto Sans Tamil, SELF-HOSTED — the one definition every Tamil surface uses
// (the Tamil city pages, the QR standee). Import `notoSansTamil` from here;
// never call next/font/google's Noto_Sans_Tamil.
//
// WHY NOT next/font/google. It fetches Google's CSS at BUILD time, and Google
// sometimes answers with extensionless `/l/font?kit=…&skey=…` URLs instead of
// `/s/<name>.woff2`. Turbopack cannot parse those ("next/font/google queries
// have exactly one entry"), and the production build of 59d7b23 died on exactly
// that, for this font only. The answer depends on where and when the build
// runs, so a local build passing proves nothing. The file is checked in
// instead, and the build no longer depends on Google.
//
// It is Google Fonts' own Tamil subset of Noto Sans Tamil v31: one variable
// file covering weights 100–900, with the same unicode-range Google serves.
// Latin and latin-ext are deliberately not shipped: every page using this puts
// Inter first in its font stack, and Inter renders every Latin character.
// Licence (OFL 1.1) sits beside the file.
//
// Exposed as the CSS variable --font-tamil; apply `notoSansTamil.variable` to a
// wrapper and reference var(--font-tamil) in the font stack.
// ─────────────────────────────────────────────────────────────────────────────

import localFont from "next/font/local";

export const notoSansTamil = localFont({
  src: "./NotoSansTamil-wght-tamil.woff2",
  weight: "100 900",
  variable: "--font-tamil",
  display: "swap",
  declarations: [
    { prop: "unicode-range", value: "U+0964-0965, U+0B82-0BFA, U+200C-200D, U+20B9, U+25CC" },
  ],
});
