// ─────────────────────────────────────────────────────────────────────────────
// Playfair Display ITALIC — its own font, loaded only where it is shown.
//
// It used to be the second face of `playfair` in site-fonts.ts, and that put a
// 38 KB high-priority preload in the head of EVERY page, competing with each
// page's main photo on a phone's connection. Exactly two things use it: the
// rotating word in the desktop homepage headline and the sign-in heading.
//
// So it lives in a module only those two import (Next scopes a font's CSS to
// the routes that import it), with `preload: false`: the browser fetches it
// when italic text actually renders. On a phone the homepage's italic word is
// in the desktop tree and never renders, so the file is never downloaded.
//
// Apply with `className={playfairItalic.className}` on the italic element
// itself. `font-serif italic` alone would now fall back to a slanted copy of
// the upright face.
// ─────────────────────────────────────────────────────────────────────────────

import localFont from "next/font/local";

export const playfairItalic = localFont({
  src: "./playfair-display/PlayfairDisplay-Italic-wght-latin.woff2",
  weight: "400 900",
  style: "italic",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
