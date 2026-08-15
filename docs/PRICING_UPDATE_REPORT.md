# Hallnect — Pricing Update Report

**Date:** 2026-06-28
**Source:** `lib/content.ts` `PREMIUM_TIERS` (rendered on `/premium`, `app/premium/page.tsx`).

## New plans (confirmed in UI, verified at runtime)

### Free — ₹0 / month
- Subtitle: **Start listing your venue** · CTA: **Get Started** → `/owner/register`
- Basic hall listing · Up to 5 photos · Standard search visibility · Booking request management · Basic support

### Pro — ₹4,999 / month  *(Most Popular)*
- Subtitle: **Grow your bookings** · CTA: **Start Pro Plan** → `/owner/register`
- Everything in Free · Featured badge on listing · Priority search placement · Up to 20 photos · Basic analytics dashboard · **WhatsApp lead notifications (coming soon)**

### Elite — ₹9,999 / month
- Subtitle: **Maximum visibility** · CTA: **Contact Sales** → `/contact`
- Everything in Pro · Top placement in city search · Homepage featured placement · Advanced analytics and lead reports · Promotional banner visibility · Priority support

## Removed
- Old plans **Starter ₹2,999**, **Pro ₹5,999**, **Elite ₹9,999** (old feature set).
- **"Start Pro Trial"** CTA → **"Start Pro Plan"**. No trial logic exists, so **all trial wording is removed.**
- Unimplemented claims trimmed: "Unlimited photos & video tour", "Dedicated account manager", "Custom listing page branding", "Social media spotlight". WhatsApp notifications kept but explicitly **(coming soon)** since not implemented.

## Notes
- Free plan clearly shows **₹0 per month**; Pro **₹4,999**; Elite **₹9,999** (verified in the rendered page).
- Elite CTA now routes to `/contact` (added per-plan `ctaHref`); Free/Pro route to `/owner/register`.
- The comparison callout copy ("No lock-in. Cancel anytime.") contains no trial claim.
- Pricing UI unchanged structurally — premium 3-column responsive cards, "Most Popular" ring on Pro.
- **DB note:** the `premium_plans` table (migration 0013) still uses slugs `free/premium/pro` for the owner upgrade/activation flow. This pricing **page** is marketing content from `PREMIUM_TIERS`. If you want the DB plan prices to match (₹4,999 / ₹9,999), update them via the admin "edit plans" action or SQL — out of scope for this content change.
