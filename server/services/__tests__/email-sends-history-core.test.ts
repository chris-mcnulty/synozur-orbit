import { describe, it, expect } from "vitest";
import { buildExternalSendRow, mergeSendHistory, type ExternalSentEmail } from "../email-sends-history-core";

const base: ExternalSentEmail = {
  id: "email-1",
  subject: "Q3 Newsletter",
  sentAt: new Date("2026-08-01T10:00:00Z"),
  createdAt: new Date("2026-07-20T10:00:00Z"),
  hubspotEmailId: "12345",
  hubspotEmailUrl: "https://app.hubspot.com/marketing-email/12345/performance",
};

describe("buildExternalSendRow", () => {
  it("projects a HubSpot-linked external send into the Sends-row shape", () => {
    const row = buildExternalSendRow(base);
    expect(row).toMatchObject({
      id: "external-email-1",
      emailId: "email-1",
      subject: "Q3 Newsletter",
      status: "sent_external",
      isExternal: true,
      hubspotEmailId: "12345",
      hubspotEmailUrl: base.hubspotEmailUrl,
      totalRecipients: 0,
      sentCount: 0,
    });
    expect(row.createdAt).toEqual(base.sentAt);
  });

  it("handles a non-HubSpot external send (no link) and falls back to createdAt when sentAt is missing", () => {
    const row = buildExternalSendRow({ ...base, sentAt: null, hubspotEmailId: null, hubspotEmailUrl: null });
    expect(row.hubspotEmailId).toBeNull();
    expect(row.hubspotEmailUrl).toBeNull();
    expect(row.isExternal).toBe(true);
    expect(row.createdAt).toEqual(base.createdAt);
  });
});

describe("mergeSendHistory", () => {
  const direct = (id: string, createdAt: string, status = "completed") => ({
    id, emailId: id, subject: id, status, createdAt: new Date(createdAt),
  });

  it("interleaves direct and external rows newest-first", () => {
    const merged = mergeSendHistory(
      [direct("d1", "2026-08-10T00:00:00Z"), direct("d2", "2026-07-01T00:00:00Z")],
      [buildExternalSendRow(base)],
    );
    expect(merged.map(r => r.id)).toEqual(["d1", "external-email-1", "d2"]);
  });

  it("keeps direct sends (including partial/failed) as-is and applies the limit", () => {
    const merged = mergeSendHistory(
      [direct("d1", "2026-08-10T00:00:00Z", "failed"), direct("d2", "2026-08-09T00:00:00Z", "sending")],
      [buildExternalSendRow(base)],
      2,
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].status).toBe("failed");
    expect(merged.some(r => r.id === "external-email-1")).toBe(false);
  });
});
