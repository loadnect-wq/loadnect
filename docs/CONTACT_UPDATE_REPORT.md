# Hallnect — Contact Update Report

**Date:** 2026-06-26

## New business contact details
- **Email:** hallnect@gmail.com
- **Phone:** +91 6383956613, +91 6380714364
- **Address:** Thirunagar, Madurai, Tamil Nadu, India

## Centralized source
Added a single source of truth: `CONTACT` in **`lib/constants.ts`** (`email`, `phones[]`, `address`). The contact page and footer read from it so future changes happen in one place.

## Files updated
| File | What changed |
|---|---|
| `lib/constants.ts` | **Added** `CONTACT` constant (email/phones/address) |
| `app/contact/page.tsx` | `CONTACT_ITEMS` now reads `CONTACT` — replaced `support@hallnect.com`, `+91 98765 43210`, `Mumbai, Maharashtra` |
| `components/layout/Footer.tsx` | Added a contact block (email/phone/address) from `CONTACT` |
| `app/(legal)/terms/page.tsx` | `legal@hallnect.com` → `hallnect@gmail.com`; jurisdiction `[Mumbai, Maharashtra]` → `Madurai, Tamil Nadu` |
| `app/(legal)/privacy/page.tsx` | `privacy@hallnect.com` + `security@hallnect.com` → `hallnect@gmail.com` |
| `app/(legal)/refund-policy/page.tsx` | `support@hallnect.com` → `hallnect@gmail.com` |
| `app/(legal)/cancellation-policy/page.tsx` | `support@hallnect.com` → `hallnect@gmail.com` |
| `app/(legal)/disclaimer/page.tsx` | `support@hallnect.com` → `hallnect@gmail.com` |
| `app/global-error.tsx` | `support@hallnect.com` → `hallnect@gmail.com` |
| `app/approval-pending/page.tsx` | `support@hallnect.com` → `hallnect@gmail.com` |

## Verified (runtime)
Contact page renders `hallnect@gmail.com`, both phone numbers, and the Thirunagar/Madurai address; old `support@hallnect.com` and `Mumbai` no longer appear.

## Notes
- Form **input placeholders** that previously showed `+91 98765 43210` (profile/booking forms) are format hints, not displayed contact info — left as conventional placeholders (the owner-profile phone field and booking phone field). They never display the old number as real contact data.
- The company-name placeholder `[Hallnect Technologies Private Limited]` in legal pages is unchanged (still to be set with your registered entity before launch).
