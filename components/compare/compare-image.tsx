// The comparison's link-preview picture, as JSX for next/og's ImageResponse.
// Shared by app/compare/[code]/opengraph-image.tsx; kept apart so the layout
// can be rendered from data alone.

import { formatHallPrice, hasPrice } from "@/lib/booking-mode";
import { compareTitle, type CompareHall } from "@/lib/compare";

/** Two lines of a third of the card, at most: cut long names at a word, with an ellipsis. */
function clip(name: string, max = 30): string {
  if (name.length <= max) return name;
  const cut = name.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function compareImage(halls: readonly CompareHall[], monogram: string) {
  return (
  <div
    style={{
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      padding: "52px 64px",
      background: "linear-gradient(135deg, #9B2038 0%, #7A1830 55%, #5A1024 100%)",
      color: "#FFFEFB",
    }}
  >
    <div style={{ display: "flex", alignItems: "center" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={monogram} width={64} height={64} style={{ borderRadius: 14 }} alt="" />
      <div style={{ display: "flex", marginLeft: 18, fontSize: 32, color: "#FBC751" }}>Hallnect</div>
    </div>

    <div style={{ display: "flex", marginTop: 26, fontSize: 60, fontWeight: 700 }}>
      {halls.length >= 2 ? compareTitle(halls.length) : "Halls, side by side"}
    </div>

    <div style={{ display: "flex", marginTop: 30 }}>
      {halls.map((h, i) => (
        <div
          key={h.id}
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            marginLeft: i === 0 ? 0 : 20,
            padding: "22px 24px",
            borderRadius: 20,
            background: "rgba(255,255,255,0.10)",
            border: "1px solid rgba(251,199,81,0.45)",
          }}
        >
          <div style={{ display: "flex", fontSize: 32, lineHeight: 1.15, maxHeight: 76, overflow: "hidden" }}>{clip(h.name, halls.length === 2 ? 44 : 30)}</div>
          <div style={{ display: "flex", fontSize: 24, marginTop: 8, color: "#F5D4DA" }}>{h.city}</div>
          <div style={{ display: "flex", fontSize: 30, marginTop: 18, color: "#FBC751" }}>
            {`${formatHallPrice(h.pricePerDay)}${hasPrice(h.pricePerDay) ? "/day" : ""}`}
          </div>
          <div style={{ display: "flex", fontSize: 24, marginTop: 6, color: "#FFFEFB" }}>
            {`Up to ${h.capacityMax.toLocaleString("en-IN")} guests`}
          </div>
        </div>
      ))}
    </div>

    <div style={{ display: "flex", marginTop: "auto", fontSize: 26, color: "#FDDEA0" }}>
      Price, guests and amenities side by side · hallnect.com
    </div>
  </div>
  );
}
