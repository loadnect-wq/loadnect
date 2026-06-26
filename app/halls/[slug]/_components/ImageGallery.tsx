"use client";

import { useState } from "react";
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
  const total = images.length;

  const prev = () => setCurrent((c) => (c - 1 + total) % total);
  const next = () => setCurrent((c) => (c + 1) % total);

  return (
    <div className="relative h-72 w-full overflow-hidden sm:h-80 lg:h-[420px]">
      {total > 0 ? (
        <Image
          src={images[current].url}
          alt={images[current].alt_text ?? hallName}
          fill
          sizes="100vw"
          className="object-cover"
          unoptimized
          priority
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: gradientForId(hallId) }}
          aria-label={`${hallName} venue`}
        />
      )}

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/50" />

      {/* Prev / Next buttons */}
      {total > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Previous image"
            className="absolute left-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition active:scale-95"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next image"
            className="absolute right-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition active:scale-95"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}

      {/* Counter pill */}
      {total > 1 && (
        <div className="absolute bottom-4 right-4 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white">
          {current + 1} / {total}
        </div>
      )}

      {/* Dot indicators (mobile, ≤6 images) */}
      {total > 1 && total <= 6 && (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setCurrent(i)}
              aria-label={`Image ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === current ? "w-4 bg-white" : "w-1.5 bg-white/50"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
