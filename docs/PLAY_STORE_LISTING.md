# Hallnect — Google Play listing & compliance pack

Everything the Play Console asks for, prepared from the application as it
actually is. Nothing here claims a capability the app does not have.

---

## Store listing

**App name:** HALLNECT

**Short description** (≤ 80 chars):

> Premium wedding hall and event venue booking platform.

**Full description:**

> HALLNECT makes booking a wedding hall or event venue in Tamil Nadu simple,
> transparent and secure.
>
> FOR CUSTOMERS
> • Browse verified wedding halls and event venues with photos, capacity and
>   amenities
> • Check real availability and pick your dates — single-day or multi-day
>   events up to 4 days
> • Transparent pricing with the advance amount shown before you pay
> • Pay the advance securely online (UPI, cards, net banking via Cashfree)
> • Get booking updates on WhatsApp — request received, venue confirmed,
>   payment received
> • Manage and cancel bookings from your dashboard
>
> FOR VENUE OWNERS
> • List your hall with photos, pricing, capacity and custom amenities
> • Accept or decline booking requests from your dashboard
> • Receive the customer's advance automatically on acceptance — the platform
>   commission is deducted transparently, no separate bills
> • WhatsApp alerts for new bookings, payments and listing approvals
>
> Every venue is reviewed by the Hallnect team before it goes live.

**Category:** Events (House & Home / Lifestyle also acceptable; Events is the
best fit)

**Contact email:** hallnect@gmail.com
**Website:** https://www.hallnect.com
**Privacy policy URL:** https://www.hallnect.com/privacy ← verified live, public, mobile-readable
**Terms:** https://www.hallnect.com/terms ← verified live
**Refund policy:** https://www.hallnect.com/refund-policy ← verified live

**Release notes (v1.0.0):**

> First release of the HALLNECT app: browse venues, check availability, book
> with secure online payment, and manage your bookings — with WhatsApp updates
> at every step.

---

## Graphics

| Asset | Requirement | Status |
|---|---|---|
| App icon | 512×512 PNG | ✅ `docs/play-assets/play-store-icon-512.png` |
| Feature graphic | 1024×500 PNG/JPG | ⚠ MANUAL — design one with the logo on the maroon/gold gradient |
| Phone screenshots | ≥ 2, 16:9–9:16 | ⚠ MANUAL — capture from a real device/emulator once the app is installed; suggested pages: home, hall details, booking dates, owner dashboard |

---

## Data safety form — answer sheet

Derived from the actual code (Supabase tables, booking flow, Cashfree
integration). The app itself is a WebView client; all collection happens
through the website inside it, which for this form counts as collection by
the app.

**Does your app collect or share any of the required user data types?** YES

| Data type | Collected? | Shared? | Purpose | Optional? |
|---|---|---|---|---|
| Name | Yes | No | Account management, bookings | Required for booking |
| Email address | Yes | No | Account management | Required (login) |
| Phone number | Yes | No | Booking contact, WhatsApp notifications | Required for booking |
| Photos | Yes (venue owners only) | No | Hall listing images | Optional (owners) |
| Purchase history | Yes | No | Booking/payment records | Required for booking |
| Payment info | **No** — card/UPI details are entered on Cashfree's PCI-DSS pages; Hallnect never sees or stores them | — | — | — |
| Precise location | No | — | — | — |
| Contacts / SMS / call logs | No | — | — | — |

**Is data encrypted in transit?** Yes (HTTPS everywhere; cleartext disabled in the app).
**Can users request deletion?** Yes — account deletion via support (hallnect@gmail.com); state this in the form.
**Data shared with third parties:** payment processing is performed BY
Cashfree on their own pages (processor relationship); WhatsApp notifications
are delivered via Twilio as a processor. Neither receives data for their own
use — answer "No" to selling/sharing for advertising.

---

## Content rating questionnaire

- Category: Utility / commerce app
- Violence, sexuality, profanity, drugs, gambling: **None**
- User-generated content: **Yes, moderated** (venue owners upload hall photos
  and descriptions; every listing is reviewed by an admin before it is
  publicly visible — answer the UGC section accordingly)
- Expected rating: **Everyone / PEGI 3**

## App content declarations

- **Ads:** None
- **In-app purchases:** None (payments are for real-world venue bookings —
  physical services, correctly OUTSIDE Play Billing per Play's payments
  policy)
- **Target audience:** 18+ (people booking event venues)
- **Login required:** provide Play reviewers a demo account OR mark that
  browsing works without login (halls are browsable logged-out; booking
  needs an account)
