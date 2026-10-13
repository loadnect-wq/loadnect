#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/indexnow-submit.mjs — tell Bing (IndexNow) about every URL in the
// live sitemap. Run once after a deploy that adds pages Bing has not seen, such
// as a new guide. Venue changes are sent automatically by the app
// (lib/revalidate-venues.ts → lib/indexnow.ts), so this is not needed for them.
//
//   node scripts/indexnow-submit.mjs            # submit
//   node scripts/indexnow-submit.mjs --dry-run  # list what would be sent
//
// The key is public by design (see lib/indexnow.ts); this reads it from the
// same file IndexNow fetches to verify us, so the two cannot disagree.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "hallnect.com";
const ORIGIN = `https://${HOST}`;

const keyFiles = readdirSync(join(root, "public")).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (keyFiles.length !== 1) throw new Error(`expected one IndexNow key file in public/, found ${keyFiles.length}`);
const key = readFileSync(join(root, "public", keyFiles[0]), "utf8").trim();

// The key file must be live before IndexNow will accept anything.
const live = await fetch(`${ORIGIN}/${key}.txt`);
if (!live.ok || (await live.text()).trim() !== key) {
  throw new Error(`${ORIGIN}/${key}.txt is not serving the key yet. Deploy first.`);
}

const sitemap = await (await fetch(`${ORIGIN}/sitemap.xml`)).text();
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => m[1].trim())
  .filter((u) => new URL(u).host === HOST);
if (urls.length === 0) throw new Error("the sitemap listed no URLs");

if (process.argv.includes("--dry-run")) {
  console.log(urls.join("\n"));
  console.log(`\n${urls.length} URLs (dry run, nothing sent)`);
  process.exit(0);
}

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key, keyLocation: `${ORIGIN}/${key}.txt`, urlList: urls }),
});
console.log(`IndexNow answered ${res.status} for ${urls.length} URLs`);
if (res.status !== 200 && res.status !== 202) {
  console.log(await res.text());
  process.exit(1);
}
