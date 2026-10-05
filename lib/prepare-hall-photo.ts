// ─────────────────────────────────────────────────────────────────────────────
// lib/prepare-hall-photo.ts — make a picked photo ready to upload, in the
// browser. Client-only (createImageBitmap, canvas, XMLHttpRequest).
//
// AUTOMATIC COMPRESSION, FOR EVERY HALL PHOTO (2026-10-05). The owner's photo
// manager, the new-hall wizard and the admin's draft form all call
// prepareHallPhoto before uploading. Until then only the admin form did: owners
// sent the file exactly as picked, and the bucket's 5 MB limit refused most
// photos straight off a modern phone.
//
// What happens to a photo (the rules live in lib/hall-draft-photos.ts):
//   1. its BYTES decide whether it is a JPEG, PNG or WebP — never its name or
//      the type the browser reports, both of which the uploader chooses;
//   2. it is scaled down so its long edge is at most 2560px (never enlarged),
//      in halving steps so fine detail does not shimmer;
//   3. it is re-encoded as a JPEG at quality 0.88;
//   4. if the original already fitted and the copy is not at least 15%
//      smaller, the ORIGINAL is uploaded byte-for-byte instead — re-encoding a
//      photo that is already well compressed only costs quality.
//
// The server and the bucket still enforce their own limits; this is what makes
// an ordinary phone photo fit them, not a security check.
// ─────────────────────────────────────────────────────────────────────────────

import {
  MAX_SOURCE_PHOTO_BYTES,
  MAX_STORED_PHOTO_BYTES,
  PHOTO_FALLBACK_QUALITIES,
  PHOTO_JPEG_QUALITY,
  PHOTO_MIN_EDGE,
  keepOriginalPhoto,
  photoFitsAsPicked,
  photoTargetSize,
  sniffPhotoBytes,
  type PhotoMime,
} from "@/lib/hall-draft-photos";

export type PreparedPhoto = {
  blob: Blob;
  type: PhotoMime;
  width: number;
  height: number;
  /** True when `blob` is a new, smaller JPEG; false when it is the picked file, untouched. */
  compressed: boolean;
  /** The picked file's size, for "6.2 MB → 840 KB". */
  originalBytes: number;
};

export class PhotoRejected extends Error {}

const MB = 1024 * 1024;

/** "6.2 MB", "840 KB" — for telling an owner what compression saved. */
export function formatPhotoBytes(bytes: number): string {
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ONE PHOTO THROUGH THE CANVAS AT A TIME. A decoded 12-MP photo is ~48 MB of
// pixels; an owner selecting ten at once would ask a phone for half a gigabyte
// and the tab would be killed. Callers may fire these in parallel (the admin
// form does) — they queue here.
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

export function prepareHallPhoto(file: File): Promise<PreparedPhoto> {
  return oneAtATime(() => prepare(file));
}

async function prepare(file: File): Promise<PreparedPhoto> {
  if (file.size === 0) throw new PhotoRejected("This file is empty.");
  if (file.size > MAX_SOURCE_PHOTO_BYTES) {
    throw new PhotoRejected(
      `This file is ${(file.size / MB).toFixed(1)} MB. Photos up to ${MAX_SOURCE_PHOTO_BYTES / MB} MB can be added.`,
    );
  }

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const type = sniffPhotoBytes(head);
  if (!type) {
    // The common real case: an iPhone HEIC photo, or a PDF/screenshot tool export.
    throw new PhotoRejected("This is not a JPG, PNG or WebP image. HEIC and other formats need converting first.");
  }

  const image = await decode(file);
  try {
    const { width, height } = image;
    if (Math.min(width, height) < PHOTO_MIN_EDGE) {
      throw new PhotoRejected(
        `This image is only ${width}×${height}px. Use a photo at least ${PHOTO_MIN_EDGE}px on its shorter side.`,
      );
    }

    const original: PreparedPhoto = { blob: file, type, width, height, compressed: false, originalBytes: file.size };
    const target = photoTargetSize(width, height);

    let canvas: HTMLCanvasElement;
    try {
      canvas = drawScaled(image.source, width, height, target.width, target.height);
    } catch {
      // No 2D canvas (a locked-down or very old browser). A photo that fits can
      // still go up as picked, exactly as it always did.
      if (photoFitsAsPicked(width, height, file.size)) return original;
      throw new PhotoRejected("This browser could not resize the photo. Try a smaller copy.");
    }

    try {
      const compressed = await encodeJpeg(canvas, PHOTO_JPEG_QUALITY);
      if (keepOriginalPhoto({ width, height, bytes: file.size, compressedBytes: compressed?.size ?? null })) {
        return original;
      }
      const done = (blob: Blob): PreparedPhoto => ({
        blob, type: "image/jpeg", width: target.width, height: target.height, compressed: true, originalBytes: file.size,
      });
      if (compressed && compressed.size <= MAX_STORED_PHOTO_BYTES) return done(compressed);

      // Only an extraordinarily detailed photo gets here: 2560px at 0.88 is
      // normally well under 5 MB.
      for (const quality of PHOTO_FALLBACK_QUALITIES) {
        const blob = await encodeJpeg(canvas, quality);
        if (blob && blob.size <= MAX_STORED_PHOTO_BYTES) return done(blob);
      }
      throw new PhotoRejected("This photo is still larger than 5 MB after compressing. Try a smaller copy.");
    } finally {
      release(canvas);
    }
  } finally {
    image.close();
  }
}

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };

/**
 * Decodes with createImageBitmap, upright (a phone's EXIF rotation applied);
 * falls back to an <img> element, which browsers also draw upright, where
 * createImageBitmap is missing or refuses the file.
 */
async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new PhotoRejected("This image could not be opened. It may be damaged.");
  }
}

function newCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

/**
 * Scales `source` to width×height on a white background.
 *
 * IN HALVING STEPS while the source is more than twice the target. A single
 * smoothed draw across a large ratio (a 48-MP photo is ~3× the target) samples
 * too few source pixels and leaves fine patterns — tiles, carved pillars, a
 * chandelier — shimmering with moiré. Halving first keeps every step under 2×.
 * It also means no canvas is ever the full size of a 48-MP original, which iOS
 * would refuse outright.
 *
 * White underneath because JPEG has no transparency: a logo-style PNG would
 * otherwise come out on black.
 */
function drawScaled(source: CanvasImageSource, sw: number, sh: number, width: number, height: number) {
  let current: CanvasImageSource = source;
  let cw = sw;
  let ch = sh;
  const steps: HTMLCanvasElement[] = [];
  try {
    while (cw > width * 2) {
      const nw = Math.max(width, Math.round(cw / 2));
      const nh = Math.max(height, Math.round(ch / 2));
      const step = newCanvas(nw, nh);
      step.ctx.drawImage(current, 0, 0, nw, nh);
      steps.push(step.canvas);
      current = step.canvas;
      cw = nw;
      ch = nh;
    }
    const out = newCanvas(width, height);
    out.ctx.fillStyle = "#ffffff";
    out.ctx.fillRect(0, 0, width, height);
    out.ctx.drawImage(current, 0, 0, width, height);
    return out.canvas;
  } finally {
    steps.forEach(release);
  }
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob && blob.type === "image/jpeg" ? blob : null), "image/jpeg", quality),
  );
}

/** Safari keeps a canvas's pixels alive until it is resized to nothing. */
function release(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Uploads to a signed Storage upload URL with progress events — the supabase-js
 * helper uses fetch, which cannot report upload progress. Same request the
 * helper makes: a PUT of multipart form data carrying cacheControl and the file.
 */
export function uploadToSignedUrl(
  signedUrl: string,
  blob: Blob,
  type: PhotoMime,
  cacheControl: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("cacheControl", cacheControl);
    // The part's content type is what Storage records and serves.
    body.append("", blob instanceof File && blob.type === type ? blob : new Blob([blob], { type }));

    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("x-upsert", "false");
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (anonKey) xhr.setRequestHeader("apikey", anonKey);
    xhr.timeout = 120_000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
        return;
      }
      // The body is Storage's own wording (it can name policies); keep it in
      // the console for support and give the admin a message by status.
      console.error(`[hall-draft-photos] upload failed (status=${xhr.status}):`, xhr.responseText);
      if (xhr.status === 413) reject(new Error("This photo is too large for storage."));
      else if (xhr.status === 415 || xhr.status === 400) reject(new Error("Storage refused this file type."));
      else if (xhr.status === 401 || xhr.status === 403) reject(new Error("The upload link expired. Try again."));
      else reject(new Error("The upload failed. Try again."));
    };
    xhr.onerror = () => reject(new Error("Network error during upload. Check the connection and try again."));
    xhr.ontimeout = () => reject(new Error("The upload timed out. Try again."));
    xhr.send(body);
  });
}
