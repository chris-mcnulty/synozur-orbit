import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  note: vi.fn(),
  task: vi.fn(),
  connection: vi.fn(),
  competitor: vi.fn(),
  persist: vi.fn(),
}));

vi.mock("../../storage", () => ({
  storage: {
    getHubspotConnection: mocks.connection,
    getCompetitor: mocks.competitor,
    updateIntelligenceBriefing: mocks.persist,
  },
}));
vi.mock("../../utils/encryption", () => ({
  decryptSecret: () => "test-token",
  encryptSecret: (value: string) => value,
}));
vi.mock("@hubspot/api-client", () => ({
  Client: class {
    crm = { objects: {
      notes: { basicApi: { create: mocks.note } },
      tasks: { basicApi: { create: mocks.task } },
    } };
  },
}));

import { autoPushBriefing, pushTask } from "../hubspot-integration";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.mockResolvedValue({
    autoPushEnabled: true,
    defaultOwnerId: "default-owner",
    encryptedAccessToken: "encrypted-test-token",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  mocks.competitor.mockResolvedValue({
    tenantDomain: "tenant.example", hubspotCompanyId: "matched-company",
  });
  mocks.note.mockResolvedValue({ id: "note-id" });
  mocks.task.mockResolvedValue({ id: "task-id" });
});

const briefing = {
  tenantDomain: "tenant.example",
  briefingId: "briefing-id",
  title: "Market briefing",
  executiveSummary: "Market-specific findings",
  competitorIds: ["competitor-id"],
  planName: "unlimited",
  // Simulate an old caller that still passes generated actions.
  actionItems: Array.from({ length: 5 }, (_, i) => ({
    title: `Unapproved action ${i}`, competitorId: "competitor-id",
  })),
};

describe("HubSpot briefing sync is notes-only", () => {
  it.each([false, true])("never creates tasks during summary sync (force=%s)", async force => {
    const result = await autoPushBriefing({ ...briefing, force });
    expect(result).toEqual({ pushed: 1, skipped: 0, tasksPushed: 0 });
    expect(mocks.note).toHaveBeenCalledOnce();
    expect(mocks.note.mock.calls[0][0].properties.hs_note_body).toContain("Market-specific findings");
    expect(mocks.task).not.toHaveBeenCalled();
    expect(mocks.persist).toHaveBeenCalledWith("briefing-id", expect.objectContaining({
      hubspotPushResult: expect.objectContaining({ pushed: 1, tasksPushed: 0 }),
    }));
  });

  it("never creates standalone tasks when no companies are matched", async () => {
    mocks.competitor.mockResolvedValue({ tenantDomain: "tenant.example", hubspotCompanyId: null });
    expect(await autoPushBriefing(briefing)).toEqual({ pushed: 0, skipped: 1, tasksPushed: 0 });
    expect(mocks.note).not.toHaveBeenCalled();
    expect(mocks.task).not.toHaveBeenCalled();
  });

  it("preserves the auto-push switch and permits notes-only manual sync", async () => {
    const conn = await mocks.connection();
    mocks.connection.mockResolvedValue({ ...conn, autoPushEnabled: false });
    expect((await autoPushBriefing(briefing)).reason).toBe("auto_push_disabled");
    expect(mocks.note).not.toHaveBeenCalled();
    expect((await autoPushBriefing({ ...briefing, force: true })).pushed).toBe(1);
    expect(mocks.task).not.toHaveBeenCalled();
  });

  it("keeps the separate explicit task action working", async () => {
    expect(await pushTask("tenant.example", {
      subject: "Explicitly requested task", body: "User requested this task", ownerId: "selected-owner",
    })).toEqual({ taskId: "task-id" });
    expect(mocks.task.mock.calls[0][0].properties.hubspot_owner_id).toBe("selected-owner");
    expect(mocks.note).not.toHaveBeenCalled();
  });

  it("does not forward recommended actions from any briefing-sync caller", () => {
    const service = readFileSync("server/services/intelligence-briefing-service.ts", "utf8");
    const calls = [...service.matchAll(/await autoPushBriefing\(\{([\s\S]*?)\}\)/g)];
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).not.toContain("actionItems:");
    const routes = readFileSync("server/routes/integrations.ts", "utf8");
    for (const call of routes.matchAll(/hubspot\.autoPushBriefing\(\{([\s\S]*?)\}\)/g)) {
      expect(call[1]).not.toContain("actionItems");
    }
  });
});
