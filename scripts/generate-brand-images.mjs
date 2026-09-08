// ─────────────────────────────────────────────────────────────────────────────
// scripts/generate-brand-images.mjs
//
// Regenerates the three brand images that are otherwise opaque binaries:
//
//   public/og-default.png   1200x630  the social share card
//   app/icon.png             512x512  the site icon (MUST be square)
//   app/favicon.ico           32x32   so /favicon.ico resolves at all
//
// WHY A SCRIPT AND NOT A DESIGN FILE. The previous og-default.png asserted
// "Verified venues", which Terms section 5 explicitly disclaims — Hallnect does
// not independently verify listing details, and that wording had already been
// removed from the site copy for exactly that reason. It survived in the image
// because nobody can grep a PNG. Generated from this file, the claim is one line
// of reviewable text that shows up in a diff like any other.
//
// Run:  node scripts/generate-brand-images.mjs
// Not wired into the build — these change rarely, and a build should not depend
// on Google Fonts being reachable.
// ─────────────────────────────────────────────────────────────────────────────

import { ImageResponse } from "next/dist/server/og/image-response.js";
import React from "react";
import fs from "node:fs";

const el = React.createElement;

const MAROON_DARK = "#5A1020";
const MAROON       = "#6B1525";
const MAROON_LIGHT = "#9B2038";
const GOLD         = "#D4A94A";
const IVORY        = "#FBF7F2";

// The one line this whole script exists to get right. "Verified venues" was a
// claim the product does not make; these three are things it actually does.
const TAGLINE = "Owner-listed venues  ·  Real availability  ·  Book online";

const logo = fs.readFileSync("public/logo.png").toString("base64");
const LOGO_SRC = `data:image/png;base64,${logo}`;

/** Google Fonts, as TTF (satori cannot read woff2). Optional: if the network is
 *  unavailable the images still render in the default face. */
async function loadFont(family, weight) {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&display=swap`,
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1)" } },
    ).then((r) => r.text());
    const url = css.match(/src: url\((https:[^)]+\.ttf)\)/)?.[1];
    if (!url) return null;
    const data = await fetch(url).then((r) => r.arrayBuffer());
    return { name: family.replace(/\+/g, " "), data, weight, style: "normal" };
  } catch {
    return null;
  }
}

async function write(path, node, opts) {
  const res = new ImageResponse(node, opts);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path, buf);
  console.log(`  ${path.padEnd(24)} ${opts.width}x${opts.height}  ${buf.length} bytes`);
  return buf;
}

/** Minimal ICO container around a single PNG. Every browser Google's crawler
 *  cares about reads PNG-in-ICO, and it avoids pulling in an encoder. */
function icoFromPng(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);          // reserved
  header.writeUInt16LE(1, 2);          // type 1 = icon
  header.writeUInt16LE(1, 4);          // one image
  const dir = Buffer.alloc(16);
  dir.writeUInt8(size >= 256 ? 0 : size, 0);  // 0 means 256
  dir.writeUInt8(size >= 256 ? 0 : size, 1);
  dir.writeUInt8(0, 2);                // palette
  dir.writeUInt8(0, 3);                // reserved
  dir.writeUInt16LE(1, 4);             // colour planes
  dir.writeUInt16LE(32, 6);            // bits per pixel
  dir.writeUInt32LE(png.length, 8);
  dir.writeUInt32LE(22, 12);           // offset = 6 + 16
  return Buffer.concat([header, dir, png]);
}

const fonts = (await Promise.all([
  loadFont("Playfair+Display", 700),
  loadFont("Inter", 500),
])).filter(Boolean);
console.log(fonts.length ? `fonts: ${fonts.map((f) => f.name).join(", ")}` : "fonts: default face (fetch failed)");

const serif = fonts.some((f) => f.name === "Playfair Display") ? "Playfair Display" : "serif";
const sans  = fonts.some((f) => f.name === "Inter") ? "Inter" : "sans-serif";

// ── The share card ──────────────────────────────────────────────────────────
await write("public/og-default.png",
  el("div", {
    style: {
      width: "100%", height: "100%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      backgroundImage: `linear-gradient(160deg, ${MAROON_DARK} 0%, ${MAROON} 55%, ${MAROON_LIGHT} 100%)`,
      fontFamily: sans,
    },
  },
    el("img", { src: LOGO_SRC, width: 104, height: 114, style: { marginBottom: 34 } }),
    el("div", { style: { fontFamily: serif, fontSize: 82, fontWeight: 700, color: IVORY, letterSpacing: 6 } }, "HALLNECT"),
    el("div", { style: { width: 360, height: 3, background: GOLD, marginTop: 22, marginBottom: 26 } }),
    // Two rows rather than a <br>: satori requires an explicit display on any
    // div with more than one child, and refuses to render otherwise.
    el("div", {
      style: {
        display: "flex", flexDirection: "column", alignItems: "center",
        fontFamily: serif, fontSize: 40, fontWeight: 700, color: GOLD, lineHeight: 1.35,
      },
    },
      el("div", {}, "Wedding Halls & Marriage Halls"),
      el("div", {}, "across Tamil Nadu"),
    ),
    el("div", { style: { fontSize: 25, color: IVORY, opacity: 0.9, marginTop: 34 } }, TAGLINE),
  ),
  { width: 1200, height: 630, fonts },
);

// ── The site icon. SQUARE, which is the entire point: Google ignores a
//    non-square favicon, and this was 477x523. ─────────────────────────────
const iconNode = (px) => el("div", {
  style: {
    width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
    backgroundImage: `linear-gradient(150deg, ${MAROON} 0%, ${MAROON_LIGHT} 100%)`,
    borderRadius: Math.round(px * 0.18),
  },
}, el("img", { src: LOGO_SRC, width: Math.round(px * 0.62), height: Math.round(px * 0.68) }));

await write("app/icon.png", iconNode(512), { width: 512, height: 512, fonts: [] });

const small = await write("scripts/.favicon-32.png", iconNode(32), { width: 32, height: 32, fonts: [] });
fs.writeFileSync("app/favicon.ico", icoFromPng(small, 32));
fs.unlinkSync("scripts/.favicon-32.png");
console.log(`  app/favicon.ico          32x32   ${fs.statSync("app/favicon.ico").size} bytes`);
