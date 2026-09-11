import { describe, it, expect } from "vitest";
import {
  toBeneficiaryId, buildTransferId, toBeneficiaryName, toTransferRemarks, classifyTransfer,
  destinationDigest,
} from "@/lib/cashfree-payouts";

const BOOKING = "9e816700-1c3a-4f21-9b77-0a2d5c4e11ff";
const OWNER   = "ef52cf9c-717e-4a1b-9c2d-0f1e2a3b4c5d";

const ACCOUNT_A = "50100123456789";
const ACCOUNT_B = "91800987654321";
const IFSC      = "HDFC0001234";

describe("Cashfree Payouts identifier shaping", () => {
  it("strips hyphens from a beneficiary id — Cashfree rejects them outright", () => {
    const id = toBeneficiaryId(OWNER, destinationDigest(ACCOUNT_A, IFSC));
    expect(id).toMatch(/^[A-Za-z0-9]+$/);
    expect(id.length).toBeLessThanOrEqual(50);
    // The owner id is still recoverable by prefix, which is what keeps the
    // beneficiary mappable back to the row.
    expect(id.startsWith("ef52cf9c717e4a1b9c2d0f1e2a3b4c5d")).toBe(true);
  });

  // ── The bug this signature exists to prevent ──────────────────────────────
  // Cashfree's POST /beneficiary only creates; there is no update verb. When
  // the id was derived from the owner alone it was stable for life, so a
  // changed bank account collided with the first registration, came back 409,
  // and upsertBeneficiary read back the OLD destination's status and reported
  // success. The new account never reached Cashfree.
  it("gives a CHANGED bank account a DIFFERENT beneficiary id", () => {
    const first  = toBeneficiaryId(OWNER, destinationDigest(ACCOUNT_A, IFSC));
    const second = toBeneficiaryId(OWNER, destinationDigest(ACCOUNT_B, IFSC));
    expect(second).not.toBe(first);
  });

  it("gives an UNCHANGED bank account the SAME id, so a retry is still idempotent", () => {
    // This is what keeps the 409-then-GET fallback sound rather than merely
    // convenient: the same destination must land on the same id.
    expect(toBeneficiaryId(OWNER, destinationDigest(ACCOUNT_A, IFSC)))
      .toBe(toBeneficiaryId(OWNER, destinationDigest(ACCOUNT_A, IFSC)));
  });

  it("treats a changed IFSC as a changed destination, not just the account number", () => {
    const sameAccountOtherBranch = toBeneficiaryId(OWNER, destinationDigest(ACCOUNT_A, "HDFC0009999"));
    expect(sameAccountOtherBranch).not.toBe(toBeneficiaryId(OWNER, destinationDigest(ACCOUNT_A, IFSC)));
  });

  it("keeps two owners apart even when they somehow share a destination", () => {
    const other = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const d = destinationDigest(ACCOUNT_A, IFSC);
    expect(toBeneficiaryId(OWNER, d)).not.toBe(toBeneficiaryId(other, d));
  });

  it("never puts the account number in the digest, and normalises the IFSC", () => {
    const d = destinationDigest(ACCOUNT_A, IFSC);
    expect(d).toMatch(/^[a-f0-9]{32}$/);
    expect(d).not.toContain(ACCOUNT_A);
    // Case and padding on the IFSC must not read as a different bank account,
    // or an owner re-saving identical details would re-register every time.
    expect(destinationDigest(ACCOUNT_A, " hdfc0001234 ")).toBe(d);
    expect(destinationDigest(" 50100123456789", IFSC)).toBe(d);
  });

  it("emits a transfer id in the INTERSECTION of Cashfree's two contradictory charsets", () => {
    // The Standard Transfer page allows underscore and hyphen; the Batch page
    // says alphanumeric. Taking the intersection is the only safe reading.
    const id = buildTransferId(BOOKING, 1);
    expect(id).toMatch(/^[A-Za-z0-9]+$/);
    expect(id).toBe("hn9e8167001c3a4f219b770a2d5c4e11ff01");
  });

  it("makes the transfer id deterministic per attempt — that IS the idempotency key", () => {
    // Cashfree documents no idempotency header and their own SDK sends none, so
    // a retry of the SAME attempt must produce the SAME id or it becomes a
    // second transfer.
    expect(buildTransferId(BOOKING, 1)).toBe(buildTransferId(BOOKING, 1));
    expect(buildTransferId(BOOKING, 2)).not.toBe(buildTransferId(BOOKING, 1));
  });

  it("reduces a business name to what beneficiary_name accepts, or refuses", () => {
    expect(toBeneficiaryName("Sri Krishna Mahal Pvt. Ltd.")).toBe("Sri Krishna Mahal Pvt Ltd");
    expect(toBeneficiaryName("Ramesh & Sons")).toBe("Ramesh Sons");
    // Nothing usable survives, so the caller must refuse rather than send junk.
    expect(toBeneficiaryName("42")).toBeNull();
    expect(toBeneficiaryName("")).toBeNull();
    expect(toBeneficiaryName(null)).toBeNull();
  });

  it("keeps transfer remarks inside 'alphabets, numbers and space'", () => {
    expect(toTransferRemarks("Hallnect advance — booking #9E81")).toBe("Hallnect advance booking 9E81");
    expect(toTransferRemarks("a".repeat(200)).length).toBeLessThanOrEqual(70);
  });
});

describe("classifying a transfer", () => {
  it("treats SUCCESS as terminal and paid", () => {
    expect(classifyTransfer("SUCCESS")).toEqual({ terminal: true, summary: "done" });
  });

  it("treats REVERSED as its own terminal state, not as failed", () => {
    // The money left and came back. It is NOT the same as never having gone,
    // and the owner must return to the payable queue as a new attempt.
    expect(classifyTransfer("REVERSED")).toEqual({ terminal: true, summary: "reversed" });
  });

  it("keeps every in-flight status non-terminal so reconcile keeps asking", () => {
    for (const s of ["RECEIVED", "QUEUED", "PENDING", "VALIDATION_PENDING", "APPROVAL_PENDING"]) {
      expect(classifyTransfer(s)).toEqual({ terminal: false, summary: "in_flight" });
    }
  });

  it("does NOT treat an unknown status as terminal", () => {
    // Marking it terminal would strand it outside the reconcile sweep; marking
    // it failed could pay the owner twice. Unknown stays open.
    const out = classifyTransfer("SOMETHING_NEW");
    expect(out.terminal).toBe(false);
    expect(out.summary).toBe("in_flight");
  });

  it("is case-insensitive, because the raw value is stored unmapped", () => {
    expect(classifyTransfer("success")).toEqual({ terminal: true, summary: "done" });
  });
});

describe("2FA signature configuration", () => {
  it("reports no signature key when the env var is absent or blank", async () => {
    const { hasPayoutSignatureKey } = await import("@/lib/cashfree-payouts");
    const prev = process.env.CASHFREE_PAYOUT_PUBLIC_KEY;

    delete process.env.CASHFREE_PAYOUT_PUBLIC_KEY;
    expect(hasPayoutSignatureKey()).toBe(false);

    // Whitespace is not a key. A blank-looking value that reads as "configured"
    // would claim requests carry a signature when they carry nothing.
    process.env.CASHFREE_PAYOUT_PUBLIC_KEY = "   ";
    expect(hasPayoutSignatureKey()).toBe(false);

    process.env.CASHFREE_PAYOUT_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----";
    expect(hasPayoutSignatureKey()).toBe(true);

    if (prev === undefined) delete process.env.CASHFREE_PAYOUT_PUBLIC_KEY;
    else process.env.CASHFREE_PAYOUT_PUBLIC_KEY = prev;
  });
});

describe("2FA public key parsing", () => {
  // A PEM is header, base64 wrapped at 64 columns, footer, and OpenSSL is strict
  // about all three. Every one of these is a real way the key arrives after
  // being pasted into an environment variable, and every one of them produces
  // the SAME opaque error ("DECODER routines::unsupported") if not repaired.
  const mangle = {
    "pristine PEM":        (k: string) => k,
    "newlines to spaces":  (k: string) => k.replace(/\n/g, " "),
    "literal backslash-n": (k: string) => k.replace(/\n/g, "\n"),
    "CRLF line endings":   (k: string) => k.replace(/\n/g, "\r\n"),
    "body only, no header":(k: string) => k.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, ""),
  };

  it("accepts a real key however its newlines were destroyed", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { payoutSignatureError } = await import("@/lib/cashfree-payouts");
    // Both encodings, or Node's overloads do not match — one alone is a type
    // error that only `next build` catches, not `tsc --noEmit` on its own.
    const { publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding:  { type: "spki",  format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const prev = process.env.CASHFREE_PAYOUT_PUBLIC_KEY;

    for (const [name, f] of Object.entries(mangle)) {
      process.env.CASHFREE_PAYOUT_PUBLIC_KEY = f(publicKey as string);
      expect(payoutSignatureError(), name).toBeNull();
    }

    if (prev === undefined) delete process.env.CASHFREE_PAYOUT_PUBLIC_KEY;
    else process.env.CASHFREE_PAYOUT_PUBLIC_KEY = prev;
  });

  it("names the problem instead of failing silently", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { payoutSignatureError } = await import("@/lib/cashfree-payouts");
    const prev = process.env.CASHFREE_PAYOUT_PUBLIC_KEY;

    process.env.CASHFREE_PAYOUT_PUBLIC_KEY = "not a key at all";
    expect(payoutSignatureError()).toMatch(/could not be parsed/i);

    // Handing over a private key is a plausible mistake and deserves its own
    // sentence rather than a generic parse failure.
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    process.env.CASHFREE_PAYOUT_PUBLIC_KEY = privateKey as string;
    expect(payoutSignatureError()).toMatch(/PRIVATE key/i);

    if (prev === undefined) delete process.env.CASHFREE_PAYOUT_PUBLIC_KEY;
    else process.env.CASHFREE_PAYOUT_PUBLIC_KEY = prev;
  });
});
