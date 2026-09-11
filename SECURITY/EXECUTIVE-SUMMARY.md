# Hallnect — Security Assessment: Executive Summary

**Prepared for:** HALLNECT LLP
**Assessment:** 10–11 September 2026 · **Remediation:** 11–12 September 2026
**Scope:** https://hallnect.com, the `hallnect5` repository, and the Supabase database behind them
**Authorisation:** written, from the owner, for their own application and infrastructure

---

## The short version

Hallnect was assessed as if it were already handling real customers' money.
**Fifty-six findings were confirmed. Thirty-five are fixed, seven are accepted
with reasons recorded, and fourteen remain open — none of them above Low.**
Every Critical, High and Medium finding is closed, verified against production,
and pushed.

**The most important result is not a vulnerability.**

> **Direct booking had been impossible since GST shipped.** Every full-price
> booking on the platform failed silently at the database and had done for some
> time. The customer saw a generic error. Nothing was logged as a fault,
> because nothing *was* a fault by the code's own reckoning — two parts of the
> schema simply disagreed about what a customer's total is.

A second defect underneath it made every venue priced under about ₹3,200 a day
unsellable even once the first was fixed. Both were found because a security
review is the only exercise that reads the money path end to end and asks what
happens when it is wrong.

The platform holds no bookings today. That had been read as "nothing has been
tried yet". It was at least partly **"nothing could be"**.

---

## What was actually at risk

Hallnect's security posture is, on the whole, better than its stage would
suggest. Row-level security is on for every table, the money flows are
server-verified against Cashfree rather than trusted from the client, OTP
verification is owned by MSG91 with five independent database-backed ceilings,
and the payment webhook is signature-checked in constant time. Several controls
found during this review were not merely present but *thoughtful* — the booking
transition trigger freezes every money column against a non-trusted caller, and
the codebase is unusually candid in its own comments about what it has not
solved.

What the assessment found was not an absence of controls. It was **controls
that did not quite meet each other**, and a recurring shape worth naming
because it caused four separate findings:

> **A grant wider than the policy guarding it.** In PostgreSQL, table and
> column privileges are checked *before* row-level security, and RLS is
> row-level — so neither layer will ever catch a bad **column**. Three tables
> had policies that were exactly right and grants that let a client write
> fields the policy had no opinion about. A fourth had `TRUNCATE`, which RLS
> does not filter at all.

The practical consequences ranged from a customer being able to file a support
ticket that already contained Hallnect's own reply ("Refund approved by admin",
in the platform's voice, usable as evidence in a payment dispute) to
twenty-four tables — including the audit log and the revenue ledger — being
erasable by any signed-in account, had any path existed to issue the statement.
None did, and that is stated as plainly in the report as the finding itself.

Three findings would have cost real money or real customers:

- **A venue owner's payout bank account could never be changed.** Cashfree
  only creates beneficiaries; the identifier was derived from the owner, so
  every re-registration silently reused the first destination while the product
  reported "Verified". An owner who switched banks would have been paid into
  the account they left. The same stamp disabled the interlock built to stop a
  compromised account redirecting payouts.
- **A captured payment could be cancelled with no refund record.** A transient
  failure between two writes left money taken, a booking the sweep would later
  cancel, and nothing anywhere indicating the customer was owed anything.
- **Anyone signed in could lock any phone number out of verification**,
  indefinitely. Since a venue owner cannot see a single enquiry until their
  phone is verified, that is a way to deny a competitor their business.

And one finding was about credibility rather than access: a **zero-width
space** let a venue owner smuggle a working phone number into an official
Hallnect SMS, telling the customer to book direct and skip the advance. The
sanitiser was sound; it simply ran on a different string from the one that was
sent.

---

## What was fixed

Ten database migrations and roughly two dozen application changes, each
committed separately with its reasoning, each verified against production and
rolled back where a probe would otherwise have written.

Every migration carries its own verification block that **fails the migration**
if the fix does not hold. That was not ceremony: three of them caught real
mistakes before anything shipped — a guard written so that it could never fire,
and twice a column-level revoke that silently did nothing because the grant
underneath it was table-level.

The test suite grew from 587 to 622 tests. The new ones are written so they
**fail against the old code**: the SMS injection tests fail ten of fourteen
before the fix, and the upload test shows the old validator accepting a payload
named `photo.png` that the new one refuses.

---

## What is left

**Nothing above Low severity is open.** What remains falls into three groups.

**Two things only the owner can do**, both required before launch:

1. Set `CONTACT_IP_SALT` in Vercel. The contact form's per-sender rate limit is
   written and deployed but stays dormant without it, leaving only the
   platform-wide backstop. The Vercel CLI in this environment is signed out and
   its login is interactive.
2. Complete DLT template approval for the two lead-generation SMS templates,
   and decide on multi-factor authentication for the single admin account.

**One product gap that is not a vulnerability but reads like one to a
customer:** there is no password reset or password change flow anywhere in the
product, while email-and-password sign-in is offered. A user who forgets their
password today has no route back to their account.

**Seven accepted risks**, each with the reasoning recorded rather than left
implicit — most notably that the Content-Security-Policy still permits inline
and evaluated script, because Next.js's runtime and the Cashfree checkout SDK
both require it and a stricter policy would break payments. A nonce-based
policy is the named follow-up, not a launch blocker.

---

## Security rating

| | |
|---|---|
| **Before remediation** | **4.5 / 10** — a sound architecture with two silent revenue outages, a payout destination that could not be corrected, and four grant-versus-policy gaps |
| **After remediation** | **8.1 / 10** — every Critical, High and Medium finding closed and verified; residual risk is configuration and product completeness, not defect |

**Launch recommendation: proceed**, once `CONTACT_IP_SALT` is set and the
password-reset gap is either filled or consciously accepted for launch.

The single most valuable thing this exercise produced is not any individual
fix. It is that the primary revenue path was proven to work — by inserting the
exact row the application writes and watching it succeed — rather than assumed
to work because nothing had complained.

---

## A note on how this was assessed

Every claim in the detailed report is backed by evidence: a rolled-back
database probe, a captured HTTP response, or the vulnerable logic read and
cited by file and line. Findings were produced by nine independent reviewers
covering different dimensions, each followed by an **adversarial verifier
instructed to refute rather than confirm**.

That pass changed the outcome. It downgraded three findings whose preconditions
did not exist — including refusing a reviewer's Medium/6.8 rating on the
TRUNCATE issue with the observation that "a finding whose precondition is a
SQL-execution primitive that does not exist" does not carry that score. It also
upgraded two. Where a reviewer's finding could not be reproduced, it is
reported as *partially confirmed* and says so. Two findings turned out to
describe code already fixed; they are listed as false positives rather than
quietly dropped.

**No secret, token, OTP, bank account number or key appears anywhere in these
documents.** No real financial transaction was performed. No production data
was deleted or modified: every probe ran inside a transaction terminated by an
exception, and row counts were verified unchanged afterwards.

Full detail: `VAPT-REPORT.md` · `FINDINGS.md` · `REMEDIATION-PLAN.md` ·
`PRODUCTION-SECURITY-CHECKLIST.md`
