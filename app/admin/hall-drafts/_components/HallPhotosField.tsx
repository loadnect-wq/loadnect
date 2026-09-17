"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Hall Photos — pick, preview, order, choose the cover, remove.
//
// A controlled field: it edits a DraftPhoto[] and uploads nothing itself. The
// owning form decides when to save (commitDraftPhotos), so the Add a Hall form
// keeps its one "Save listing" button and there is no second save system.
//
// Picking: click, drag files onto the box, or the phone's own picker (the same
// input). Each file is checked by its bytes and resized in the browser if
// large (lib/prepare-hall-photo.ts) before it is even shown.
//
// Ordering: drag a tile onto another on desktop, or the arrow buttons — which
// also work by keyboard and on touch screens, where HTML drag-and-drop does not.
// The first photo is the cover; "Make cover" moves a photo to the front.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, ImagePlus, Loader2, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_DRAFT_PHOTOS } from "@/lib/hall-draft-photos";
import { PhotoRejected, prepareHallPhoto } from "@/lib/prepare-hall-photo";
import { revokePreview, type DraftPhoto } from "./draft-photos";

type Props = {
  photos: DraftPhoto[];
  onChange: (fn: (prev: DraftPhoto[]) => DraftPhoto[]) => void;
  disabled?: boolean;
  /** Shown under the heading. */
  description?: string;
};

const ACCEPT = "image/jpeg,image/png,image/webp";

export function HallPhotosField({
  photos,
  onChange,
  disabled = false,
  description = "Add high-quality photos of this hall. The owner can update them after claiming the listing.",
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(0);
  const [notices, setNotices] = useState<string[]>([]);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);

  // Revoke every object URL this field created when it goes away.
  const latest = useRef(photos);
  useEffect(() => {
    latest.current = photos;
  }, [photos]);
  useEffect(() => () => latest.current.forEach(revokePreview), []);

  const remaining = MAX_DRAFT_PHOTOS - photos.length;
  const busy = disabled || preparing > 0;

  async function addFiles(list: FileList | File[]) {
    const files = Array.from(list);
    if (files.length === 0) return;
    const messages: string[] = [];

    const known = new Set(photos.map((p) => p.fingerprint).filter(Boolean));
    const fresh: File[] = [];
    for (const f of files) {
      const fp = `${f.name}|${f.size}|${f.lastModified}`;
      if (known.has(fp)) {
        messages.push(`${f.name} — already added.`);
        continue;
      }
      known.add(fp);
      fresh.push(f);
    }

    const room = Math.max(0, remaining);
    if (fresh.length > room) {
      messages.push(
        room === 0
          ? `A listing can have up to ${MAX_DRAFT_PHOTOS} photos. Remove one to add another.`
          : `Only ${room} more photo${room === 1 ? "" : "s"} can be added (up to ${MAX_DRAFT_PHOTOS}). ${fresh.length - room} not added.`,
      );
    }
    const accepted = fresh.slice(0, room);

    setPreparing((n) => n + accepted.length);
    const results = await Promise.all(
      accepted.map(async (file) => {
        try {
          const prepared = await prepareHallPhoto(file);
          return { file, prepared };
        } catch (e) {
          messages.push(`${file.name} — ${e instanceof PhotoRejected ? e.message : "could not be read."}`);
          return null;
        } finally {
          setPreparing((n) => n - 1);
        }
      }),
    );

    const additions: DraftPhoto[] = results.flatMap((r) =>
      r
        ? [{
            key: crypto.randomUUID(),
            previewUrl: URL.createObjectURL(r.prepared.blob),
            ownsPreview: true,
            name: r.file.name,
            storagePath: null,
            blob: r.prepared.blob,
            type: r.prepared.type,
            fingerprint: `${r.file.name}|${r.file.size}|${r.file.lastModified}`,
            status: "pending" as const,
            progress: 0,
            error: null,
          }]
        : [],
    );

    if (additions.length > 0) {
      onChange((prev) => {
        const space = MAX_DRAFT_PHOTOS - prev.length;
        const kept = additions.slice(0, Math.max(0, space));
        additions.slice(kept.length).forEach(revokePreview);
        return [...prev, ...kept];
      });
    }
    setNotices(messages);
  }

  const move = (from: number, to: number) =>
    onChange((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });

  const remove = (key: string) =>
    onChange((prev) => {
      const gone = prev.find((p) => p.key === key);
      if (gone) revokePreview(gone);
      return prev.filter((p) => p.key !== key);
    });

  const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Hall photos</p>
        <p className="text-[11px] text-charcoal-500">
          {photos.length > 0 ? `${photos.length} of ${MAX_DRAFT_PHOTOS} · ` : ""}Up to {MAX_DRAFT_PHOTOS} photos
        </p>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-charcoal-500">{description}</p>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        disabled={busy || remaining <= 0}
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div
        onDragOver={(e) => {
          if (busy || !isFileDrag(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setFileDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileDragOver(false);
        }}
        onDrop={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          setFileDragOver(false);
          if (!busy) void addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "mt-2 rounded-xl border-2 border-dashed p-3 transition-colors",
          fileDragOver ? "border-maroon-400 bg-maroon-50" : "border-border bg-ivory-50",
        )}
      >
        {photos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
            <ImagePlus className="h-8 w-8 text-charcoal-300" aria-hidden />
            <p className="text-sm font-medium text-charcoal-700">No photos added yet</p>
            <AddButton inputId={inputId} disabled={busy} onPick={() => inputRef.current?.click()} />
            <p className="text-[11px] text-charcoal-500">
              Or drag photos here · JPG, PNG or WebP · large photos are resized automatically
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Hall photos, first is the cover">
            {photos.map((p, i) => (
              <li
                key={p.key}
                draggable={!busy && !p.error && p.status !== "uploading"}
                onDragStart={(e) => {
                  setDragKey(p.key);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", p.key);
                }}
                onDragEnd={() => {
                  setDragKey(null);
                  setDropKey(null);
                }}
                onDragOver={(e) => {
                  if (!dragKey || isFileDrag(e)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setDropKey(p.key);
                }}
                onDrop={(e) => {
                  if (!dragKey || isFileDrag(e)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const from = photos.findIndex((x) => x.key === dragKey);
                  if (from >= 0) move(from, i);
                  setDragKey(null);
                  setDropKey(null);
                }}
                className={cn(
                  "group relative aspect-[4/3] overflow-hidden rounded-xl bg-charcoal-100 ring-2 ring-transparent",
                  !busy && "cursor-grab active:cursor-grabbing",
                  i === 0 && "ring-gold-400",
                  dropKey === p.key && dragKey !== p.key && "ring-maroon-500",
                  dragKey === p.key && "opacity-50",
                  p.status === "failed" && "ring-red-500",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL or a just-uploaded file; next/image cannot optimise either */}
                <img src={p.previewUrl} alt={`Photo ${i + 1}${i === 0 ? ", cover" : ""}`} className="h-full w-full object-cover" draggable={false} />

                {i === 0 ? (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-gold-300 px-2 py-0.5 text-[11px] font-bold text-charcoal-950 shadow">
                    <Star className="h-3 w-3 fill-current" aria-hidden /> Cover
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => move(i, 0)}
                    className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur hover:bg-black/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
                  >
                    Make cover
                  </button>
                )}

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove(p.key)}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>

                <div className="absolute bottom-2 right-2 flex gap-1">
                  <button
                    type="button"
                    disabled={busy || i === 0}
                    onClick={() => move(i, i - 1)}
                    aria-label={`Move photo ${i + 1} earlier`}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={busy || i === photos.length - 1}
                    onClick={() => move(i, i + 1)}
                    aria-label={`Move photo ${i + 1} later`}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
                  >
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>

                {p.status === "pending" && !p.storagePath && (
                  <span className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-charcoal-700">
                    Not saved yet
                  </span>
                )}

                {p.status === "uploading" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 px-4 text-white">
                    <span className="text-xs font-semibold tabular-nums">
                      {p.progress >= 1 ? "Checking…" : `Uploading ${Math.round(p.progress * 100)}%`}
                    </span>
                    <span className="h-1.5 w-full overflow-hidden rounded-full bg-white/30">
                      <span className="block h-full rounded-full bg-white transition-[width]" style={{ width: `${Math.round(p.progress * 100)}%` }} />
                    </span>
                  </div>
                )}

                {p.status === "failed" && (
                  <div className="absolute inset-x-0 bottom-0 bg-red-700/95 px-2 py-1.5 text-[11px] leading-snug text-white">
                    <span className="flex items-start gap-1">
                      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                      <span>{p.error ?? "Not saved."}</span>
                    </span>
                  </div>
                )}
              </li>
            ))}

            {remaining > 0 && (
              <li className="flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-charcoal-300 bg-white">
                <AddButton inputId={inputId} disabled={busy} onPick={() => inputRef.current?.click()} />
              </li>
            )}
          </ul>
        )}
      </div>

      <div aria-live="polite" className="mt-2 space-y-1">
        {preparing > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-charcoal-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Preparing {preparing} photo{preparing === 1 ? "" : "s"}…
          </p>
        )}
        {notices.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <ul className="space-y-0.5">
              {notices.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
            <button type="button" onClick={() => setNotices([])} className="mt-1 font-semibold underline underline-offset-2">
              Dismiss
            </button>
          </div>
        )}
        {photos.length > 1 && (
          <p className="text-[11px] text-charcoal-500">
            Drag photos to reorder, or use the arrows. The first photo is the cover shown on hall cards.
          </p>
        )}
      </div>
    </div>
  );
}

function AddButton({ inputId, disabled, onPick }: { inputId: string; disabled: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-controls={inputId}
      disabled={disabled}
      onClick={onPick}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-maroon-300 bg-white px-4 text-sm font-semibold text-maroon-700 transition-colors hover:bg-maroon-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-600 disabled:opacity-60"
    >
      <ImagePlus className="h-4 w-4" aria-hidden />
      Add Photos
    </button>
  );
}
