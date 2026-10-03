// The picture WhatsApp shows above a shortlist link: how many halls, and their
// names. It is the first thing every relative in the group sees, so it says
// what the link is before anyone taps it.
//
// Text only besides the monogram. Hall photos are often WebP, which the image
// renderer cannot draw, and a broken photo is worse than none.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatHallPrice, hasPrice } from "@/lib/booking-mode";
import { shortlistTitle } from "@/lib/shortlist";
import { loadShortlist } from "./load";

export const alt = "A hall shortlist on Hallnect";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

const SHOWN = 4;

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const list = await loadShortlist(code);
  const halls = list && !list.failed ? list.halls : [];
  const monogram = `data:image/png;base64,${(await readFile(join(process.cwd(), "public", "diary-icon-192.png"))).toString("base64")}`;

  const headline = halls.length > 0 ? shortlistTitle(halls.length) : "A hall shortlist";
  const extra = halls.length - SHOWN;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "56px 72px",
          background: "linear-gradient(135deg, #9B2038 0%, #7A1830 55%, #5A1024 100%)",
          color: "#FFFEFB",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={monogram} width={72} height={72} style={{ borderRadius: 16 }} alt="" />
          <div style={{ display: "flex", marginLeft: 20, fontSize: 36, color: "#FBC751", letterSpacing: 1 }}>Hallnect</div>
        </div>

        <div style={{ display: "flex", marginTop: 36, fontSize: 68, fontWeight: 700, lineHeight: 1.1 }}>{headline}</div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 28 }}>
          {halls.slice(0, SHOWN).map((h) => (
            <div key={h.id} style={{ display: "flex", alignItems: "center", marginTop: 14 }}>
              <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, background: "#E0A820", marginRight: 20 }} />
              <div style={{ display: "flex", fontSize: 38, maxWidth: 720, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                {h.name}
              </div>
              <div style={{ display: "flex", fontSize: 30, marginLeft: 18, color: "#F5D4DA" }}>
                {`${h.city} · ${formatHallPrice(h.price_per_day)}${hasPrice(h.price_per_day) ? "/day" : ""}`}
              </div>
            </div>
          ))}
          {extra > 0 && (
            <div style={{ display: "flex", marginTop: 14, marginLeft: 34, fontSize: 30, color: "#F5D4DA" }}>
              {`and ${extra} more`}
            </div>
          )}
        </div>

        <div style={{ display: "flex", marginTop: "auto", fontSize: 28, color: "#FDDEA0" }}>
          Photos, prices and dates · hallnect.com
        </div>
      </div>
    ),
    { ...size },
  );
}
