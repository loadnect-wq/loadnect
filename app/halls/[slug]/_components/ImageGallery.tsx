"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The venue photo gallery.
//
// ═══ WHY DESKTOP LOOKS NOTHING LIKE MOBILE, DELIBERATELY ═════════════════════
//
// This used to be one full-bleed carousel at every width: `h-72 w-full sm:h-80
// lg:h-[420px]` with object-cover. On a phone that is a 375x288 box — aspect
// 1.30 — and it is genuinely good. On a 1920 monitor the same rules give a
// 1915x420 box, aspect 4.56, and that broke in two separate ways at once:
//
//   BLUR. Next's optimizer NEVER upscales past the source (verified: ask for
//   w=3840 on a 720x1280 photo and you get 720x1280 back). Venue owners upload
//   phone photos, so of the nine on the first real listing, five are 720-1360px
//   wide and four are PORTRAIT. Spreading a 720px-wide photo across 1915 CSS px
//   is a 2.66x upscale — 3.56x at 2560 — and no config value can fix that. The
//   only lever on blur is making the slot narrower than the source.
//
//   CROP. object-cover loses whatever does not match the box aspect, and a
//   9:16 portrait in a 4.56:1 box shows 12% OF ITS HEIGHT — a featureless
//   horizontal band with no subject in it. Measured average across the nine:
//   23% visible at 1920, 17% at 2560, against 76% on mobile.
//
// The arithmetic rules out the obvious fixes. To cover-fit a 9:16 photo you
// need a box aspect <= 0.5625, i.e. a 1963px-tall hero at this width; the set's
// median aspect is 1.03, so no landscape hero can cover-fit it. And ANY
// cover-fit box 1104px wide upscales a 720px photo by at least 1.53x. Fitting
// the photo inside the full-width box instead (object-contain) is sharp and
// loses nothing, but it paints a 349px strip of photo inside 1104px of flat
// backdrop — the whole photo, in a third of the frame, on grey. That is a
// different flavour of broken on a wedding venue's hero, not a fix.
//
// WHAT ACTUALLY WORKS IS SMALLER CELLS. Bound the gallery to the same
// container the page content already uses (lg:max-w-6xl lg:px-6 => 1104px) and
// lay the photos out as a mosaic: one 548px hero plus four 270px thumbs. Two
// things fall out of that:
//   - every cell is far narrower than the narrowest source, so all nine photos
//     DOWNSCALE at DPR 1 and DPR 2 — the blur is gone by construction, and it
//     stays gone at 2560 because the container is capped;
//   - the cells are SQUARE to within 2px, and a square is the fixed point of
//     the orientation problem: object-cover shows min(a, 1/a) of the long axis,
//     so a 9:16 portrait and a 16:9 landscape crop by the identical amount
//     (57% and 56%) instead of 12% vs 39%. Average visible rises to 71%, within
//     five points of the mobile figure.
// Five photos are on screen at once instead of one, which is also just a better
// way to look at a venue — and it is the pattern every major travel site uses,
// for these reasons.
//
// The residual crop is answered by the LIGHTBOX, which is object-contain: 100%
// of every photo, always, and the way photos 6..N stay reachable on desktop.
//
// MOBILE IS UNTOUCHED, and that claim is mechanically checkable rather than
// asserted: there is ONE DOM tree and every class added for desktop carries an
// `lg:` prefix, every desktop-only control is `hidden lg:*`, and the last clause
// of every `sizes` string is still a bare `100vw` — which is what Next's srcset
// generator reads, so the generated srcset is byte-identical to before. No tap
// handler is introduced below lg, so the native scroll-snap swipe is exactly
// what it was. Tablet (640-1023) is also left exactly as it was; improving it
// is a height-only change and belongs in its own decision.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import { CARD_GRADIENTS } from "@/lib/mock-data";
import { type HallImage } from "@/lib/halls";

interface Props {
  /** Venue city — makes each photo's alt text specific and locally relevant. */
  hallCity?: string;
  images:   HallImage[];
  hallName: string;
  hallId:   string;
}

function gradientForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return CARD_GRADIENTS[Math.abs(hash) % CARD_GRADIENTS.length];
}

/** The mobile box, shared by the carousel and the empty state so they cannot
 *  drift apart. Everything after `sm:h-80` is desktop-only. */
const MOBILE_BOX = "relative h-72 w-full overflow-hidden sm:h-80";

/**
 * Desktop mosaic shape, by photo count.
 *
 * The cell arithmetic, for the record, at the container's 1104px inner width
 * (max-w-6xl = 1152px minus 2 x px-6 = 48px) with gap-2 = 8px:
 *   5+ photos — aspect-[2/1]  -> block 1104x552; cols (1104-24)/4 = 270,
 *               rows (552-8)/2 = 272. Hero spans 2x2 = 548x552. Cells ~square.
 *   3-4       — aspect-[3/2]  -> block 1104x736; cols (1104-16)/3 = 363,
 *               rows (736-8)/2 = 364. Hero 733x736.
 *   2         — aspect-[2/1], one row of two 548x552 cells.
 *   1         — a single 3:2 cell capped at 828px, which is a Next deviceSize
 *               so the request lands exactly on a candidate.
 * `visible` is how many cells the grid has; the rest stay in the DOM for the
 * mobile carousel and the lightbox, hidden at lg with `display:none`.
 */
function mosaic(total: number): { block: string; track: string; visible: number } {
  if (total >= 5) {
    return {
      block:   "lg:h-auto lg:aspect-[2/1] lg:rounded-2xl",
      track:   "lg:grid lg:grid-cols-4 lg:grid-rows-2 lg:gap-2",
      visible: 5,
    };
  }
  if (total >= 3) {
    return {
      block:   "lg:h-auto lg:aspect-[3/2] lg:rounded-2xl",
      track:   "lg:grid lg:grid-cols-3 lg:grid-rows-2 lg:gap-2",
      visible: 3,
    };
  }
  if (total === 2) {
    return {
      block:   "lg:h-auto lg:aspect-[2/1] lg:rounded-2xl",
      track:   "lg:grid lg:grid-cols-2 lg:grid-rows-1 lg:gap-2",
      visible: 2,
    };
  }
  return {
    block:   "lg:h-auto lg:aspect-[3/2] lg:max-w-[828px] lg:rounded-2xl",
    track:   "lg:grid lg:grid-cols-1 lg:grid-rows-1",
    visible: 1,
  };
}

/**
 * `sizes` per cell — and the one trap in here is worth spelling out, because
 * getting it wrong makes the page BLURRIER THAN BEFORE.
 *
 * WITH object-cover, A CELL'S WIDTH IS NOT WHAT IT NEEDS. Cover scales the
 * photo until it covers both axes: s = max(cellW/w, cellH/h). For a LANDSCAPE
 * photo in a near-square cell the HEIGHT term wins, so the photo is painted
 * much wider than the cell and the overflow is clipped. The painted width —
 * which is what actually has to be sharp — is cellH x photoAspect.
 *
 * Concretely, for the 548x552 hero cell and the 16:9 cover photo:
 *     s = max(548/1600, 552/900) = max(0.343, 0.613) = 0.613   (height-bound)
 *     painted width = 1600 x 0.613 = 981px, not 548px
 * Declaring `548px` therefore makes the browser pick the 640-wide candidate,
 * the optimizer returns 640x360, and cover then blows that up by 1.53x — worse
 * than the 1.20x this whole change exists to remove. Verified by arithmetic
 * against all nine real photos.
 *
 * SO EACH VALUE BELOW IS cellHeight x 16/9, ROUNDED UP — the widest aspect a
 * venue photo realistically arrives in. Declaring more than the element's own
 * width looks wrong and is right. Measured result at DPR 1: worst scale across
 * the nine real photos is 0.91x in the hero and 0.76x in a thumb, i.e. every
 * photo downscales. (Declaring the width instead gave 1.53x.) A panorama wider
 * than 16:9 would be slightly soft; nothing in the inventory is.
 *
 * A FLAT PIXEL VALUE, not a vw expression, for everything from 1024 up. Above
 * 1152 the container is pinned so the cell really is constant; between 1024 and
 * 1151 it is 12% narrower at most, which lands on the same srcset candidate, so
 * a calc() would add precision the candidate list cannot spend. A constant also
 * avoids the error `100vw` carries — it ignores the scrollbar, and a 1920
 * viewport measured a 1915px layout.
 *
 * THE TRAILING `100vw` IS LOAD-BEARING. Next's srcset generator scans `sizes`
 * for vw tokens; finding `100vw` it filters candidates to >= 640, which is
 * exactly the list today's `sizes="100vw"` produces. Keeping it is what makes
 * the MOBILE srcset byte-identical, so this change cannot alter what a phone
 * downloads. It also means a 270px thumb's floor is the 640 candidate — a
 * DPR-1 over-sample, and almost exactly the 540 device pixels it needs at
 * DPR 2, so it is the right file for most real desktop displays anyway.
 */
/** 548x552 hero cell, 5+ photos. 552 x 16/9 = 981 -> 1000. */
const SIZES_HERO  = "(min-width: 1024px) 1000px, 100vw";
/** 270x272 thumb. 272 x 16/9 = 484 -> 500. */
const SIZES_THUMB = "(min-width: 1024px) 500px, 100vw";
/** 733x736 hero cell, 3-4 photos. 736 x 16/9 = 1309 -> 1320. */
const SIZES_WIDE  = "(min-width: 1024px) 1320px, 100vw";
/** 363x364 thumb, 3-4 photos. 364 x 16/9 = 647 -> 660. */
const SIZES_WIDE_THUMB = "(min-width: 1024px) 660px, 100vw";
/** Single photo: an 828x552 cell. 552 x 16/9 = 981 -> 1000. */
const SIZES_SOLO  = "(min-width: 1024px) 1000px, 100vw";
/** The lightbox stage is object-CONTAIN, and contain never paints wider than
 *  the box — so here the box width really is the requirement. Capped at
 *  1100px; the optimizer clamps to the source, so a 720px portrait quietly
 *  returns its own 720 and over-declaring costs nothing. */
const SIZES_STAGE = "(min-width: 1024px) 1100px, 100vw";

export function ImageGallery({ images, hallName, hallCity, hallId }: Props) {
  const [current, setCurrent] = useState(0);
  /** Index the lightbox is showing, or null when it is closed. */
  const [lightbox, setLightbox] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /** What had focus before the lightbox opened, so Escape can give it back. */
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const total = images.length;

  function altFor(img: HallImage, i: number) {
    if (img.alt_text?.trim()) return img.alt_text;
    return i === 0
      ? `${hallName}, a wedding hall in ${hallCity ?? "Tamil Nadu"}`
      : `${hallName} in ${hallCity ?? "Tamil Nadu"} — photo ${i + 1}`;
  }

  // Scroll the native snap track to a slide index (drives momentum swipe on
  // touch AND the arrow/dot controls from one source of truth).
  //
  // NOTE FOR ANYONE TOUCHING THE LAYOUT: this maths is exact only while one
  // slide equals one track clientWidth. The desktop width cap therefore lives
  // on the WRAPPER in HallDetailView, never as padding inside this track — and
  // at lg the track is display:grid and does not scroll at all, so `current`
  // simply stops being consulted there.
  function goTo(index: number) {
    const track = trackRef.current;
    if (!track) return;
    const clamped = (index + total) % total;
    track.scrollTo({ left: clamped * track.clientWidth, behavior: "smooth" });
    setCurrent(clamped);
  }

  // Keep `current` in sync while the user swipes/drags the track.
  function onScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const idx = Math.round(track.scrollLeft / track.clientWidth);
    if (idx !== current) setCurrent(idx);
  }

  const openLightbox = useCallback((index: number) => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setLightbox(index);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightbox(null);
    // Put focus back where it was, so a keyboard user is not dumped at the top
    // of the document.
    returnFocusRef.current?.focus?.();
  }, []);

  const stepLightbox = useCallback((delta: number) => {
    setLightbox((at) => (at == null ? at : (at + delta + total) % total));
  }, [total]);

  // Escape closes, arrows navigate, and the page behind does not scroll.
  useEffect(() => {
    if (lightbox == null) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape")     { e.preventDefault(); closeLightbox(); }
      if (e.key === "ArrowRight") { e.preventDefault(); stepLightbox(1); }
      if (e.key === "ArrowLeft")  { e.preventDefault(); stepLightbox(-1); }
    }
    window.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightbox, closeLightbox, stepLightbox]);

  // Keep the lightbox's own snap track on the selected photo.
  useEffect(() => {
    if (lightbox == null) return;
    const stage = stageRef.current;
    if (!stage) return;
    stage.scrollTo({ left: lightbox * stage.clientWidth, behavior: "auto" });
  }, [lightbox]);

  // Empty state — brand gradient, no carousel. Same box as the real thing at
  // every breakpoint, or the two would disagree on desktop.
  if (total === 0) {
    return (
      <div className={`${MOBILE_BOX} lg:h-auto lg:aspect-[2/1] lg:rounded-2xl`}>
        <div className="absolute inset-0" style={{ background: gradientForId(hallId) }} aria-label={`${hallName} venue`} />
        <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/50 lg:hidden" />
      </div>
    );
  }

  const shape = mosaic(total);

  return (
    <>
      <div className={`${MOBILE_BOX} ${shape.block}`}>
        {/* Swipeable track on mobile; a CSS grid at lg. One element's
            display property is the whole switch between the two layouts. */}
        <div
          ref={trackRef}
          onScroll={onScroll}
          className={`no-scrollbar flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth lg:snap-none lg:overflow-hidden ${shape.track}`}
          aria-roledescription="carousel"
          aria-label={`${hallName} photos`}
        >
          {images.map((img, i) => {
            const isHero  = i === 0 && total >= 2;
            const hidden  = i >= shape.visible;
            // Cell geometry differs per count ladder, so `sizes` has to as
            // well — a 3-photo layout's thumb is 363px wide, not 270px.
            const sizes   = total === 1  ? SIZES_SOLO
                          : isHero       ? (total >= 5 ? SIZES_HERO : total >= 3 ? SIZES_WIDE : SIZES_HERO)
                          : total >= 5   ? SIZES_THUMB
                          : total >= 3   ? SIZES_WIDE_THUMB
                          :                SIZES_HERO;
            return (
              <div
                key={`${img.url}-${i}`}
                className={[
                  "relative h-full w-full shrink-0 snap-center lg:h-auto lg:w-auto",
                  isHero && total >= 3 ? "lg:col-span-2 lg:row-span-2" : "",
                  hidden ? "lg:hidden" : "",
                  i > 0 ? "lg:overflow-hidden lg:rounded-lg" : "",
                ].join(" ")}
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${total}`}
              >
                <Image
                  src={img.url}
                  alt={altFor(img, i)}
                  fill
                  sizes={sizes}
                  className="object-cover"
                  priority={i === 0}
                />
                {/* DESKTOP-ONLY click target, as an overlay button rather than a
                    handler on the cell. `hidden lg:block` means it does not
                    exist on mobile — not rendered, not focusable, not
                    announced — so a tap still reaches the scroll track and the
                    swipe behaves exactly as it does today. */}
                <button
                  type="button"
                  onClick={() => openLightbox(i)}
                  aria-label={`Open photo ${i + 1} of ${total} full size`}
                  className="absolute inset-0 hidden cursor-zoom-in lg:block"
                />
              </div>
            );
          })}
        </div>

        {/* Gradient overlay. Mobile only: it exists to keep the white overlay
            controls legible over a photo, and on desktop those controls sit on
            their own white pills. pointer-events-none so it never blocks the
            swipe. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/50 lg:hidden" />

        {/* Prev / Next — 44px hit area. Mobile and tablet only: at lg the track
            is a grid with nothing to scroll. */}
        {total > 1 && (
          <>
            <button
              type="button"
              onClick={() => goTo(current - 1)}
              aria-label="Previous image"
              className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition active:scale-95 motion-reduce:active:scale-100 lg:hidden"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => goTo(current + 1)}
              aria-label="Next image"
              className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition active:scale-95 motion-reduce:active:scale-100 lg:hidden"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}

        {/* Counter pill — mobile only; on desktop the grid shows where you are. */}
        {total > 1 && (
          <div className="pointer-events-none absolute bottom-4 right-4 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white lg:hidden">
            {current + 1} / {total}
          </div>
        )}

        {/* Dot indicators (≤6 images) — 44px tap area via padding, small visual dot */}
        {total > 1 && total <= 6 && (
          <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center lg:hidden">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Go to image ${i + 1}`}
                className="flex h-11 w-6 items-center justify-center active:scale-95 motion-reduce:active:scale-100 lg:hidden"
              >
                <span
                  className={`h-1.5 rounded-full transition-all ${i === current ? "w-4 bg-white" : "w-1.5 bg-white/50"}`}
                />
              </button>
            ))}
          </div>
        )}

        {/* "Show all N photos" — the only way to reach photos beyond the
            mosaic's cells on desktop, so it is not decoration. */}
        {total > shape.visible && (
          <button
            type="button"
            onClick={() => openLightbox(0)}
            className="absolute bottom-3 right-3 hidden h-11 items-center gap-2 rounded-full bg-white/95 px-4 text-sm font-semibold text-charcoal-800 shadow-card backdrop-blur-sm transition hover:bg-white lg:flex"
          >
            <Expand className="h-4 w-4" aria-hidden />
            Show all {total} photos
          </button>
        )}
      </div>

      {/* ── Lightbox ────────────────────────────────────────────────────────
          object-contain, so this is where 100% of every photo is visible —
          the real answer to a portrait shot that the mosaic necessarily crops.
          It reuses the same native scroll-snap track as the gallery rather
          than introducing a second interaction model. */}
      {lightbox != null && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-charcoal-950/95 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`${hallName} photos`}
        >
          <div className="flex items-center justify-between px-4 py-3 text-ivory-100">
            <span className="text-sm font-semibold">
              {lightbox + 1} / {total}
            </span>
            <button
              ref={closeRef}
              type="button"
              onClick={closeLightbox}
              aria-label="Close photo viewer"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div
            ref={stageRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.clientWidth === 0) return;
              const idx = Math.round(el.scrollLeft / el.clientWidth);
              if (idx !== lightbox) setLightbox(idx);
            }}
            className="no-scrollbar flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
          >
            {images.map((img, i) => (
              <div key={`lb-${img.url}-${i}`} className="relative h-full w-full shrink-0 snap-center">
                <Image
                  src={img.url}
                  alt={altFor(img, i)}
                  fill
                  sizes={SIZES_STAGE}
                  className="object-contain"
                />
              </div>
            ))}
          </div>

          {total > 1 && (
            <>
              <button
                type="button"
                onClick={() => stepLightbox(-1)}
                aria-label="Previous image"
                className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => stepLightbox(1)}
                aria-label="Next image"
                className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
