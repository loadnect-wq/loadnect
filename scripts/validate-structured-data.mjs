#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/validate-structured-data.mjs — check every indexable page's JSON-LD.
//
//   node scripts/validate-structured-data.mjs https://hallnect.com
//   node scripts/validate-structured-data.mjs http://localhost:3100 --paths-from https://hallnect.com
//
// Reads the page list from <paths-from or base>/sitemap.xml (a local build's
// sitemap is empty by design — it drops non-hallnect.com URLs), fetches each
// page from <base>, and checks its JSON-LD three ways:
//   1. schema.org — every property exists on the node's type (multi-typed
//      nodes may use any of their types' properties);
//   2. Google's required fields for the types it reads (BreadcrumbList,
//      FAQPage, Organization, LocalBusiness, ItemList, AggregateRating);
//   3. the page itself — FAQ questions, breadcrumb names, the price and the
//      dates the markup states must appear in the page's visible text.
// Exits 1 if any page has an error. Warnings (recommended-but-absent fields)
// are printed, not fatal. No dependencies.
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const base = (args[0] ?? "https://hallnect.com").replace(/\/$/, "");
const fromIdx = args.indexOf("--paths-from");
const pathsFrom = (fromIdx >= 0 ? args[fromIdx + 1] : base).replace(/\/$/, "");
const extra = args.filter((a, i) => a.startsWith("/") && !["--paths-from", "--origin"].includes(args[i - 1]));
const UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

// Properties schema.org defines on each type (inherited ones included), for
// the vocabulary this site uses. A property not listed is an error.
const PLACE = ["@id", "name", "description", "url", "image", "address", "geo", "maximumAttendeeCapacity", "amenityFeature", "keywords", "aggregateRating", "containedInPlace", "telephone", "openingHoursSpecification", "sameAs", "identifier"];
const WEBPAGE = ["@id", "url", "name", "description", "inLanguage", "isPartOf", "mainEntity", "dateModified", "datePublished", "about", "breadcrumb"];
const PROPS = {
  Organization: ["@id", "name", "legalName", "url", "logo", "email", "telephone", "address", "areaServed", "contactPoint", "vatID", "taxID", "identifier", "sameAs"],
  WebSite: ["@id", "url", "name", "inLanguage", "publisher", "potentialAction"],
  WebPage: WEBPAGE,
  CollectionPage: WEBPAGE,
  EventVenue: PLACE,
  LocalBusiness: [...PLACE, "priceRange", "openingHours", "email", "logo"],
  BreadcrumbList: ["itemListElement"],
  ItemList: ["itemListElement", "numberOfItems"],
  ListItem: ["position", "name", "item", "url"],
  FAQPage: ["@id", "mainEntity", "url", "name"],
  Question: ["name", "acceptedAnswer"],
  Answer: ["text"],
  ImageObject: ["url", "width", "height"],
  PostalAddress: ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"],
  GeoCoordinates: ["latitude", "longitude"],
  LocationFeatureSpecification: ["name", "value"],
  AggregateRating: ["ratingValue", "reviewCount", "ratingCount", "bestRating", "worstRating"],
  City: ["name", "containedInPlace"],
  State: ["name", "containedInPlace"],
  Country: ["name"],
  ContactPoint: ["contactType", "email", "telephone", "areaServed", "availableLanguage", "hoursAvailable"],
  OpeningHoursSpecification: ["dayOfWeek", "opens", "closes"],
  PropertyValue: ["propertyID", "value"],
  SearchAction: ["target", "query-input"],
  EntryPoint: ["urlTemplate"],
};

const typesOf = (n) => (Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]]).filter(Boolean);
// Absolute https — or, when checking a local build, the origin that build
// stamps into its URLs (NEXT_PUBLIC_APP_URL, e.g. http://localhost:3000 even
// when served on :3100): pass it as --origin. Production uses https.
const originIdx = args.indexOf("--origin");
const origin = (originIdx >= 0 ? args[originIdx + 1] : base).replace(/\/$/, "");
const isAbs = (u) => typeof u === "string" && (/^https:\/\//.test(u) || u === origin || u.startsWith(origin + "/"));
const textOf = (html) =>
  html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");

function walk(node, path, out, visit) {
  if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`, out, visit));
  if (!node || typeof node !== "object") return;
  visit(node, path, out);
  for (const [k, v] of Object.entries(node)) if (k !== "@context") walk(v, `${path}.${k}`, out, visit);
}

function checkNode(node, path, out) {
  const types = typesOf(node);
  const isRef = Object.keys(node).length === 1 && node["@id"];
  if (isRef) return;
  if (!types.length) { out.errors.push(`${path}: node without @type`); return; }
  const allowed = new Set(types.flatMap((t) => PROPS[t] ?? []));
  for (const t of types) if (!PROPS[t]) out.errors.push(`${path}: unknown type ${t}`);
  for (const k of Object.keys(node)) {
    if (k === "@type") continue;
    if (!allowed.has(k)) out.errors.push(`${path}: "${k}" is not a property of ${types.join("+")}`);
  }
  const has = (k) => node[k] !== undefined && node[k] !== null && node[k] !== "";

  if (types.includes("BreadcrumbList")) {
    const items = node.itemListElement ?? [];
    if (!items.length) out.errors.push(`${path}: BreadcrumbList with no items`);
    items.forEach((it, i) => {
      if (it.position !== i + 1) out.errors.push(`${path}: breadcrumb ${i} position ${it.position}, expected ${i + 1}`);
      if (!it.name) out.errors.push(`${path}: breadcrumb ${i} has no name`);
      if (i < items.length - 1 && !isAbs(it.item)) out.errors.push(`${path}: breadcrumb ${i} item is not an absolute URL`);
      out.mustBeVisible.push(it.name);
    });
  }
  if (types.includes("FAQPage")) {
    const qs = node.mainEntity ?? [];
    if (!qs.length) out.errors.push(`${path}: FAQPage with no questions`);
    for (const q of qs) {
      if (!q.name || !q.acceptedAnswer?.text) out.errors.push(`${path}: a question lacks name or acceptedAnswer.text`);
      out.mustBeVisible.push(q.name);
    }
  }
  if (types.includes("Organization")) {
    for (const k of ["name", "url", "logo"]) if (!has(k)) out.errors.push(`${path}: Organization missing ${k}`);
  }
  if (types.includes("LocalBusiness")) {
    for (const k of ["name", "address"]) if (!has(k)) out.errors.push(`${path}: LocalBusiness missing ${k}`);
    for (const k of ["telephone", "geo", "openingHoursSpecification"]) if (!has(k)) out.warnings.push(`${path}: LocalBusiness has no ${k} (recommended, optional)`);
    if (has("priceRange")) {
      if (String(node.priceRange).length > 100) out.errors.push(`${path}: priceRange longer than 100 characters`);
      out.mustBeVisible.push(String(node.priceRange).split("–")[0]);
    }
  }
  if (types.includes("PostalAddress")) {
    for (const k of ["streetAddress", "addressLocality", "addressCountry"]) if (!has(k)) out.warnings.push(`${path}: PostalAddress has no ${k}`);
  }
  if (types.includes("ItemList")) {
    (node.itemListElement ?? []).forEach((it, i) => {
      if (it.position !== i + 1) out.errors.push(`${path}: list item ${i} position ${it.position}`);
      if (!isAbs(it.url)) out.errors.push(`${path}: list item ${i} url is not absolute`);
    });
    if (node.numberOfItems !== undefined && node.numberOfItems !== (node.itemListElement ?? []).length) {
      out.errors.push(`${path}: numberOfItems ${node.numberOfItems} != ${(node.itemListElement ?? []).length} items`);
    }
  }
  if (types.includes("AggregateRating")) {
    if (!(node.reviewCount >= 1)) out.errors.push(`${path}: AggregateRating without reviews`);
    if (!(node.ratingValue >= (node.worstRating ?? 1) && node.ratingValue <= (node.bestRating ?? 5))) out.errors.push(`${path}: ratingValue out of range`);
  }
  if (has("dateModified")) {
    if (Number.isNaN(Date.parse(node.dateModified))) out.errors.push(`${path}: dateModified is not a date`);
    out.dates.push(node.dateModified);
  }
  for (const k of ["url", "@id"]) if (has(k) && !isAbs(node[k])) out.errors.push(`${path}: ${k} is not an absolute https URL`);
}

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "manual" });
  return { status: r.status, body: await r.text() };
}

const sm = await get(`${pathsFrom}/sitemap.xml`);
const paths = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
for (const p of extra) if (!paths.includes(p)) paths.push(p);
if (!paths.length) { console.error(`No pages: ${pathsFrom}/sitemap.xml listed none.`); process.exit(1); }

let failed = 0;
const typeCounts = {};
for (const p of paths) {
  const { status, body } = await get(base + p);
  const out = { errors: [], warnings: [], mustBeVisible: [], dates: [] };
  if (status !== 200) out.errors.push(`HTTP ${status}`);
  const blocks = [...body.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (blocks.length > 1) out.warnings.push(`${blocks.length} JSON-LD blocks (one @graph is expected)`);
  for (const [i, raw] of blocks.entries()) {
    let doc;
    try { doc = JSON.parse(raw); } catch { out.errors.push(`block ${i}: invalid JSON`); continue; }
    if (doc["@context"] !== "https://schema.org") out.errors.push(`block ${i}: @context is not https://schema.org`);
    const nodes = doc["@graph"] ?? [doc];
    for (const n of nodes) for (const t of typesOf(n)) typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    walk(nodes, `block${i}`, out, checkNode);
  }
  const visible = textOf(body);
  for (const s of out.mustBeVisible) {
    if (s && !visible.includes(String(s).replace(/\s+/g, " ").trim())) out.errors.push(`not visible on the page: "${s}"`);
  }
  for (const d of out.dates) {
    const label = new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
    if (!body.includes(`dateTime="${d}"`) && !visible.includes(label)) out.errors.push(`dateModified ${d} is not shown on the page`);
  }
  if (!blocks.length) out.warnings.push("no structured data");
  if (out.errors.length) failed++;
  const mark = out.errors.length ? "FAIL" : "ok  ";
  console.log(`${mark} ${p || "/"}  (${blocks.length} block, ${out.errors.length} errors, ${out.warnings.length} warnings)`);
  for (const e of out.errors) console.log(`       error: ${e}`);
  for (const w of out.warnings) console.log(`       warn:  ${w}`);
}
console.log(`\n${paths.length} pages, ${failed} with errors. Types: ${Object.entries(typeCounts).map(([t, n]) => `${t}×${n}`).join(", ")}`);
process.exit(failed ? 1 : 0);
