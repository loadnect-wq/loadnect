# Local SEO — Hallnect

Local is where a Tamil Nadu wedding-hall marketplace actually competes. Most of this is blocked on one action only you can take.

---

## 1. The blocker: verify the Google Business Profile

**Profile `04707753343253147703`, created 2026-08-26 under loadnect@gmail.com. It is NOT verified, and until it is, nothing on it appears in Search or Maps.**

Manage it at https://business.google.com/ (or search "my business" while signed in).

Already configured and correct — do not change these while verification is pending, because edits can reset the review:

| Field | Value |
|---|---|
| Name | `Hallnect` — no keywords or suffixes, per Google's naming rule |
| Category | Wedding service |
| Type | Service business only (no storefront) |
| Service area | Madurai, Tamil Nadu |
| Phone | 9344040013 |
| Website | https://hallnect.com/ |
| Hours | 09:00–21:00, all seven days |
| Services | Wedding hall booking · Marriage hall booking · Event venue booking |

**To verify:** open the profile, follow the prompt, and complete whichever method Google offers — usually **video verification** for a service-area business. Video is the most common and the most often failed. What Google wants to see, in one unbroken recording:

1. The business location or work area
2. Evidence you operate the business — signage, equipment, branded material, or the tools of the trade
3. You, showing you have authority over it

Record in one take, do not stop, and show the surroundings before the interior. If it is rejected, you can retry; a second rejection takes much longer to appeal, so it is worth preparing before the first attempt.

**A caution on eligibility.** Google requires in-person contact with customers during stated hours. The profile rests on the statement that the team visits venues in person. Online-only and pure lead-generation businesses are **not** eligible. If that stops being true, the profile should be reconsidered rather than re-worded — a profile suspended for eligibility is much harder to recover than one never created.

## 2. Keep NAP identical everywhere

Name, Address, Phone must match **character for character** across the GBP, the site and any directory. Inconsistency is the classic local-SEO own goal.

The site's values live in one place — `lib/constants.ts` → `CONTACT` — and `/contact`, `/about` and the JSON-LD all read from it, so the site cannot disagree with itself. What must be kept in sync manually is **the GBP against that constant**.

| Field | Canonical value |
|---|---|
| Name | Hallnect |
| Legal entity | HALLNECT LLP (LLPIN ADA-7588) |
| Address | No. 68, Venkateshwara Nagar, Sundar Nagar Extension, Tirunagar, Madurai – 625006, Tamil Nadu, India |
| Phone | +91 9344040013 |
| Email | hallnect@gmail.com |
| Website | https://hallnect.com |
| Hours | 09:00–21:00, seven days |

**Hours are the field most likely to drift.** They appear in exactly two places: the GBP, and `SUPPORT_HOURS` in `lib/constants.ts` — which feeds both the sentence on `/contact` and the `OpeningHoursSpecification` in the site's structured data. Change one, change the other in the same sitting. Google cross-references a profile against its website.

## 3. What the site already publishes

Verified live: the homepage emits `Organization` with `areaServed`, a `ContactPoint`, and `OpeningHoursSpecification` built from the same constants the page renders. `/contact` and `/about` now emit `Organization` too.

`sameAs` is deliberately **absent** — Hallnect has no verified social profile, and listing one that does not exist is fabricating business information. Add real profiles to `organizationJsonLd()` in `lib/seo/jsonld.ts` when they exist, not before.

The venue node is typed `EventVenue`, not `LocalBusiness`, and must stay that way: `LocalBusiness` implies a storefront, which would contradict the GBP's service-area registration. This is pinned by a test.

## 4. Directories worth being in

Legitimate, free, and relevant. Use the exact NAP above for each.

- Justdial — the highest-traffic Indian local directory
- IndiaMART / Sulekha — wedding services category
- WeddingWire India, WedMeGood — wedding-specific, and where couples actually search
- Google Maps (follows from GBP verification)
- Bing Places — import from GBP once verified

Do **not** buy directory-submission packages. They create inconsistent NAP at scale, which is worse than no listing.

## 5. Venue owners' own local presence

Each hall is a real physical place and should have its **own** Google Business Profile, owned by the venue — not by Hallnect. Creating profiles for venues you do not own violates Google's guidelines and risks your own profile.

What you can legitimately do, and what helps both sides:
- Ask each owner, at onboarding, whether their venue has a verified GBP
- Ask them to list `https://hallnect.com/halls/<their-slug>` in the profile's website or services section
- That is a genuine citation from a relevant local entity, and it is the owner's to give

## 6. Reviews

Reviews on the GBP must come from real customers of Hallnect, unprompted by incentive. Do not solicit reviews in exchange for anything, do not write them, and do not ask staff or family. A review-gating flow (asking only happy customers) also violates Google's policy.

With zero completed bookings there is nothing to ask for yet. The honest first step is completing a booking.
