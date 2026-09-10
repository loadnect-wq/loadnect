import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// The cron schedule, pinned.
//
// WHY THIS TEST EXISTS. Two sweeps were once scheduled onto the same minute —
// `*/15` and `30 3,7,11` both fire at :30 — and the collision was found in
// production logs (07:30:11 and 07:30:27 on the same day), racing each other on
// payments.split_status. Nothing in the repo would have caught it: vercel.json
// is data, and data with no test is data that drifts.
//
// This asserts the property that actually matters — no two crons can fire in
// the same minute of the same hour — rather than restating the current values,
// so it keeps working when a schedule legitimately changes.
// ─────────────────────────────────────────────────────────────────────────────

type Cron = { path: string; schedule: string };

const vercelJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../vercel.json"), "utf8"),
) as { crons?: Cron[] };

/** Expands the minute and hour fields of a 5-field cron into concrete values. */
function expand(field: string, min: number, max: number): number[] {
  if (field === "*") {
    const out: number[] = [];
    for (let i = min; i <= max; i++) out.push(i);
    return out;
  }
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const stepMatch = /^(\*|\d+(?:-\d+)?)\/(\d+)$/.exec(part);
    if (stepMatch) {
      const [, range, stepRaw] = stepMatch;
      const step = Number(stepRaw);
      const [lo, hi] = range === "*"
        ? [min, max]
        : range.includes("-")
          ? range.split("-").map(Number)
          : [Number(range), max];
      for (let i = lo; i <= hi; i += step) out.add(i);
      continue;
    }
    if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      for (let i = lo; i <= hi; i++) out.add(i);
      continue;
    }
    out.add(Number(part));
  }
  return [...out];
}

/** Every (hour, minute) at which this schedule fires, as "HH:MM". */
function firingTimes(schedule: string): string[] {
  const [minute, hour] = schedule.trim().split(/\s+/);
  const times: string[] = [];
  for (const h of expand(hour, 0, 23)) {
    for (const m of expand(minute, 0, 59)) {
      times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return times;
}

describe("vercel.json crons", () => {
  const crons = vercelJson.crons ?? [];

  it("declares at least the four sweeps the app depends on", () => {
    const paths = crons.map((c) => c.path);
    expect(paths).toContain("/api/admin/bookings/expire-overdue");
    expect(paths).toContain("/api/admin/premium/expire-listings");
    expect(paths).toContain("/api/admin/payouts/reconcile");
    expect(paths).toContain("/api/admin/leads/expire-stale");
  });

  it("every schedule is a well-formed 5-field cron", () => {
    for (const c of crons) {
      expect(c.schedule.trim().split(/\s+/), `${c.path}: ${c.schedule}`).toHaveLength(5);
    }
  });

  it("NO TWO CRONS EVER FIRE IN THE SAME MINUTE", () => {
    // The regression this file exists for. A collision is not a style problem:
    // two sweeps running concurrently raced on the same payment rows.
    const seen = new Map<string, string>();
    const collisions: string[] = [];

    for (const c of crons) {
      for (const t of firingTimes(c.schedule)) {
        const already = seen.get(t);
        if (already && already !== c.path) {
          collisions.push(`${t} — ${already} and ${c.path}`);
        } else {
          seen.set(t, c.path);
        }
      }
    }

    expect(collisions, `crons sharing a minute:\n${collisions.join("\n")}`).toEqual([]);
  });

  it("each cron path resolves to a route file that exists", () => {
    // A cron pointing at a deleted route is a silent no-op: Vercel calls it,
    // gets a 404, and nothing sweeps until someone reads the logs.
    for (const c of crons) {
      const routeFile = path.resolve(__dirname, "../../app", `.${c.path}`, "route.ts");
      expect(fs.existsSync(routeFile), `missing route for ${c.path}`).toBe(true);
    }
  });

  it("the expander handles the step syntax that caused the original collision", () => {
    // */15 fires at :00 :15 :30 :45 — which is how it met "30 3,7,11" at :30.
    expect(expand("*/15", 0, 59)).toEqual([0, 15, 30, 45]);
    expect(expand("5,20,35,50", 0, 59)).toEqual([5, 20, 35, 50]);
    expect(expand("3,7,11", 0, 23)).toEqual([3, 7, 11]);
    expect(firingTimes("30 3,7,11 * * *")).toEqual(["03:30", "07:30", "11:30"]);
  });
});
