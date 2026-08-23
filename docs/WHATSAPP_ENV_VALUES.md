# Hallnect — WhatsApp environment values

All 14 Content Templates were created in Twilio and submitted to Meta for
approval on **2026-08-23**, category **Utility**, language **English (EN)**.
Every one came back `Received` and moves to `Pending` → `Approved` as Meta
reviews it (usually under 48 hours).

**None of the values on this page are secrets.** A Content SID identifies
approved, public message copy — not a credential. The two actual secrets
(`TWILIO_AUTH_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`) are deliberately absent and
must never be written into this repository.

---

## Paste into Vercel → Hallnect → Settings → Environment Variables

### Sender and credentials

```
TWILIO_WHATSAPP_FROM=+15554741132
```

Two more come straight from **Twilio Console → Account Info**, and neither is
written down here:

* `TWILIO_ACCOUNT_SID` — GitHub's secret scanning treats an `AC…` string as a
  detectable credential pattern and blocks any push containing one, so it is
  deliberately not committed. Copy it from the console.
* `TWILIO_AUTH_TOKEN` — a genuine secret. Copy it from the console.

### The 14 Content SIDs

```
TWILIO_TEMPLATE_CUSTOMER_BOOKING_CREATED=HX14e0b50e069d1fb9252a14b517b96be0
TWILIO_TEMPLATE_CUSTOMER_BOOKING_CONFIRMED=HX298d9b7788d1061744552717cec32a1a
TWILIO_TEMPLATE_CUSTOMER_BOOKING_CANCELLED=HX1d78e2b7fb7050bd96cf8721d9bd7e25
TWILIO_TEMPLATE_CUSTOMER_PAYMENT_SUCCESS=HXc1d875d3f082f602d6c15545bf2505a7
TWILIO_TEMPLATE_CUSTOMER_PAYMENT_FAILED=HX0dbe5d04c1ee8932aaa1e2b86ee1f766
TWILIO_TEMPLATE_CUSTOMER_REFUND_INITIATED=HXf7a7f2861adeed9ae099b2bdea64a281
TWILIO_TEMPLATE_OWNER_NEW_BOOKING=HXe6382826106ac0e3b271bd5d8bdae58e
TWILIO_TEMPLATE_OWNER_BOOKING_CANCELLED=HXca6ecff2d3b463ce8dbed2522d19d27a
TWILIO_TEMPLATE_OWNER_PAYMENT_RECEIVED=HX584a91ac29160df13fb67176142cb850
TWILIO_TEMPLATE_OWNER_HALL_SUBMITTED=HXef89eb8808875181a4b64fd7ddc8f693
TWILIO_TEMPLATE_OWNER_HALL_APPROVED=HX4ebe801ffd9755d5de465cbaa46f2f45
TWILIO_TEMPLATE_OWNER_HALL_REJECTED=HXaf2f66b7779887987ce6f64658029d6a
TWILIO_TEMPLATE_OWNER_ACCOUNT_UPDATE=HXe824e1ca25fdb7d10b94c3e79e6b579f
TWILIO_TEMPLATE_ADMIN_ALERT=HXc3cd309d961671b67a718ebcd5afeb98
```

### The master switch — set LAST

```
TWILIO_WHATSAPP_ENABLED=true
```

Leave this `false` until Meta has approved the templates. With it off, every
message is still recorded in the `notifications` table with status `skipped`
and a precise reason, so the whole pipeline stays observable and nothing
pretends to have sent.

---

## What is already handled in code

**The delivery status callback needs no console configuration.** Every send
passes `StatusCallback` per message (lib/twilio/whatsapp.ts, wired from
lib/notifications/service.ts), and a per-message callback overrides any
account-level setting. Delivery receipts reach
`https://www.hallnect.com/api/webhooks/twilio-whatsapp` automatically, where
they are signature-verified before anything is written.

---

## WhatsApp sender

| | |
|---|---|
| WhatsApp Business Account ID | `1803215767371213` |
| Meta Business Manager ID | `1028905713298257` |
| Sender | `+15554741132` |
| Display name | Hallnect |
| Status | Online |
| Throughput | 80 MPS |

---

## Checking approval status

Twilio Console → Messaging → Content Template Builder. Each template shows a
**WhatsApp approval status**. The admin dashboard at `/admin/notifications`
also lists which templates are still missing a Content SID, so a partially
configured deployment is visible rather than silent.

If Meta rejects one, the usual causes are a body that is mostly variable, or a
category mismatch (these are all correctly filed as **Utility** — transactional
updates about an existing booking, not marketing).
