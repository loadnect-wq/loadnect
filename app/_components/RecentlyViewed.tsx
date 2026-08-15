// Recently-viewed tracking helper.
//
// The visual "Recently Viewed" list was removed from the homepage when the home
// page switched to real DB-backed halls (the old list relied on MOCK_HALLS and
// could render demo data / dead slugs). This module now keeps ONLY the recorder,
// which the hall detail page calls to remember which real hall the user opened.
// A DB-backed recently-viewed UI can be reintroduced later if desired.

const KEY = "hallnect:recent";

/** Record a real hall id as recently viewed (most-recent first, capped at 8). */
export function recordRecentlyViewed(id: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(arr) ? arr.filter((v) => typeof v === "string") : [];
    const next = [id, ...list.filter((v) => v !== id)].slice(0, 8);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}
