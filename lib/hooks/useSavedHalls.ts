"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "hallnect:saved";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
    window.dispatchEvent(new CustomEvent("hallnect:saved:change"));
  } catch { /* ignore */ }
}

export function useSavedHalls() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    setIds(read());
    function sync() { setIds(read()); }
    window.addEventListener("hallnect:saved:change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("hallnect:saved:change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const isSaved = useCallback((id: string) => ids.includes(id), [ids]);

  const toggle = useCallback((id: string) => {
    const current = read();
    const next = current.includes(id) ? current.filter((v) => v !== id) : [...current, id];
    write(next);
    setIds(next);
    return next.includes(id);
  }, []);

  return { ids, isSaved, toggle };
}
