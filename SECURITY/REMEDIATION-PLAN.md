# Hallnect — Remediation Plan

**As of:** 12 September 2026
**Companion documents:** `FINDINGS.md` (the ledger) · `VAPT-REPORT.md` (method and detail)

Everything above Low severity is already fixed, verified and pushed. This
document covers **what is left**, in the order it should be done, and records
the accepted risks so that "accepted" means a decision somebody made rather
than something nobody got to.

---

## 1. Before launch — owner action required

These cannot be done from the codebase. Each is small; each leaves a real gap
open until it is done.

### 1.1 Set `CONTACT_IP_SALT` in Vercel · **15 minutes**

The contact form's per-sender rate limit is written, tested and deployed, and
**it is dormant without this variable.** With no salt the helper returns null
by design, and only the platform-wide backstop applies — which is the control
that was exploitable in the first place, merely with a higher number.

The salt is not decoration. IPv4 has about four billion values, so an unsalted
hash of an address is reversible by brute force in seconds: it would store the
address while appearing not to. Returning null was chosen over hashing without
a salt precisely so the system is honest about what is in force.

Generate a fresh 32-byte value and set it for Production, Preview and
Development:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then in the Vercel dashboard, Project → Settings → Environment Variables, add
`CONTACT_IP_SALT` and redeploy. A local value is already in `.env.local`; it is
not shared with production, and it does not need to be — rotating the salt only
resets the current hour's buckets.

> The Vercel CLI in the assessment environment is signed out and `vercel login`
> is an interactive browser flow, so this could not be completed unattended.

### 1.2 Decide on the password-reset gap · **product decision**

Email-and-password sign-in is offered and **there is no password reset or
password change flow anywhere in the product** (AUTH-4). A user who forgets
their password today has no route back to their account, and an owner who
suspects their password is known has no way to change it.

This is a product gap rather than a vulnerability, but it is the kind a
launched marketplace cannot carry quietly. Supabase provides
`resetPasswordForEmail` and `updateUser`, so the work is a page and a callback
rather than an architecture change.

Either build it, or launch Google sign-in only and remove the password field —
what should not happen is offering a credential with no way to recover it.

### 1.3 Multi-factor authentication for the admin account · **30 minutes**

There is one admin account, protected by Google sign-in alone (AUTH-5). That
account can change the commission rate every venue pays, approve venues, issue
refunds and release payouts.

Enable 2-Step Verification on the Google account itself. This is the cheapest
meaningful risk reduction available anywhere in this report: it costs half an
hour and removes single-factor compromise of the account that can move money.

### 1.4 Complete DLT approval for the two lead templates · **carrier-dependent**

`OWNER_NEW_LEAD` and `CUSTOMER_LEAD_UPDATE` are not yet approved on the
operator's DLT portal. Lead notifications currently ride an approved
general-purpose template, which works, and the dashboard alert is the reliable
owner channel regardless.

Not a security item. Listed because it is an outstanding launch dependency and
this is the document people will read.

---

## 2. Shortly after launch

### 2.1 A nonce-based Content-Security-Policy · **half a day** · closes WEB-3

The CSP keeps `'unsafe-inline'` and `'unsafe-eval'` in `script-src`, so it
provides no XSS containment today. That is not an oversight: Next.js's runtime
and the Cashfree checkout SDK both require them, and a stricter policy shipped
without testing would break payments client-side with **nothing in the server
logs** — which has already happened once on this project, when `form-action
'self'` silently blocked every payment.

The work is to emit a per-request nonce from the proxy, thread it through the
Next script tags, and verify a complete checkout against the Cashfree sandbox
before it reaches production. Do it as its own change, with payment testing, not
folded into something else.

### 2.2 Decide what account deletion should erase · **half a day** · closes LOGIC-4

Deleting an account anonymises the profile row but leaves personal data in
`leads`, `bookings.contact_phone` and contact messages. That may well be
correct — a booking is a commercial record and a lead is a venue's own
enquiry — but it is currently an accident of implementation rather than a
retention policy.

Write the policy down first, then make the code match it. The privacy policy
should say the same thing.

### 2.3 A country allowlist on OTP destinations · **1 hour** · closes OTP-6

OTP and notification SMS can be sent to any international destination despite
an India-only product. The global daily fuse bounds the spend, but an India
allowlist removes the class outright and costs one predicate.

### 2.4 Per-account ceiling on admin alert SMS · **1 hour** · closes OTP-5

The admin alert budget (15/hour on the admin phone) has no per-account ceiling.
Partially mitigated now that contact-form alerts are bucketed per UTC hour, but
other user-triggerable events still share the pool with alerts that genuinely
need waking someone up — a failed payout, a payment mismatch.

---

## 3. When the code next changes in these areas

Not scheduled work. Each is a note for whoever is next in the file.

- **LOGIC-2** — booking-cancellation side effects (calendar release, refund
  record, notifications) live only in the server action, so a direct database
  status change skips them. Safe today because the only writers are the trusted
  backend and an admin, and the admin screens go through the action. **If a
  fourth writer ever appears, move the side effects into a trigger.**
- **PAY-2** — stale-but-`ACTIVE` commission and plan orders are retired locally
  while still payable at Cashfree. Worth reconciling against the gateway before
  retiring an order.
- **OTP-3** — the check-side guard is read-then-act, so parallel requests can
  slightly exceed the ceiling. Against a million-value code space this changes
  nothing; if the ceilings ever become the primary control rather than a
  secondary one, make the counter atomic.
- **API-7, API-9, PRIV-6, LOGIC-10, LOGIC-11, AUTH-9** — informational items,
  each recorded in `FINDINGS.md` §6 with its reasoning.

---

## 4. Accepted risks

An accepted risk is one somebody decided to carry. These are written down so
that the next person to find them knows they were seen, and can reopen the
decision rather than rediscover the fact.

| Risk | Why it is accepted | What would change the decision |
|---|---|---|
| **WEB-3** — CSP allows inline and evaluated script | Next's runtime and the Cashfree SDK require it; a stricter policy breaks checkout silently | §2.1 lands, or the SDK stops needing it |
| **PAY-5** — no webhook timestamp-freshness window | Replay is already idempotent: every handler re-reads authoritative state from Cashfree rather than trusting the payload | If a handler ever acts on payload content without re-reading |
| **OTP-3** — check ceiling is read-then-act | Bounded, and irrelevant against a 6-digit space with a 20-per-phone fuse | If the ceilings become the primary anti-brute-force control |
| **LOGIC-9** — OTP ceilings fail *open* on a counter read failure | Deliberate: a rate-limit table that cannot be read must not lock a real user out of their own code. The global fuse still fails closed | If the failure mode ever becomes common rather than exceptional |
| **AUTH-6** — signup role is client-supplied metadata | By design: `owner` yields `owner_approved`, `admin` is rejected, and listing still requires admin approval of the venue | If self-serve owner signup is ever restricted |
| **AUTH-8** — session cookies are not `HttpOnly` | The Supabase SSR default; changing it breaks the client library's session handling | If Supabase supports it, or the CSP hardens (§2.1) |
| **PRIV-7** — an owner can move their own approved hall to draft | That is theirs to do. Re-approval is required to publish again | If unpublishing ever has a side effect on live bookings |

---

## 5. Retest requirements

What should be re-checked, and when.

**After `CONTACT_IP_SALT` is set (§1.1).** Submit four contact messages in an
hour from one browser. The fourth should be refused. Then confirm from another
network that a fresh sender is still accepted — that distinguishes a working
per-sender cap from an accidental global one.

**Before the first real booking.** Complete one end-to-end paid booking on the
Cashfree sandbox and confirm: the booking reaches `booking_requested`, the
payment reaches `payment_success`, the tax invoice is issued once, and the
availability row appears. The two booking outages this assessment found were
both invisible from outside, and the only test that would have caught either is
this one.

**Before the first real payout.** Register a payout beneficiary, then **change
the bank account and register again**, and confirm the stored
`payout_beneficiary_digest` changes and dispatch refuses until re-registration
completes. That is the precise behaviour CRIT-1 broke, and it cannot be
verified without touching the live Payouts API — which is why it is listed here
rather than marked done.

**After any migration that touches grants.** Re-run the grant sweep: no client
role should hold `TRUNCATE` on anything in `public`, and the per-column write
surface of `profiles`, `contact_messages` and `hall_owners` should match what
migrations 0079, 0082, 0084 and 0080 left. Three separate mistakes in this
engagement came from a column-level revoke against a table-level grant; that
combination is this schema's most repeated error.

**Full retest scope** if the application changes materially: the authorisation
probes in `VAPT-REPORT.md` §15–§17 and §22–§23, which exercise RLS, column
grants and guard triggers directly at the trust boundary rather than through
the UI.
