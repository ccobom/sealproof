import { describe, expect, it } from "vitest";
import {
  FINALIZATION_TICKET_LIFETIME_MS,
  issueFinalizationTicket,
  openFinalizationTicket,
} from "../../src/admission/finalization-ticket";

const NOW = 1_800_000_000_000;
const INPUT = {
  productionEmail: "producer@example.invalid",
  signerEmail: "signer@example.invalid",
  documentHash: "a".repeat(64),
};

function key(seed = 0): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => (index + seed) % 256);
}

function alter(ticket: string): string {
  const last = ticket.at(-1);
  return ticket.slice(0, -1) + (last === "A" ? "B" : "A");
}

describe("encrypted short-lived finalization ticket", () => {
  it("round trips exact metadata without exposing it in the ticket", async () => {
    const issued = await issueFinalizationTicket(INPUT, "workflow-v1", "ticket-v1", key(), NOW);
    expect(issued.expiresAt).toBe(NOW + FINALIZATION_TICKET_LIFETIME_MS);
    expect(issued.ticket).not.toContain(INPUT.productionEmail);
    expect(issued.ticket).not.toContain(INPUT.signerEmail);
    expect(issued.ticket).not.toContain(INPUT.documentHash);

    const opened = await openFinalizationTicket(issued.ticket, { "ticket-v1": key() }, NOW + 1);
    expect(opened.valid).toBe(true);
    if (!opened.valid) throw new Error("Expected valid ticket");
    expect(opened.payload).toMatchObject({ ...INPUT, workflowVersion: "workflow-v1", issuedAt: NOW });
    expect(opened.payload.admissionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("uses fresh authenticated ciphertext for identical input", async () => {
    const first = await issueFinalizationTicket(INPUT, "workflow-v1", "ticket-v1", key(), NOW);
    const second = await issueFinalizationTicket(INPUT, "workflow-v1", "ticket-v1", key(), NOW);
    expect(first.ticket).not.toBe(second.ticket);
  });

  it("expires at the exact five-minute boundary", async () => {
    const issued = await issueFinalizationTicket(INPUT, "workflow-v1", "ticket-v1", key(), NOW);
    await expect(openFinalizationTicket(
      issued.ticket, { "ticket-v1": key() }, issued.expiresAt - 1,
    )).resolves.toMatchObject({ valid: true });
    await expect(openFinalizationTicket(
      issued.ticket, { "ticket-v1": key() }, issued.expiresAt,
    )).resolves.toEqual({ valid: false, reason: "EXPIRED" });
  });

  it("fails closed for alteration, wrong keys, missing versions, and malformed input", async () => {
    const issued = await issueFinalizationTicket(INPUT, "workflow-v1", "ticket-v1", key(), NOW);
    await expect(openFinalizationTicket(
      alter(issued.ticket), { "ticket-v1": key() }, NOW,
    )).resolves.toEqual({ valid: false, reason: "INVALID" });
    await expect(openFinalizationTicket(
      issued.ticket, { "ticket-v1": key(1) }, NOW,
    )).resolves.toEqual({ valid: false, reason: "INVALID" });
    await expect(openFinalizationTicket(
      issued.ticket, {}, NOW,
    )).resolves.toEqual({ valid: false, reason: "KEY_UNAVAILABLE" });
    await expect(openFinalizationTicket(
      "not.a.valid.ticket", { "ticket-v1": key() }, NOW,
    )).resolves.toEqual({ valid: false, reason: "INVALID" });
    await expect(openFinalizationTicket(
      "x".repeat(2_049), { "ticket-v1": key() }, NOW,
    )).resolves.toEqual({ valid: false, reason: "INVALID" });
  });

  it("rejects invalid issuance metadata and key configuration", async () => {
    await expect(issueFinalizationTicket(
      { ...INPUT, signerEmail: "not-an-email" }, "workflow-v1", "ticket-v1", key(), NOW,
    )).rejects.toThrow();
    await expect(issueFinalizationTicket(
      INPUT, "workflow with spaces", "ticket-v1", key(), NOW,
    )).rejects.toThrow();
    await expect(issueFinalizationTicket(
      INPUT, "workflow-v1", "ticket-v1", new Uint8Array(31), NOW,
    )).rejects.toThrow("must be 32 bytes");
  });
});
