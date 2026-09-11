// ─────────────────────────────────────────────────────────────────────────────
// lib/__tests__/image-upload-sniff.test.ts
//
// THE UPLOAD VALIDATOR ONLY EVER READ THINGS THE UPLOADER CHOSE. file.type and
// the filename extension are both client-declared —
//   new File([anything], "photo.png", { type: "image/png" })
// — and the browser never looks inside. So a string picked by the uploader was
// the only thing standing between the bucket and an arbitrary payload served
// from our own storage domain.
//
// sniffImageType reads the bytes instead. These tests pin both halves: the
// forgery is refused, and every real format is still accepted, because a
// sniffer that rejects genuine photos is worse than the hole it closes.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { sniffImageType, validateImageFile } from "@/lib/supabase/storage";

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01];
const PNG  = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];
const WEBP = [...Buffer.from("RIFF"), 0x24, 0x00, 0x00, 0x00, ...Buffer.from("WEBP")];

const fileOf = (bytes: number[], name: string, type: string) =>
  new File([new Uint8Array(bytes)], name, { type });

describe("what the file actually is", () => {
  it("recognises a real JPEG, PNG and WebP", async () => {
    expect(await sniffImageType(fileOf(JPEG, "a.jpg", "image/jpeg"))).toBe("image/jpeg");
    expect(await sniffImageType(fileOf(PNG,  "a.png", "image/png"))).toBe("image/png");
    expect(await sniffImageType(fileOf(WEBP, "a.webp", "image/webp"))).toBe("image/webp");
  });

  it("refuses a payload wearing an image's name and MIME type", async () => {
    // The attack, exactly: the declared type and extension are impeccable.
    const forged = fileOf([...Buffer.from("<?php echo 1; ?>")], "photo.png", "image/png");
    expect(validateImageFile(forged)).toBeNull();       // the old checks pass it
    expect(await sniffImageType(forged)).toBeNull();     // reading it does not
  });

  it("refuses an HTML document declared as an image", async () => {
    const html = fileOf([...Buffer.from("<!doctype html><script>")], "x.jpg", "image/jpeg");
    expect(await sniffImageType(html)).toBeNull();
  });

  it("refuses an SVG, which is markup and can carry script", async () => {
    const svg = fileOf([...Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')], "x.png", "image/png");
    expect(await sniffImageType(svg)).toBeNull();
  });

  it("reports the REAL type when the declared one is wrong", async () => {
    // Not an error by itself — it is what lets the caller refuse the mismatch
    // instead of silently storing a JPEG under a .png content type.
    expect(await sniffImageType(fileOf(JPEG, "a.png", "image/png"))).toBe("image/jpeg");
  });

  it("does not mistake a RIFF container that is not WebP", async () => {
    // A .wav is also RIFF. Only the WEBP tag at offset 8 makes it an image.
    const wav = fileOf([...Buffer.from("RIFF"), 0x24, 0, 0, 0, ...Buffer.from("WAVE")], "a.webp", "image/webp");
    expect(await sniffImageType(wav)).toBeNull();
  });

  it("handles a file too short to hold any signature", async () => {
    expect(await sniffImageType(fileOf([0xff], "a.jpg", "image/jpeg"))).toBeNull();
    expect(await sniffImageType(fileOf([], "a.jpg", "image/jpeg"))).toBeNull();
  });
});
