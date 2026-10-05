import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_SOURCE_PHOTO_BYTES,
  MAX_STORED_PHOTO_BYTES,
  PHOTO_JPEG_QUALITY,
  PHOTO_MAX_EDGE,
  PHOTO_MIN_SAVING,
  keepOriginalPhoto,
  photoFitsAsPicked,
  photoTargetSize,
} from "../hall-draft-photos";
import { formatPhotoBytes } from "../prepare-hall-photo";

// ─────────────────────────────────────────────────────────────────────────────
// Automatic compression of hall photos (2026-10-05): every upload path shrinks
// a photo in the browser before it goes up, and never in a way you can see.
// The canvas work itself needs a browser and was checked in one; these pin the
// rules and that every live path actually uses them.
// ─────────────────────────────────────────────────────────────────────────────

const MB = 1024 * 1024;

describe("what size a photo is stored at", () => {
  it("scales a phone photo down to 2560px on its long edge, keeping its shape", () => {
    expect(photoTargetSize(4032, 3024)).toEqual({ width: 2560, height: 1920 });
    expect(photoTargetSize(3024, 4032)).toEqual({ width: 1920, height: 2560 });
    expect(photoTargetSize(8064, 6048)).toEqual({ width: 2560, height: 1920 });   // 48 MP
    expect(photoTargetSize(4000, 2250)).toEqual({ width: 2560, height: 1440 });   // 16:9
  });

  it("never enlarges a photo", () => {
    expect(photoTargetSize(1600, 1200)).toEqual({ width: 1600, height: 1200 });
    expect(photoTargetSize(PHOTO_MAX_EDGE, 1000)).toEqual({ width: PHOTO_MAX_EDGE, height: 1000 });
  });

  it("encodes at a quality chosen for looks, not for the smallest file", () => {
    expect(PHOTO_JPEG_QUALITY).toBeGreaterThanOrEqual(0.85);
  });
});

describe("when the original is kept exactly as picked", () => {
  const fitting = { width: 2000, height: 1500, bytes: 900 * 1024 };

  it("keeps a small, already-compressed photo when re-encoding would barely help", () => {
    expect(keepOriginalPhoto({ ...fitting, compressedBytes: 850 * 1024 })).toBe(true);
    expect(keepOriginalPhoto({ ...fitting, compressedBytes: 1200 * 1024 })).toBe(true);   // copy is bigger
  });

  it("uses the copy once it saves a real share of the bytes", () => {
    const enough = Math.floor(fitting.bytes * (1 - PHOTO_MIN_SAVING)) - 1;
    expect(keepOriginalPhoto({ ...fitting, compressedBytes: enough })).toBe(false);
  });

  it("keeps the original when the browser could not encode a copy, but only if it fits", () => {
    expect(keepOriginalPhoto({ ...fitting, compressedBytes: null })).toBe(true);
    expect(keepOriginalPhoto({ width: 4032, height: 3024, bytes: 3 * MB, compressedBytes: null })).toBe(false);
  });

  it("never keeps a photo that is too big or too heavy, however little the copy saves", () => {
    expect(keepOriginalPhoto({ width: 4032, height: 3024, bytes: 2 * MB, compressedBytes: 2 * MB })).toBe(false);
    expect(keepOriginalPhoto({ width: 2000, height: 1500, bytes: 6 * MB, compressedBytes: 6 * MB })).toBe(false);
    expect(photoFitsAsPicked(2000, 1500, MAX_STORED_PHOTO_BYTES + 1)).toBe(false);
  });

  it("lets owners pick an ordinary phone photo, which the bucket alone would refuse", () => {
    expect(MAX_SOURCE_PHOTO_BYTES).toBeGreaterThanOrEqual(20 * MB);
    expect(MAX_STORED_PHOTO_BYTES).toBe(5 * MB);   // the bucket's own limit (0010) is unchanged
  });
});

describe("what an owner is told", () => {
  it("formats sizes the way an owner reads them", () => {
    expect(formatPhotoBytes(6.24 * MB)).toBe("6.2 MB");
    expect(formatPhotoBytes(840 * 1024)).toBe("840 KB");
    expect(formatPhotoBytes(10)).toBe("1 KB");
  });
});

describe("every live upload path compresses", () => {
  const root = join(__dirname, "..", "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  const manager = read("app/owner/(dashboard)/halls/[id]/images/_components/ImagesManager.tsx");
  const wizard = read("app/owner/(dashboard)/halls/_components/HallForm.tsx");
  const admin = read("app/admin/hall-drafts/_components/HallPhotosField.tsx");
  const prep = read("lib/prepare-hall-photo.ts");

  it("the owner's photo manager uploads the prepared photo under its prepared type", () => {
    expect(manager).toContain("await prepareHallPhoto(files[i])");
    expect(manager).toContain(".upload(path, prepared.blob, {");
    expect(manager).toContain("contentType: prepared.type,");
    expect(manager).toContain("EXT_BY_MIME[prepared.type]");
    expect(manager).not.toMatch(/\.upload\(path, file\b/);
  });

  it("the new-hall wizard compresses at pick time and waits for it before submitting", () => {
    expect(wizard).toContain("await prepareHallPhoto(file)");
    expect(wizard).toContain(".upload(path, blob, {");
    expect(wizard).toContain("disabled={pending || preparing > 0}");
    expect(wizard).toContain("if (preparing > 0) return;");
    expect(wizard).not.toMatch(/\.upload\(path, file\b/);
  });

  it("the admin's draft form uses the same preparer", () => {
    expect(admin).toContain("await prepareHallPhoto(file)");
  });

  it("decodes one photo at a time, upright, and scales in steps", () => {
    expect(prep).toContain("return oneAtATime(() => prepare(file));");
    expect(prep).toContain('imageOrientation: "from-image"');
    expect(prep).toContain("while (cw > width * 2)");
    expect(prep).toContain('ctx.imageSmoothingQuality = "high"');
  });
});
