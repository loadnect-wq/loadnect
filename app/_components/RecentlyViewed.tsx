"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, MapPin } from "lucide-react";
import type { MockHall } from "@/lib/mock-data";
import { CARD_GRADIENTS, formatPrice } from "@/lib/mock-data";

const KEY = "hallnect:recent";

export function RecentlyViewed({ allHalls }: { allHalls: MockHall[] }) {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) setIds(arr.filter((v) => typeof v === "string"));
    } catch { /* ignore */ }
  }, []);

  const halls = ids
    .map((id) => allHalls.find((h) => h.id === id))
    .filter((h): h is MockHall => Boolean(h))
    .slice(0, 4);

  if (halls.length === 0) return null;

  return (
    <div>
      <div className="container-app mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 font-serif text-lg font-semibold text-charcoal-900">
          <Clock className="h-4 w-4 text-maroon-500" />
          Recently Viewed
        </h2>
      </div>
      <div className="container-app space-y-2.5">
        {halls.map((hall) => {
          const gradient = CARD_GRADIENTS[hall.gradientIndex % CARD_GRADIENTS.length];
          return (
            <Link
              key={hall.id}
              href={`/halls/${hall.slug}`}
              className="flex items-center gap-3 rounded-2xl bg-white p-2.5 shadow-card transition-transform active:scale-[0.99]"
            >
              <div
                className="h-16 w-16 shrink-0 rounded-xl"
                style={{ background: gradient }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 font-serif text-sm font-semibold text-charcoal-900">{hall.name}</p>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-charcoal-500">
                  <MapPin className="h-3 w-3" />
                  {hall.city}
                </p>
                <p className="mt-0.5 text-xs font-bold text-maroon-700">{formatPrice(hall.pricePerDay)}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function recordRecentlyViewed(id: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(arr) ? arr.filter((v) => typeof v === "string") : [];
    const next = [id, ...list.filter((v) => v !== id)].slice(0, 8);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}
