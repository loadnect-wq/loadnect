// ─────────────────────────────────────────────────────────────────────────────
// GET /.well-known/assetlinks.json — Android App Links association.
//
// Android verifies this file before it will route https://hallnect.com links
// into the Hallnect app (com.hallnect.app). Verification is what makes the
// Google-login round trip work: the OAuth callback fired from the Chrome
// Custom Tab re-enters the app only when these links are verified.
//
// The certificate fingerprint is DEPLOYMENT CONFIGURATION, not code — it is
// derived from the actual signing keys, which must never live in the repo. It
// is read from ANDROID_ASSETLINKS_SHA256 (comma-separated, because Play App
// Signing means there are eventually TWO fingerprints: the upload key used
// locally and the app-signing key Google signs releases with — both belong
// in the list).
//
// Until the variable is set this returns 404, which Android treats as
// "not verified": hallnect.com links keep opening in the browser and nothing
// breaks. A wrong-but-present file would be worse than none.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FINGERPRINT_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

export async function GET() {
  const raw = process.env.ANDROID_ASSETLINKS_SHA256?.trim();
  if (!raw) {
    return NextResponse.json(
      { error: "not configured" },
      { status: 404 },
    );
  }

  // Normalise and validate: each entry must be a SHA-256 cert fingerprint in
  // colon-separated form. A malformed value is rejected outright rather than
  // served — Android would silently fail verification with no diagnostics.
  const fingerprints = raw
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean);

  if (fingerprints.length === 0 || !fingerprints.every((f) => FINGERPRINT_RE.test(f))) {
    console.error("[assetlinks] ANDROID_ASSETLINKS_SHA256 is malformed — expected colon-separated SHA-256 fingerprints");
    return NextResponse.json({ error: "misconfigured" }, { status: 404 });
  }

  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.hallnect.app",
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    {
      headers: {
        // Android's verifier and Google's CDN both cache this; an hour keeps
        // fingerprint rotation reasonably fast without hammering the origin.
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
