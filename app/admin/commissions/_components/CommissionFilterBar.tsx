"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarDays, Users, X } from "lucide-react";

type Owner = { id: string; business_name: string };

type Initial = { status: string; owner: string; from: string; to: string };

export function CommissionFilterBar({
  owners,
  initial,
}: {
  owners:  Owner[];
  initial: Initial;
}) {
  const router = useRouter();
  const [owner, setOwner] = useState(initial.owner);
  const [from,  setFrom]  = useState(initial.from);
  const [to,    setTo]    = useState(initial.to);
  const [pending, startTransition] = useTransition();

  function apply() {
    const qs = new URLSearchParams();
    if (initial.status && initial.status !== "all") qs.set("status", initial.status);
    if (owner) qs.set("owner", owner);
    if (from)  qs.set("from",  from);
    if (to)    qs.set("to",    to);
    const q = qs.toString();
    startTransition(() => {
      router.push(q ? `?${q}` : "?");
    });
  }

  function reset() {
    setOwner(""); setFrom(""); setTo("");
    startTransition(() => router.push("?"));
  }

  const dirty = owner !== "" || from !== "" || to !== "";

  return (
    <div className="rounded-2xl bg-white p-3 shadow-card">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        {/* Owner */}
        <label className="flex flex-col gap-1">
          <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
            <Users className="h-3 w-3" /> Owner
          </span>
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
          >
            <option value="">All owners</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>{o.business_name}</option>
            ))}
          </select>
        </label>

        {/* From */}
        <label className="flex flex-col gap-1">
          <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
            <CalendarDays className="h-3 w-3" /> From
          </span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
          />
        </label>

        {/* To */}
        <label className="flex flex-col gap-1">
          <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
            <CalendarDays className="h-3 w-3" /> To
          </span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
          />
        </label>

        {/* Actions */}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={apply}
            disabled={pending}
            className="flex-1 rounded-lg bg-maroon-600 px-3 py-2 text-xs font-semibold text-white hover:bg-maroon-700 disabled:opacity-60"
          >
            {pending ? "…" : "Apply"}
          </button>
          {dirty && (
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="rounded-lg border border-border bg-white px-2.5 py-2 text-xs text-charcoal-600 hover:bg-ivory-100 disabled:opacity-60"
              aria-label="Clear filters"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
