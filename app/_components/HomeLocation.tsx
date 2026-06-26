"use client";

import { useEffect, useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { BottomSheet } from "@/components/app/BottomSheet";
import { CITIES } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const KEY = "hallnect:city";

export function HomeLocation() {
  const [city, setCity] = useState<string>("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored) setCity(stored);
      else setCity("Mumbai");
    } catch { setCity("Mumbai"); }
  }, []);

  function selectCity(name: string) {
    setCity(name);
    try { localStorage.setItem(KEY, name); } catch { /* ignore */ }
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-charcoal-700"
      >
        <MapPin className="h-4 w-4 text-maroon-500" />
        <span>{city || "Choose city"}</span>
        <ChevronDown className="h-3.5 w-3.5 text-charcoal-500" />
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Select City">
        <ul className="grid grid-cols-2 gap-2 pb-4">
          {CITIES.map((c) => (
            <li key={c}>
              <button
                type="button"
                onClick={() => selectCity(c)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm",
                  c === city
                    ? "border-maroon-500 bg-maroon-50 font-semibold text-maroon-700"
                    : "border-border bg-white text-charcoal-800",
                )}
              >
                <MapPin className={cn("h-4 w-4", c === city ? "text-maroon-600" : "text-charcoal-400")} />
                {c}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  );
}
