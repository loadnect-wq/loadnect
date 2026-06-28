# Hallnect — Company Name Update Report

**Date:** 2026-06-28
**New legal/business name:** **Hallnect Pvt Ltd**

## Files updated
| File | Change |
|---|---|
| `app/(legal)/terms/page.tsx` | `[Hallnect Technologies Private Limited]` (placeholder) → **Hallnect Pvt Ltd**; removed the "(placeholder — to be updated…)" note |
| `app/(legal)/privacy/page.tsx` | `[Hallnect Technologies Private Limited]` (placeholder) → **Hallnect Pvt Ltd**; removed placeholder note |
| `components/layout/Footer.tsx` | Copyright line → "© {year} **Hallnect Pvt Ltd**. All rights reserved." |

## Checked, no change needed
- Refund Policy, Cancellation Policy, Disclaimer — referenced "Hallnect" (the brand) generally, no company-entity placeholder.
- No occurrences of "Your Company Name" or "Company Pvt Ltd" anywhere in the codebase.
- App display name (`APP_NAME = "Hallnect"`) is the product brand and is intentionally left as "Hallnect"; the legal entity "Hallnect Pvt Ltd" is used in legal/footer contexts.

## Verification
Runtime: `/terms` renders "Hallnect Pvt Ltd"; the old `Hallnect Technologies Private Limited` placeholder no longer appears. Footer copyright shows "Hallnect Pvt Ltd".
