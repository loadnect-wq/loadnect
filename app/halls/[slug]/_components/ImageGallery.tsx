"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CARD_GRADIENTS } from "@/lib/mock-data";
import { type HallImage } from "@/lib/halls";

interface Props {
  images:   HallImage[];
  hallName: string;
  hallId:   string;
}

function gradientForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return CARD_GRADIENTS[Math.abs(hash) % CARD_GRADIENTS.length];
}

export function ImageGallery({ images, hallName, hallId }: Props) {
  const [current, setCurrent] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const total = images.length;

  // Scroll the native snap track to a slide index (drives momentum swipe on
  // touch AND the arrow/dot controls on desktop from one source of truth).
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

  // Empty state — brand gradient, no carousel.
  if (total === 0) {
    return (
      <div className="relative h-72 w-full overflow-hidden sm:h-80 lg:h-[420px]">
        <div className="absolute inset-0" style={{ background: gradientForId(hallId) }} aria-label={`${hallName} venue`} />
        <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/50" />
      </div>
    );
  }

  return (
    <div className="relative h-72 w-full overflow-hidden sm:h-80 lg:h-[420px]">
      {/* Swipeable track — native scroll-snap gives real touch/momentum swipe. */}
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="no-scrollbar flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth"
        aria-roledescription="carousel"
        aria-label={`${hallName} photos`}
      >
        {images.map((img, i) => (
          <div
            key={`${img.url}-${i}`}
            className="relative h-full w-full shrink-0 snap-center"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${total}`}
          >
            <Image
              src={img.url}
              alt={img.alt_text ?? hallName}
              fill
              sizes="100vw"
              className="object-cover"
              unoptimized
              priority={i === 0}
            />
          </div>
        ))}
      </div>

      {/* Gradient overlay (pointer-events-none so it never blocks the swipe) */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/50" />

      {/* Prev / Next — 44px hit area; primarily for desktop / accessibility */}
      {total > 1 && (
        <>
          <button
            type="button"
            onClick={() => goTo(current - 1)}
            aria-label="Previous image"
            className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition active:scale-95 motion-reduce:active:scale-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => goTo(current + 1)}
            aria-label="Next image"
            className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition active:scale-95 motion-reduce:active:scale-100"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {/* Counter pill */}
      {total > 1 && (
        <div className="pointer-events-none absolute bottom-4 right-4 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white">
          {current + 1} / {total}
        </div>
      )}

      {/* Dot indicators (≤6 images) — 44px tap area via padding, small visual dot */}
      {total > 1 && total <= 6 && (
        <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Go to image ${i + 1}`}
              className="flex h-11 w-6 items-center justify-center active:scale-95 motion-reduce:active:scale-100"
            >
              <span
                className={`h-1.5 rounded-full transition-all ${i === current ? "w-4 bg-white" : "w-1.5 bg-white/50"}`}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
