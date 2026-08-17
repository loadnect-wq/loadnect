"use client";

import { todayInBusinessTz, addDaysToIsoDate } from "@/lib/dates";
import { useMemo, useState, useTransition } from "react";
import { Megaphone, ExternalLink } from "lucide-react";
import { createAdvertisement } from "../../actions";
import { AD_PLACEMENTS } from "@/lib/ads";

function todayIso() {
  return todayInBusinessTz();
}
function plusDays(iso: string, days: number) {
  return addDaysToIsoDate(iso, days);
}

// Client-side mirror of the server URL validator. Server still re-validates;
// this just gates the preview and gives instant feedback.
function isSafeHttpUrl(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (/^\s*(javascript|data|vbscript|file):/i.test(t)) return false;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function CreateAdForm() {
  const start = todayIso();
  const [title, setTitle]                = useState("");
  const [advertiser, setAdvertiser]      = useState("");
  const [imageUrl, setImageUrl]          = useState("");
  const [targetUrl, setTargetUrl]        = useState("");
  const [placement, setPlacement]        = useState(AD_PLACEMENTS[0].value);
  const [startDate, setStartDate]        = useState(start);
  const [endDate, setEndDate]            = useState(plusDays(start, 30));
  const [status, setStatus]              = useState<"active" | "pending" | "paused">("active");
  const [msg, setMsg]   = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition]       = useTransition();

  const safeImage = useMemo(() => (isSafeHttpUrl(imageUrl) ? imageUrl.trim() : null), [imageUrl]);
  const safeTarget = useMemo(() => (isSafeHttpUrl(targetUrl) ? targetUrl.trim() : null), [targetUrl]);

  function reset() {
    setTitle(""); setAdvertiser(""); setImageUrl(""); setTargetUrl("");
    setPlacement(AD_PLACEMENTS[0].value);
    setStartDate(start); setEndDate(plusDays(start, 30));
    setStatus("active");
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    if (!title.trim())          { setMsg({ ok: false, text: "Title is required." }); return; }
    if (!advertiser.trim())     { setMsg({ ok: false, text: "Advertiser name is required." }); return; }
    if (!safeImage)             { setMsg({ ok: false, text: "Image URL must be a valid http(s) URL." }); return; }
    if (!safeTarget)            { setMsg({ ok: false, text: "Target URL must be a valid http(s) URL." }); return; }
    if (endDate && startDate && endDate < startDate) {
      setMsg({ ok: false, text: "End date must be after start date." }); return;
    }

    startTransition(async () => {
      const r = await createAdvertisement({
        title,
        advertiserName: advertiser,
        imageUrl,
        targetUrl,
        placement,
        startDate,
        endDate,
        status,
      });
      if ("error" in r) setMsg({ ok: false, text: r.error });
      else { setMsg({ ok: true, text: "Ad created." }); reset(); }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-4 shadow-card space-y-3">
      <div className="flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-maroon-700" />
        <h3 className="font-serif text-sm font-semibold text-charcoal-900">Create advertisement</h3>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Title</span>
          <input
            type="text" maxLength={200}
            value={title} onChange={(e) => setTitle(e.target.value)}
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Advertiser name</span>
          <input
            type="text" maxLength={120}
            value={advertiser} onChange={(e) => setAdvertiser(e.target.value)}
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Placement</span>
          <select
            value={placement}
            onChange={(e) => setPlacement(e.target.value as typeof placement)}
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
          >
            {AD_PLACEMENTS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Image URL</span>
          <input
            type="url" maxLength={2048}
            value={imageUrl} onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://…"
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
            required
          />
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Target URL</span>
          <input
            type="url" maxLength={2048}
            value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://…"
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Start date</span>
          <input
            type="date"
            value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">End date</span>
          <input
            type="date"
            value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Initial status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
          >
            <option value="active">Active (live)</option>
            <option value="pending">Pending</option>
            <option value="paused">Paused</option>
          </select>
        </label>
      </div>

      {/* Live preview */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Preview</p>
        <div className="rounded-xl border border-dashed border-border bg-ivory-50 p-3">
          {safeImage ? (
            <a
              href={safeTarget ?? "#"}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="block overflow-hidden rounded-lg border border-border bg-white"
              onClick={(e) => { if (!safeTarget) e.preventDefault(); }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={safeImage} alt="" className="h-32 w-full object-cover" />
              <div className="flex items-center justify-between gap-2 p-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-charcoal-900">{title || "Ad title"}</p>
                  <p className="truncate text-[11px] text-charcoal-500">{advertiser || "Advertiser"}</p>
                </div>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-charcoal-400" />
              </div>
            </a>
          ) : (
            <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-white text-xs text-charcoal-400">
              Add a valid image URL to preview
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-charcoal-500">URLs are validated server-side; only http(s) is accepted.</p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-maroon-600 px-4 py-2 text-xs font-semibold text-white hover:bg-maroon-700 disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create ad"}
        </button>
      </div>

      {msg && (
        <p className={`text-[11px] font-semibold ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}
    </form>
  );
}
