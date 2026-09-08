import { describe, it, expect } from "vitest";
import {
  toBeneficiaryId, buildTransferId, toBeneficiaryName, toTransferRemarks, classifyTransfer,
} from "@/lib/cashfree-payouts";

const BOOKING = "9e816700-1c3a-4f21-9b77-0a2d5c4e11ff";

describe("Cashfree Payouts identifier shaping", () => {
  it("strips hyphens from a beneficiary id — Cashfree rejects them outright", () => {
    const id = toBeneficiaryId("ef52cf9c-717e-4a1b-9c2d-0f1e2a3b4c5d");
    expect(id).toBe("ef52cf9c717e4a1b9c2d0f1e2a3b4c5d");
    expect(id).toMatch(/^[A-Za-z0-9]+$/);
    expect(id.length).toBeLessThanOrEqual(50);
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
