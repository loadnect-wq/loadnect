# Messaging: MSG91 (SMS + OTP)

MSG91 is the **only** messaging provider. Booking, payment, moderation and
admin notifications are transactional SMS; phone verification is MSG91's OTP
product. There is no second transport and no fallback: a message either goes
over MSG91 or it is recorded as not sent, with the reason.

> **The blocker is not code.** Everything below is built and tested. Nothing can
> be delivered to an Indian number until a DLT registration exists — see
> [Before anything can send](#before-anything-can-send). Until then the app runs
> normally and every message is recorded as `skipped`.

---

## Architecture

| File | Responsibility |
|---|---|
| `lib/msg91/config.ts` | Credentials, sender header, switches, masked admin status |
| `lib/msg91/client.ts` | The one HTTP path. Turns MSG91's HTTP-200-on-failure into `ok:false` |
| `lib/msg91/otp.ts` | Send / resend / verify a one-time code |
| `lib/msg91/sms.ts` | Transactional SMS over the Flow API |
| `lib/notifications/sms-templates.ts` | The template registry — the single source of the copy |
| `lib/notifications/events.ts` | Business event → who gets which template |
| `lib/notifications/service.ts` | The outbox: dedupe, rate limits, attempt claiming, sending |
| `app/api/webhooks/msg91/route.ts` | Delivery reports |
| `app/verify-phone/actions.ts` | The OTP server actions |

Two invariants worth knowing before changing anything:

- **Recipients and content are server-decided.** Call sites pass entity ids and
  a template key. No function accepts a client-supplied phone + message pair, so
  a customer can never choose the recipient, the sender, or the template.
- **A message failure never fails the business action.** Every error is recorded
  on the outbox row and swallowed. A booking succeeds even if every SMS fails.

### The one trap that matters

MSG91 answers **HTTP 200 for logical failures**:

```
200 OK   {"type":"error","message":"OTP not match"}
```

Code that trusts `res.ok` therefore reads a **wrong OTP as a successful
verification**. `lib/msg91/client.ts` judges every response on the `type` field,
in one place, so no caller can get this wrong. Do not add a second HTTP path.

### The other one: GSM-7

An SMS containing one character outside the GSM-7 alphabet is encoded as UCS-2,
and the segment size drops from **160 characters to 70**. The rupee sign, the em
dash and curly quotes are all outside GSM-7 — so `Rs.1,00,000` is one segment
and `₹1,00,000` is three, on every booking, forever.

`coerceVariables()` forces every interpolated value through `toGsm7()` before it
is rendered *or* sent, so the stored message and the delivered one cannot
differ. `segmentCount()` is shown per template in the admin dashboard, and a
test fails if any template exceeds two segments.

---

## Environment variables

All are server-only. None is ever exposed to the browser.

| Variable | Secret | Purpose |
|---|---|---|
| `MSG91_AUTH_KEY` | yes | Account key. MSG91 panel → **AuthKey** (viewing it needs an OTP to the registered mobile) |
| `MSG91_SENDER_ID` | no | The DLT-approved 6-character header, e.g. `HLNECT` |
| `MSG91_SMS_ENABLED` | no | Master switch for notification SMS. Defaults to **false** |
| `MSG91_TEST_MODE` | no | Redirect every notification SMS to `MSG91_TEST_TO` |
| `MSG91_TEST_TO` | no | Where test-mode messages go. **Required** when test mode is on |
| `MSG91_OTP_TEMPLATE_ID` | no | MSG91 template id for the OTP body (24 hex chars) |
| `MSG91_TEMPLATE_<KEY>` | no | One per template — see the list below |
| `MSG91_WEBHOOK_SECRET` | yes | Shared secret for the delivery-report webhook |
| `ADMIN_ALERT_PHONE` | no | Fallback admin alert number (the DB setting wins) |

A few deliberate behaviours:

- `MSG91_SMS_ENABLED` defaults to **false**. A deployment with credentials that
  has not been switched on sends nothing — the opposite default messages real
  customers from staging.
- `MSG91_TEST_MODE` with no `MSG91_TEST_TO` **fails the send** rather than
  falling through to the real recipient. Falling through is exactly the accident
  the flag exists to prevent.
- OTP is **not** redirected by test mode. An OTP proves control of the number it
  was sent to; diverting it would verify the wrong phone.
- A malformed `MSG91_SENDER_ID` or template id is treated as **unset**, so a typo
  shows up in `/admin/notifications` instead of as a rejected send in production.

> Vercel bakes environment variables at **build** time. Changing one in the
> dashboard does not affect the running deployment — redeploy. See
> [DEPLOYING.md](DEPLOYING.md).

---

## Before anything can send

Indian A2P SMS runs under TRAI's **DLT** regime. Four things must exist, in this
order, and none of them can be created by writing code:

1. **A Principal Entity (PE) registration** on a telecom DLT portal
   (Jio, Airtel, VI, BSNL — any one; the registration is shared). Needs the
   business's PAN/GST and a one-time fee, and takes a few days.
2. **A registered header** — the 6-character sender ID, approved against that PE.
3. **A registered template** per message body, approved against that header.
   The operator matches the delivered text against the registered body
   **character for character**.
4. **The MSG91 objects**: the header added at *SMS → Sender Id*, and each body
   added at *SMS → Templates* (or *OTP → Templates* for the OTP one) with its
   DLT template id. MSG91 then issues its own 24-hex template id — that is the
   value that goes in `MSG91_TEMPLATE_*`.

**A message whose body does not match a registered template is dropped by the
operator silently** — there is no error to catch. That is why nothing in the
admin dashboard ever claims a template is "approved": DLT approval lives with
the operator and is not queryable from any API. The dashboard reports only what
it can actually check — whether a template id is configured.

**Register every template as Service Implicit.** The category is not cosmetic:
Service Implicit messages are delivered 24x7 *and reach numbers on the DND
registry*, which is what makes booking confirmations and your own admin alerts
arrive at all. Service Explicit is blocked on DND and is rejected outright
without a linked consent template; Promotional is blocked on DND and confined to
10am-9pm; Transactional is reserved for banks.

Two further limits worth knowing:

- **DND / NDNC.** Only a concern if a template is registered under the wrong
  category. Service Implicit reaches DND numbers; Service Explicit and
  Promotional do not.
- **Variable length.** Operators cap DLT variable content (commonly 30
  characters). `MAX_VARIABLE_LENGTH` truncates and marks values so an over-long
  venue name shortens the message instead of having the whole thing rejected.

---

## Delivery reports

MSG91 does **not** sign its callbacks — there is no HMAC to verify — so a shared
secret is the only real control.

1. Generate a long random value and set `MSG91_WEBHOOK_SECRET`.
2. MSG91 panel → **SMS → Webhook → Create webhook**
   - Event: **On Delivered Events** (repeat for **On Failed** / **On Rejected**)
   - Method `POST`, Content-Type `JSON`
   - URL: `https://hallnect.com/api/webhooks/msg91`
   - **Body**:
     ```json
     { "requestId": "{{CRQID}}", "status": "{{status}}", "number": "{{telNum}}", "requestedAt": "{{requestedAt}}" }
     ```
   - **Headers**: `x-hallnect-webhook-secret: <the same value>`

While `MSG91_WEBHOOK_SECRET` is unset the endpoint returns **503 and accepts
nothing**. It writes to the notifications table, so an unauthenticated version
would let anyone who guessed a request id mark another customer's message
"delivered".

The parser accepts a single object or an array, and several spellings of the id,
because that payload is edited by hand in a web form. Anything unrecognised is
logged rather than silently dropped.

---

## Phone OTP

MSG91 generates, stores, expires and checks the code. **This codebase never
creates, stores or logs an OTP.** The only OTP value that enters the process is
the one the user types, and it goes straight back out to `/otp/verify`.

Rate limiting lives in the **database** (`otp_attempts`), not in a module-level
Map. On serverless a Map resets on every cold start and is not shared between
instances, so "5 sends per hour" was really "5 per hour per lambda" — no ceiling
at all against anyone willing to retry until they landed on a fresh instance.

| Ceiling | Value | Scope | Stops |
|---|---|---|---|
| Resend cooldown | 60 s | user + phone | Hammering |
| Sends per hour | 5 | user + phone | Ordinary abuse |
| Sends per day | 10 | **phone** | One attacker rotating accounts to SMS-bomb a victim |
| Failed checks | 5 / 15 min | **phone** | Brute-forcing a 6-digit code |

Two distinctions the code is careful about:

- **A provider outage is not a failed attempt.** Counting it would let MSG91
  being down lock a legitimate user out of their own account.
- **Resend re-sends the same code** (`/otp/retry`), it does not mint a new one.
  A user who taps Resend and then receives the first SMS can still use it.

After a successful verification, any *other* profile still claiming that number
as verified has its flag cleared: only one person can control a number at a
time. The number itself is left in place — it is that account's contact detail,
and blanking it would strand their bookings.

---

## Testing

```bash
npm test
```

Covers the HTTP-200-on-failure trap, the three-way OTP outcome
(approved / rejected / unanswered), test-mode redirection and its fail-closed
behaviour, `var1..varN` mapping, GSM-7 safety, segment counts, and template id
validation.

To exercise the real provider without messaging customers:

```
MSG91_SMS_ENABLED=true
MSG91_TEST_MODE=true
MSG91_TEST_TO=+91XXXXXXXXXX
```

Everything is then sent for real, through the real templates, to one number.
Those rows are flagged **TEST** in `/admin/notifications`.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Rows land as `skipped` | `MSG91_SMS_ENABLED` is false, or credentials / template id missing. The row's `error_message` names the exact variable |
| `MSG91 rejected the auth key` | Wrong or rotated `MSG91_AUTH_KEY` — or the variable was changed without a redeploy |
| `template not found` | The `MSG91_TEMPLATE_*` id is not a template on this account |
| Accepted, never delivered | Body does not match the DLT-registered text character for character, or the template was registered under a category that DND blocks. Check *SMS → Logs* in the panel |
| Delivery status stuck at `accepted` | The webhook is not configured, or its secret header does not match |
| Message is 3 segments | A non-GSM-7 character reached the wire. `toGsm7()` should have caught it — check what changed |
| OTP screen says "not available yet" | `MSG91_AUTH_KEY` or `MSG91_OTP_TEMPLATE_ID` missing, or the template id is not 24 hex characters |

---

## The OTP body

Registered separately from the fifteen below, because MSG91's OTP product renders
it — this codebase never composes it, which is also why it is not in
`lib/notifications/sms-templates.ts`. Register it under **Service Implicit**, like
the rest.

Register this body on the DLT portal:

```
Hallnect: {#var#} is your verification code. It is valid for 10 minutes. Do not share it with anyone.
```

Paste this into MSG91 → OTP → Templates. The `##OTP##` placeholder is required —
MSG91 rejects an OTP template without it:

```
Hallnect: ##OTP## is your verification code. It is valid for 10 minutes. Do not share it with anyone.
```

The ten-minute validity must match `otp_expiry` in `lib/msg91/otp.ts`. If you
register a different window, change it there too — a message promising ten
minutes on a code that expires in five is a support ticket per user.

---

## The templates

Generated from `lib/notifications/sms-templates.ts` — the same code that renders
the real messages, so the registered body and what is sent cannot drift apart.
`/admin/notifications` shows this same list live, with configuration status.

**Variable order is a contract.** Once a template is registered, position 1
means what it meant at registration. Add new variables at the END and
re-register.

### What the DLT operator actually rejects

On 2026-09-03 the operator (STPL) approved the OTP template and rejected three
of these, with these remarks:

| Template | Remark |
|---|---|
| booking confirmed | Please specify which booking in the content. |
| owner new booking | Please specify which booking in the content. |
| payment success | Purpose of template is not clear. |

The tagging, header, category and sample content were all accepted — the
objection was to the **copy**. A reviewer reads one template with no product
around it, and every variable is opaque to them, so "your booking at {#var#}"
says nothing about what was booked. Every body therefore names its subject in
**fixed text** — "hall booking", "advance payment", "hall listing", "premium
listing plan" — and never leaves that noun to a variable.

Keep this in mind when registering the remaining templates, and do not shorten
those words back out to save a segment.

### CUSTOMER_BOOKING_CREATED

The customer submitted a booking request (before the venue has responded).

| | |
|---|---|
| Audience | customer |
| Env var | `MSG91_TEMPLATE_CUSTOMER_BOOKING_CREATED` |
| Variables | `1` customer_name · `2` hall_name · `3` booking_date · `4` amount · `5` booking_id |
| Segments | 2 |

**Register this body on the DLT portal** (`{#var#}` is the DLT placeholder):

```
Hallnect: Hi {#var#}, your hall booking request for {#var#} on {#var#} is submitted. Total {#var#}. Ref {#var#}. We will text you when the venue responds.
```

**Paste this into the MSG91 template editor:**

```
Hallnect: Hi ##var1##, your hall booking request for ##var2## on ##var3## is submitted. Total ##var4##. Ref ##var5##. We will text you when the venue responds.
```

### CUSTOMER_BOOKING_CONFIRMED

The venue owner accepted the booking.

| | |
|---|---|
| Audience | customer |
| Env var | `MSG91_TEMPLATE_CUSTOMER_BOOKING_CONFIRMED` |
| Variables | `1` customer_name · `2` hall_name · `3` booking_date · `4` booking_id |
| Segments | 2 |

**Register this body on the DLT portal** (`{#var#}` is the DLT placeholder):

```
Hallnect: Hi {#var#}, your hall booking at {#var#} on {#var#} is CONFIRMED. Ref {#var#}. Please carry your booking details on the event day.
```

**Paste this into the MSG91 template editor:**

```
Hallnect: Hi ##var1##, your hall booking at ##var2## on ##var3## is CONFIRMED. Ref ##var4##. Please carry your booking details on the event day.
```

### CUSTOMER_BOOKING_CANCELLED

The booking was cancelled or declined, by either side.

| | |
|---|---|
| Audience | customer |
| Env var | `MSG91_TEMPLATE_CUSTOMER_BOOKING_CANCELLED` |
| Variables | `1` customer_name · `2` hall_name · `3` booking_date · `4` booking_id · `5` status_note |
| Segments | 2 |

**Register this body on the DLT portal** (`{#var#}` is the DLT placeholder):

```
Hallnect: Hi {#var#}, your hall booking at {#var#} on {#var#} is cancelled. Ref {#var#}. {#var#}. Our team will contact you about anything outstanding.
```

**Paste this into the MSG91 template editor:**

```
Hallnect: Hi ##var1##, your hall booking at ##var2## on ##var3## is cancelled. Ref ##var4##. ##var5##. Our team will contact you about anything outstanding.
```

### CUSTOMER_PAYMENT_SUCCESS

A Cashfree payment was VERIFIED server-side (never from a browser claim).

| | |
|---|---|
| Audience | customer |
| Env var | `MSG91_TEMPLATE_CUSTOMER_PAYMENT_SUCCESS` |
| Variables | `1` customer_name · `2` hall_name · `3` booking_id · `4` amount_paid · `5` balance_note |
| Segments | 1 |

**Register this body on the DLT portal** (`{#var#}` is the DLT placeholder):

```
Hallnect: Hi {#var#}, we have received your advance payment of {#var#} for your hall booking at {#var#}. Ref {#var#}. {#var#}
```

**Paste this into the MSG91 template editor:**

```
Hallnect: Hi ##var1##, we have received your advance payment of ##var4## for your hall booking at ##var2##. Ref ##var3##. ##var5##
```

### CUSTOMER_PAYMENT_FAILED

The gateway order expired or was terminated without payment.

| | |
|---|---|
| Audience | customer |
| Env var | `MSG91_TEMPLATE_CUSTOMER_PAYMENT_FAILED` |
| Variables | `1` customer_name · `2` hall_name · `3` booking_id |
| Segments | 2 |

**Register this body on the DLT portal** (`{#var#}` is the DLT placeholder):

```
Hallnect: Hi {#var#}, your advance payment for the hall booking at {#var#} could not be completed. Ref {#var#}. Your dates are not held until payment succeeds. You can retry from My Bookings.
```

**Paste this into the MSG91 template editor:**

```
Hallnect: Hi ##var1##, your advance payment for the hall booking at ##var2## could not be completed. Ref ##var3##. Your dates are not held until payment succeeds. You can retry from My Bookings.
```

### CUSTOMER_REFUND_INITIATED

A refund has genuinely been sent for a paid booking.

| | |
|---|---|
| Audience | customer |
| Env var | `MSG91_TEMPLATE_CUSTOMER_REFUND_INITIATED` |
| Variables | `1` customer_name · `2` booking_id · `3` amount |
| Segments | 1 |

**Register this body on the DLT portal** (`{#var#}` is the DLT placeholder):

```
Hallnect: Hi {#var#}, a refund of {#var#} has been initiated for your hall booking {#var#}. Banks usually credit refunds within 5-7 working days.
```

**Paste this into the MSG91 template editor:**

```
Hallnect: Hi ##var1##, a refund of ##var3## has been initiated for your hall booking ##var2##. Banks usually credit refunds within 5-7 working days.
```

### OWNER_NEW_BOOKING

A customer requested the owner's hall — the owner must accept or decline.

| | |
|---|---|
| Audience | owner |
| Env var | `MSG91_TEMPLATE_OWNER_NEW_BOOKING` |
| Variables | `1` hall_name · `2` customer_name · `3` booking_date · `4` booking_id · `5` advance_paid · `6` total_amount |
| Segments | 2 |

**Register this body on the DLT portal** (`{#var#}` is the DLT placeholder):

```
Hallnect: New hall booking request for {#var#} from {#var#} on {#var#}. Ref {#var#}. Advance {#var#}, total {#var#}. Accept or decline in your owner dashboard.
```

**Paste this into the MSG91 template editor:**

```
Hallnect: New hall booking request for ##var1## from ##var2## on ##var3##. Ref ##var4##. Advance ##var5##, total ##var6##. Accept or decline in your owner dashboard.
```

### OWNER_BOOKING_CANCELLED

A booking for the owner's hall was cancelled.

| | |
|---|---|
| Audience | owner |
| Env var | `MSG91_TEMPLATE_OWNER_BOOKING_CANCELLED` |
| Variables | `1` hall_name · `2` booking_date · `3` booking_id |
| Segments | 1 |

**Register this body on the DLT portal** (`{#var#}` is the DLT placeholder):

```
Hallnect: The hall booking at {#var#} on {#var#} (ref {#var#}) is cancelled. These dates are available again in your calendar.
```

**Paste this into the MSG91 template editor:**

```
Hallnect: The hall booking at ##var1## on ##var2## (ref ##var3##) is cancelled. These dates are available again in your calendar.
```

### OWNER_PAYMENT_RECEIVED

A customer's advance was verified for one of the owner's bookings.

| | |
|---|---|
| Audience | owner |
| Env var | `MSG91_TEMPLATE_OWNER_PAYMENT_RECEIVED` |
| Variables | `1` hall_name · `2` booking_id · `3` amount |
| Segments | 1 |

**Register this body on the DLT portal** (`{#var#}` is the DLT placeholder):

```
Hallnect: Advance payment of {#var#} received for a hall booking at {#var#}. Ref {#var#}. Accept the booking to have your share paid out.
```

**Paste this into the MSG91 template editor:**

```
Hallnect: Advance payment of ##var3## received for a hall booking at ##var1##. Ref ##var2##. Accept the booking to have your share paid out.
```

### OWNER_HALL_SUBMITTED

The owner submitted a hall for review (creation or resubmission).

| | |
|---|---|
| Audience | owner |
| Env var | `MSG91_TEMPLATE_OWNER_HALL_SUBMITTED` |
| Variables | `1` hall_name |
| Segments | 1 |

**Register this body on the DLT portal** (`{#var#}` is the DLT placeholder):

```
Hallnect: Your hall {#var#} has been submitted for review as a venue listing. We will text you as soon as it is verified.
```

**Paste this into the MSG91 template editor:**

```
Hallnect: Your hall ##var1## has been submitted for review as a venue listing. We will text you as soon as it is verified.
```

### OWNER_HALL_LIVE

An admin approved the hall; it is now publicly listed.

| | |
|---|---|
| Audience | owner |
| Env var | `MSG91_TEMPLATE_OWNER_HALL_LIVE` |
| Variables | `1` hall_name |
| Segments | 1 |

**Register this body on the DLT portal** (`{#var#}` is the DLT placeholder):

```
Hallnect: Your hall {#var#} is approved and now listed for customers to book. Manage availability and booking requests in your owner dashboard.
```

**Paste this into the MSG91 template editor:**

```
Hallnect: Your hall ##var1## is approved and now listed for customers to book. Manage availability and booking requests in your owner dashboard.
```

### OWNER_HALL_REJECTED

An admin sent the hall back for changes, with a reason.

| | |
|---|---|
| Audience | owner |
| Env var | `MSG91_TEMPLATE_OWNER_HALL_REJECTED` |
| Variables | `1` hall_name · `2` reason |
| Segments | 1 |

**Register this body on the DLT portal** (`{#var#}` is the DLT placeholder):

```
Hallnect: Your hall listing {#var#} needs changes before it goes live. Reason: {#var#}. Update the details in your owner dashboard and submit it again.
```

**Paste this into the MSG91 template editor:**

```
Hallnect: Your hall listing ##var1## needs changes before it goes live. Reason: ##var2##. Update the details in your owner dashboard and submit it again.
```

### OWNER_ACCOUNT_STATUS

Account-level owner notice: suspension, restoration, premium, billing stopped.

| | |
|---|---|
| Audience | owner |
| Env var | `MSG91_TEMPLATE_OWNER_ACCOUNT_STATUS` |
| Variables | `1` item · `2` status · `3` detail |
| Segments | 1 |

**Register this body on the DLT portal** (`{#var#}` is the DLT placeholder):

```
Hallnect venue owner account update. {#var#}: {#var#}. {#var#}. Sign in to your owner dashboard to review it.
```

**Paste this into the MSG91 template editor:**

```
Hallnect venue owner account update. ##var1##: ##var2##. ##var3##. Sign in to your owner dashboard to review it.
```

### OWNER_PAYMENT_RECEIPT

A monthly plan payment was collected — the sign-up charge and every renewal.

| | |
|---|---|
| Audience | owner |
| Env var | `MSG91_TEMPLATE_OWNER_PAYMENT_RECEIPT` |
| Variables | `1` amount · `2` plan · `3` hall_name · `4` paid_until |
| Segments | 2 |

**Register this body on the DLT portal** (`{#var#}` is the DLT placeholder):

```
Hallnect: Payment of {#var#} received for the {#var#} premium listing plan for your hall {#var#}. Boost active until {#var#}. Manage billing from Premium in your dashboard.
```

**Paste this into the MSG91 template editor:**

```
Hallnect: Payment of ##var1## received for the ##var2## premium listing plan for your hall ##var3##. Boost active until ##var4##. Manage billing from Premium in your dashboard.
```

### ADMIN_ALERT

Operational alert to the platform admin: bookings, payments, halls, failures.

| | |
|---|---|
| Audience | admin |
| Env var | `MSG91_TEMPLATE_ADMIN_ALERT` |
| Variables | `1` event · `2` details · `3` reference |
| Segments | 1 |

**Register this body on the DLT portal** (`{#var#}` is the DLT placeholder):

```
Hallnect venue booking admin alert. Event: {#var#}. Details: {#var#}. Reference: {#var#}. Open the admin dashboard for full details.
```

**Paste this into the MSG91 template editor:**

```
Hallnect venue booking admin alert. Event: ##var1##. Details: ##var2##. Reference: ##var3##. Open the admin dashboard for full details.
```
