// ─────────────────────────────────────────────────────────────────────────────
// lib/responsive-image.ts — "this image only at this screen size".
//
// The homepage renders two hero layouts in one HTML document — a photo card
// for phones (lg:hidden) and the scroll walk-through for desktops (hidden
// lg:block) — and each has its own LCP image. Hiding one with CSS does not stop
// the browser downloading it: an eager <img> is fetched even inside
// display:none. Both used to carry `priority`, which in Next 16 means a
// <link rel="preload"> in the head with no media condition, so EVERY visitor
// preloaded both (audit #19, SEO phase 6).
//
// The standard fix is art direction: wrap the image in a <picture> whose
// <source> matches the screen sizes the image is NOT shown at and points at a
// 1×1 placeholder. The browser picks the first matching source, so at those
// sizes it never requests the real file, and where the image IS shown it falls
// through to the <img> — which can then be eager with fetchPriority="high",
// the combination Next's docs recommend for the LCP image over `preload`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A 1×1 transparent GIF, for a <source> that means "no image at this size".
 * A data: URI, so choosing it costs no request at all.
 */
export const NO_IMAGE_SRCSET =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Tailwind's `lg` breakpoint (1024px), where the desktop tree takes over. */
export const LG_UP = "(min-width: 1024px)";

/** Exactly the screens LG_UP does not match — no gap or overlap at 1023.5px. */
export const BELOW_LG = "not all and (min-width: 1024px)";
