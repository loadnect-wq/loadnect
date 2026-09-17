// ─────────────────────────────────────────────────────────────────────────────
// lib/hall-draft-photos.ts — the rules for photos on an admin-recorded hall.
//
// Pure: no Supabase client, no DOM, no network. Imported by the server actions
// that validate and save, and by the admin form that prepares uploads, so the
// two can never disagree about what a valid photo path is.
//
// WHERE THE PHOTOS LIVE. The existing `hall-images` bucket, under the DRAFT's
// id — there is no hall id until the owner claims the listing:
//
//     hall-images/{draftId}/{random uuid}.{jpg|png|webp}
//
// and in the existing admin_hall_drafts.photo_urls, an ordered list whose first
// entry is the cover. claim_admin_hall_draft() copies that list into
// hall_images (is_cover = first, sort_order = position). Migration 0094 pins
// the same shape in a CHECK constraint.
// ─────────────────────────────────────────────────────────────────────────────

export const HALL_IMAGES_BUCKET = "hall-images";

/** Photos one admin-recorded listing may carry. The owner's own cap is 30. */
export const MAX_DRAFT_PHOTOS = 10;

/** What Storage will accept — the bucket's own limit (0010), enforced by Storage. */
export const MAX_STORED_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * What the admin may PICK. Larger than what is stored, because a phone or
 * camera photo is routinely 6–15 MB and is resized in the browser before it is
 * uploaded (lib/prepare-hall-photo.ts). Refusing those would reject ordinary
 * hall photographs.
 */
export const MAX_SOURCE_PHOTO_BYTES = 25 * 1024 * 1024;

export type PhotoMime = "image/jpeg" | "image/png" | "image/webp";

export const EXT_BY_MIME: Record<PhotoMime, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/webp": "webp",
};

export const MIME_BY_EXT: Record<"jpg" | "png" | "webp", PhotoMime> = {
  jpg:  "image/jpeg",
  png:  "image/png",
  webp: "image/webp",
};

export function isPhotoMime(v: string): v is PhotoMime {
  return v === "image/jpeg" || v === "image/png" || v === "image/webp";
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FILE_RE = new RegExp(`^(${UUID})\\.(jpg|png|webp)$`);

/** The storage path for a new photo. The server generates it; the client never names a file. */
export function draftPhotoPath(draftId: string, fileId: string, mime: PhotoMime): string {
  return `${draftId}/${fileId}.${EXT_BY_MIME[mime]}`;
}

/**
 * True only for `{draftId}/{uuid}.{jpg|png|webp}` — this draft's folder, one
 * level, a generated name. Anything else (another draft's folder, a hall's
 * folder, `..`, a nested path, an uppercase or user-chosen name) is refused.
 */
export function isDraftPhotoPath(draftId: string, path: string): boolean {
  if (typeof path !== "string" || !new RegExp(`^${UUID}$`).test(draftId)) return false;
  const prefix = `${draftId}/`;
  if (!path.startsWith(prefix)) return false;
  return FILE_RE.test(path.slice(prefix.length));
}

/** The MIME type a valid path's extension promises. */
export function mimeForDraftPhotoPath(path: string): PhotoMime | null {
  const m = /\.(jpg|png|webp)$/.exec(path);
  return m ? MIME_BY_EXT[m[1] as "jpg" | "png" | "webp"] : null;
}

/** The file name inside the draft folder, e.g. "…uuid….jpg". */
export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Recovers the storage path from a public object URL in the hall-images
 * bucket, or null. The inverse of publicUrlForStoragePath for the paths this
 * feature writes (a uuid folder and a uuid file — nothing to percent-decode,
 * but decoded anyway so the inverse holds in general).
 */
export function storagePathFromPublicUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${HALL_IMAGES_BUCKET}/`;
  const i = typeof url === "string" ? url.indexOf(marker) : -1;
  if (i < 0) return null;
  try {
    return url.slice(i + marker.length).split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

/**
 * What changed between two saved photo lists (index 0 = cover), for the audit
 * trail. Reordered means the photos present in BOTH lists are in a different
 * relative order — adding or removing one is not, by itself, a reorder.
 */
export function diffPhotoLists(before: readonly string[], after: readonly string[]) {
  const b = new Set(before);
  const a = new Set(after);
  const added   = after.filter((p) => !b.has(p));
  const removed = before.filter((p) => !a.has(p));
  const keptBefore = before.filter((p) => a.has(p));
  const keptAfter  = after.filter((p) => b.has(p));
  const reordered = keptBefore.some((p, i) => keptAfter[i] !== p);
  const coverChanged = (before[0] ?? null) !== (after[0] ?? null);
  return { added, removed, reordered, coverChanged };
}

/**
 * What a file actually is, from its first bytes — never from its name or the
 * type the browser declares, both of which the uploader controls.
 *   JPEG  FF D8 FF
 *   PNG   89 50 4E 47 0D 0A 1A 0A
 *   WebP  "RIFF" .... "WEBP"
 * Same signatures as sniffImageType in lib/supabase/storage.ts, over raw bytes
 * so the server can check what Storage actually holds.
 */
export function sniffPhotoBytes(head: Uint8Array): PhotoMime | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (
    head.length >= 8 &&
    head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
    head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a
  ) return "image/png";
  if (head.length >= 12) {
    const tag = (s: number) => String.fromCharCode(head[s], head[s + 1], head[s + 2], head[s + 3]);
    if (tag(0) === "RIFF" && tag(8) === "WEBP") return "image/webp";
  }
  return null;
}

/** Longest edge a stored photo keeps. Sharp on a 4K screen, a fraction of a camera original. */
export const PHOTO_MAX_EDGE = 2560;

/** Below this on the SHORT edge a photo looks broken on a hall card. */
export const PHOTO_MIN_EDGE = 320;

/**
 * Whether a picked photo is re-encoded before upload, and to what size.
 *
 * Kept untouched when it already fits: at most PHOTO_MAX_EDGE on its long edge
 * and small enough to store. Re-encoding a photo that is already fine only
 * loses quality. Otherwise it is scaled so the long edge is at most
 * PHOTO_MAX_EDGE, never enlarged.
 */
export function planPhotoResize(width: number, height: number, bytes: number):
  | { resize: false }
  | { resize: true; width: number; height: number } {
  const longEdge = Math.max(width, height);
  const fits = longEdge <= PHOTO_MAX_EDGE && bytes <= MAX_STORED_PHOTO_BYTES;
  if (fits) return { resize: false };
  const scale = Math.min(1, PHOTO_MAX_EDGE / longEdge);
  return {
    resize: true,
    width:  Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
