// The picture WhatsApp shows above a comparison link: the halls as columns,
// each with its price and guests, so the family group sees the comparison
// before anyone taps. Text only besides the monogram — hall photos are often
// WebP, which the image renderer cannot draw.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { compareImage } from "@/components/compare/compare-image";
import { loadCompare } from "./load";

export const alt = "Halls compared on Hallnect";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const loaded = await loadCompare(code);
  const halls = loaded && !loaded.failed ? loaded.halls : [];
  const monogram = `data:image/png;base64,${(await readFile(join(process.cwd(), "public", "diary-icon-192.png"))).toString("base64")}`;

  return new ImageResponse(compareImage(halls, monogram), { ...size });
}
