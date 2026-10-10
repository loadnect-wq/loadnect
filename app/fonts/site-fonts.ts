// ─────────────────────────────────────────────────────────────────────────────
// Inter and Playfair Display, SELF-HOSTED — the two faces every page uses.
// The Tamil face lives beside them in noto-sans-tamil/font.ts, for the same
// reason.
//
// WHY NOT next/font/google. It fetches Google's CSS at BUILD time, and Google
// sometimes answers with extensionless `/l/font?kit=…&skey=…` URLs that
// Turbopack cannot parse ("next/font/google queries have exactly one entry").
// It took down the 2026-10-02 production build for Noto Sans Tamil, and on
// 2026-10-03 a local build died on exactly these two with 40 errors. The
// answer depends on where and when the build runs, so the files are checked in
// and no build depends on Google.
//
// These are Google Fonts' own latin-subset VARIABLE files (Inter v20, Playfair
// Display v40), with Google's unicode-range, so the bytes a visitor downloads
// are the ones they downloaded before. Weights are ranges, which covers every
// weight the old static config listed (Playfair 400–800) and more. The italic
// Playfair is NOT here: it lives in playfair-italic.ts, imported only by the
// two things that use it, so it is no longer preloaded on every page.
// Licences (OFL 1.1) sit beside each file.
//
// The CSS variable names are unchanged — --font-inter and --font-playfair are
// what tailwind.config.ts and every font stack in the app reference.
// ─────────────────────────────────────────────────────────────────────────────

import localFont from "next/font/local";

// The unicode-range is written out twice because the font loader accepts only
// literals in its options — a shared constant fails the build.

export const inter = localFont({
  src: "./inter/Inter-wght-latin.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-inter",
  display: "swap",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});

export const playfair = localFont({
  src: [
    { path: "./playfair-display/PlayfairDisplay-wght-latin.woff2", weight: "400 900", style: "normal" },
  ],
  variable: "--font-playfair",
  display: "swap",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
