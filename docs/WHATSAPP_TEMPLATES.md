# Hallnect — WhatsApp Content Templates

**MANUAL ACTION REQUIRED.** Each template below must be created in
Twilio Console → **Content Template Builder**, submitted for WhatsApp
approval by Meta, and its resulting Content SID pasted into the matching
environment variable. Nothing in this repository can perform that approval.

Until a template is approved and its SID is set, messages that need it are
recorded in the `notifications` table with status `skipped` and the exact
reason. Nothing is lost and nothing pretends to have sent.

## How to create one

1. Twilio Console → Messaging → Content Template Builder → **Create new**
2. Content type: **Text** (none of these use media or buttons)
3. Language: **English** (`en`)
4. Paste the body EXACTLY as given below, including the `{{1}}` placeholders
5. Submit for WhatsApp approval; category **Utility** for all of these
   (they are transactional, not marketing — Utility approves faster and
   costs less per message)
6. When approved, copy the Content SID (`HX…`) into the env var shown

> The bodies below are generated directly from
> `lib/notifications/whatsapp-templates.ts`, so they always match what the
> code actually sends. Regenerate this file if the copy changes.

---

## Customer templates

### CUSTOMER_BOOKING_CREATED

**When:** The customer submitted a booking request (before the venue has responded).

**Environment variable:** `TWILIO_TEMPLATE_CUSTOMER_BOOKING_CREATED`

**Variables (order matters — this is a contract):**

1. `{{1}}` — customer_name
2. `{{2}}` — hall_name
3. `{{3}}` — booking_date
4. `{{4}}` — amount
5. `{{5}}` — booking_id

**Body to submit for approval:**

```
Hello {{1}},

Your booking request for {{2}} has been submitted.

Date: {{3}}
Amount: {{4}}
Booking ID: {{5}}

We will update you once the venue confirms.

— Hallnect
```

### CUSTOMER_BOOKING_CONFIRMED

**When:** The venue owner accepted the booking.

**Environment variable:** `TWILIO_TEMPLATE_CUSTOMER_BOOKING_CONFIRMED`

**Variables (order matters — this is a contract):**

1. `{{1}}` — customer_name
2. `{{2}}` — hall_name
3. `{{3}}` — booking_date
4. `{{4}}` — booking_id

**Body to submit for approval:**

```
BOOKING CONFIRMED

Hello {{1}}, your booking is confirmed.

Hall: {{2}}
Date: {{3}}
Booking ID: {{4}}

Please carry a copy of your booking on the event day.

— Hallnect
```

### CUSTOMER_BOOKING_CANCELLED

**When:** The booking was cancelled or declined, by either side.

**Environment variable:** `TWILIO_TEMPLATE_CUSTOMER_BOOKING_CANCELLED`

**Variables (order matters — this is a contract):**

1. `{{1}}` — customer_name
2. `{{2}}` — hall_name
3. `{{3}}` — booking_date
4. `{{4}}` — booking_id
5. `{{5}}` — status_note

**Body to submit for approval:**

```
Hello {{1}},

Your booking has been cancelled.

Hall: {{2}}
Date: {{3}}
Booking ID: {{4}}
Status: {{5}}

Our team will contact you about anything outstanding.

— Hallnect
```

### CUSTOMER_PAYMENT_SUCCESS

**When:** A Cashfree payment was VERIFIED server-side (never from a browser claim).

**Environment variable:** `TWILIO_TEMPLATE_CUSTOMER_PAYMENT_SUCCESS`

**Variables (order matters — this is a contract):**

1. `{{1}}` — customer_name
2. `{{2}}` — hall_name
3. `{{3}}` — booking_id
4. `{{4}}` — amount_paid
5. `{{5}}` — balance_note

**Body to submit for approval:**

```
Payment received.

Hello {{1}}, thank you — your payment has been confirmed.

Hall: {{2}}
Booking ID: {{3}}
Amount paid: {{4}}
{{5}}

— Hallnect
```

### CUSTOMER_PAYMENT_FAILED

**When:** The gateway order expired or was terminated without payment.

**Environment variable:** `TWILIO_TEMPLATE_CUSTOMER_PAYMENT_FAILED`

**Variables (order matters — this is a contract):**

1. `{{1}}` — customer_name
2. `{{2}}` — hall_name
3. `{{3}}` — booking_id

**Body to submit for approval:**

```
Hello {{1}},

Your payment for {{2}} could not be completed.

Booking ID: {{3}}

Your dates are not held until payment succeeds. You can retry from My Bookings in your Hallnect account.

— Hallnect
```

### CUSTOMER_REFUND_INITIATED

**When:** A refund has genuinely been started for a paid booking.

**Environment variable:** `TWILIO_TEMPLATE_CUSTOMER_REFUND_INITIATED`

**Variables (order matters — this is a contract):**

1. `{{1}}` — customer_name
2. `{{2}}` — booking_id
3. `{{3}}` — amount

**Body to submit for approval:**

```
Hello {{1}},

A refund has been initiated for your booking.

Booking ID: {{2}}
Amount: {{3}}

Banks usually credit refunds within 5-7 working days.

— Hallnect
```

## Owner templates

### OWNER_NEW_BOOKING

**When:** A customer requested the owner's hall — the owner must accept or decline.

**Environment variable:** `TWILIO_TEMPLATE_OWNER_NEW_BOOKING`

**Variables (order matters — this is a contract):**

1. `{{1}}` — hall_name
2. `{{2}}` — customer_name
3. `{{3}}` — booking_date
4. `{{4}}` — booking_id
5. `{{5}}` — advance_paid
6. `{{6}}` — total_amount

**Body to submit for approval:**

```
NEW BOOKING REQUEST

Your hall has received a booking request.

Hall: {{1}}
Customer: {{2}}
Date: {{3}}
Booking ID: {{4}}
Advance paid: {{5}}
Total: {{6}}

Please accept or decline from your Hallnect owner dashboard.

— Hallnect
```

### OWNER_BOOKING_CANCELLED

**When:** A booking for the owner's hall was cancelled.

**Environment variable:** `TWILIO_TEMPLATE_OWNER_BOOKING_CANCELLED`

**Variables (order matters — this is a contract):**

1. `{{1}}` — hall_name
2. `{{2}}` — booking_date
3. `{{3}}` — booking_id

**Body to submit for approval:**

```
Booking cancelled.

Hall: {{1}}
Date: {{2}}
Booking ID: {{3}}

These dates are available again in your calendar.

— Hallnect
```

### OWNER_PAYMENT_RECEIVED

**When:** A customer's advance was verified for one of the owner's bookings.

**Environment variable:** `TWILIO_TEMPLATE_OWNER_PAYMENT_RECEIVED`

**Variables (order matters — this is a contract):**

1. `{{1}}` — hall_name
2. `{{2}}` — booking_id
3. `{{3}}` — amount

**Body to submit for approval:**

```
Payment received for your hall.

Hall: {{1}}
Booking ID: {{2}}
Amount: {{3}}

Accept the booking to have your share paid out automatically.

— Hallnect
```

### OWNER_HALL_SUBMITTED

**When:** The owner submitted a hall for review (creation or resubmission).

**Environment variable:** `TWILIO_TEMPLATE_OWNER_HALL_SUBMITTED`

**Variables (order matters — this is a contract):**

1. `{{1}}` — hall_name

**Body to submit for approval:**

```
Hall submitted for review.

{{1}} has been sent to the Hallnect team for verification. We will message you as soon as it is reviewed.

— Hallnect
```

### OWNER_HALL_APPROVED

**When:** An admin approved the hall; it is now publicly listed.

**Environment variable:** `TWILIO_TEMPLATE_OWNER_HALL_APPROVED`

**Variables (order matters — this is a contract):**

1. `{{1}}` — hall_name

**Body to submit for approval:**

```
Your hall is live.

{{1}} has been approved and is now visible to customers on Hallnect.

— Hallnect
```

### OWNER_HALL_REJECTED

**When:** An admin sent the hall back for changes, with a reason.

**Environment variable:** `TWILIO_TEMPLATE_OWNER_HALL_REJECTED`

**Variables (order matters — this is a contract):**

1. `{{1}}` — hall_name
2. `{{2}}` — reason

**Body to submit for approval:**

```
Changes needed before your hall goes live.

Hall: {{1}}
Reason: {{2}}

Update the details in your owner dashboard and submit it again.

— Hallnect
```

### OWNER_ACCOUNT_UPDATE

**When:** Account-level owner notice: premium listing, suspension, commission status.

**Environment variable:** `TWILIO_TEMPLATE_OWNER_ACCOUNT_UPDATE`

**Variables (order matters — this is a contract):**

1. `{{1}}` — subject
2. `{{2}}` — detail

**Body to submit for approval:**

```
Hallnect account update.

{{1}}

{{2}}

Open your owner dashboard for full details.

— Hallnect
```

## Admin templates

### ADMIN_ALERT

**When:** Operational alert to the platform admin: bookings, payments, halls, failures.

**Environment variable:** `TWILIO_TEMPLATE_ADMIN_ALERT`

**Variables (order matters — this is a contract):**

1. `{{1}}` — event
2. `{{2}}` — details
3. `{{3}}` — reference

**Body to submit for approval:**

```
HALLNECT ADMIN ALERT

Event: {{1}}
Details: {{2}}
Reference: {{3}}

Open the admin dashboard for full details.
```

---

## Checklist

| Template | Env var | Approved | SID set |
|---|---|---|---|
| CUSTOMER_BOOKING_CREATED | `TWILIO_TEMPLATE_CUSTOMER_BOOKING_CREATED` | ☐ | ☐ |
| CUSTOMER_BOOKING_CONFIRMED | `TWILIO_TEMPLATE_CUSTOMER_BOOKING_CONFIRMED` | ☐ | ☐ |
| CUSTOMER_BOOKING_CANCELLED | `TWILIO_TEMPLATE_CUSTOMER_BOOKING_CANCELLED` | ☐ | ☐ |
| CUSTOMER_PAYMENT_SUCCESS | `TWILIO_TEMPLATE_CUSTOMER_PAYMENT_SUCCESS` | ☐ | ☐ |
| CUSTOMER_PAYMENT_FAILED | `TWILIO_TEMPLATE_CUSTOMER_PAYMENT_FAILED` | ☐ | ☐ |
| CUSTOMER_REFUND_INITIATED | `TWILIO_TEMPLATE_CUSTOMER_REFUND_INITIATED` | ☐ | ☐ |
| OWNER_NEW_BOOKING | `TWILIO_TEMPLATE_OWNER_NEW_BOOKING` | ☐ | ☐ |
| OWNER_BOOKING_CANCELLED | `TWILIO_TEMPLATE_OWNER_BOOKING_CANCELLED` | ☐ | ☐ |
| OWNER_PAYMENT_RECEIVED | `TWILIO_TEMPLATE_OWNER_PAYMENT_RECEIVED` | ☐ | ☐ |
| OWNER_HALL_SUBMITTED | `TWILIO_TEMPLATE_OWNER_HALL_SUBMITTED` | ☐ | ☐ |
| OWNER_HALL_APPROVED | `TWILIO_TEMPLATE_OWNER_HALL_APPROVED` | ☐ | ☐ |
| OWNER_HALL_REJECTED | `TWILIO_TEMPLATE_OWNER_HALL_REJECTED` | ☐ | ☐ |
| OWNER_ACCOUNT_UPDATE | `TWILIO_TEMPLATE_OWNER_ACCOUNT_UPDATE` | ☐ | ☐ |
| ADMIN_ALERT | `TWILIO_TEMPLATE_ADMIN_ALERT` | ☐ | ☐ |
