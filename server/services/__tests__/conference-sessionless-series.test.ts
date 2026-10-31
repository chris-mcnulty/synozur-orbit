import { getTableName } from "drizzle-orm";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  conf: {} as any, images: [] as any[], sessions: [] as any[], accounts: [] as any[],
  posts: [] as any[], updates: [] as any[], deletePosts: vi.fn(), complete: vi.fn(), save: vi.fn(), png: Buffer.alloc(0),
}));
vi.mock("../../db", () => ({
  db: {
    select: () => ({ from: (table: any) => ({ where: () => {
      const rows = ({
        conferences: [io.conf], conference_sessions: io.sessions,
        conference_images: io.images.filter(i => i.status === "active"),
        social_accounts: io.accounts,
        tenants: [{ logoUrl: "/public-objects/company.png", primaryColor: "#810FFB" }],
      } as any)[getTableName(table)] || [];
      return Object.assign(Promise.resolve(rows), { orderBy: () => Promise.resolve(rows) });
    } }) }),
    update: (table: any) => ({ set: (values: any) => ({ where: () => {
      io.updates.push({ table: getTableName(table), values });
      return Object.assign(Promise.resolve({ rowCount: 1 }), { returning: async () => [{ id: "image" }] });
    } }) }),
    delete: () => ({ where: io.deletePosts }),
    insert: (table: any) => ({ values: (values: any) => {
      if (getTableName(table) === "generated_posts") io.posts.push(values);
      if (getTableName(table) === "conference_images") {
        Object.assign(values, { status: "active", renderRevision: 0, renderDirty: true, createdAt: new Date() });
        io.images.push(values);
      }
      return Object.assign(Promise.resolve(), {
        onConflictDoNothing: async () => {}, returning: async () => [values],
      });
    } }),
    transaction: async (fn: any) => fn({
      update: (table: any) => ({ set: (values: any) => ({ where: () => {
        io.updates.push({ table: getTableName(table), values });
        return Object.assign(Promise.resolve(), { returning: async () => [{ id: "image" }] });
      } }) }),
    }),
  },
}));
vi.mock("../../replit_integrations/object_storage/objectStorage", () => ({
  ObjectStorageService: class {
    getPublicObjectSearchPaths() { return ["/fixture/public"]; }
    async searchPublicObject() { return { download: async () => [io.png] }; }
  },
  objectStorageClient: { bucket: () => ({ file: () => ({ save: io.save }) }) },
}));
vi.mock("../event-visual-assets", () => ({ registerEventVisualAsset: async () => "brand-image" }));
vi.mock("../ai-provider", () => ({ completeForFeature: io.complete }));
vi.mock("../voice-service", () => ({
  fetchVoiceProfile: async () => null, buildSystemPrompt: () => "Brand tone only", parseVariants: vi.fn(),
}));
vi.mock("../artifact-storage-helper", () => ({ archiveArtifactToSpe: vi.fn() }));
import { generateConferencePostsAsync } from "../conference-promotion-service";

const options = { socialAccountIds: ["linkedin", "twitter"], ownerUserId: "editor", generateImages: false };
const pool = (id: string, source = "uploaded", extra = {}) => ({
  id, role: "anchor", source, status: "active", conferenceId: "webinar", tenantDomain: "tenant.example",
  fileUrl: `/public-objects/conference-images/${id}.png`, createdAt: new Date(`2026-10-${id === "upload" ? "01" : id === "link" ? "02" : "03"}`),
  renderDirty: false, renderError: null, ...extra,
});

describe("zero-session main-event social series", () => {
  beforeEach(async () => {
    io.conf = {
      id: "webinar", name: "Better Collaboration Webinar", tenantDomain: "tenant.example", marketId: "market",
      campaignId: "campaign", website: "https://example.com/register", variantsPerPost: 3,
      promoStartDate: new Date("2026-10-19"), promoEndDate: new Date("2026-10-21"),
      postsPerDay: 2, includeSaturday: false, includeSunday: false, boothDetails: null,
    };
    io.accounts = [{ id: "linkedin", platform: "linkedin" }, { id: "twitter", platform: "twitter" }];
    io.images = [pool("upload"), pool("link"), pool("composite", "logo_composite"),
      pool("archived", "uploaded", { status: "archived" }), pool("failed", "logo_composite", { renderError: "failed" }),
      pool("stale", "logo_composite", { renderDirty: true })];
    io.sessions = [];
    io.posts = [];
    io.updates = [];
    vi.clearAllMocks();
    io.save.mockReset().mockResolvedValue(undefined);
    io.png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } }).png().toBuffer();
    io.complete.mockResolvedValue({ text: JSON.stringify([
      "Register for Better Collaboration Webinar.", "Explore better collaboration online.", "Learn practical collaboration techniques.",
    ]) });
  });

  it("fills the cadence window on every account and rotates mixed images predictably", async () => {
    await generateConferencePostsAsync("webinar", "tenant.example", "job", options);
    expect(io.posts).toHaveLength(12); // three eligible days × two/day × two accounts
    for (const account of io.accounts) {
      const posts = io.posts.filter(p => p.socialAccountId === account.id);
      expect(posts.map(p => p.conferenceImageId)).toEqual(["upload", "link", "composite", "upload", "link", "composite"]);
      expect(posts.every(p => p.postRole === "anchor" && p.status === "draft" && !p.conferenceSessionId)).toBe(true);
      expect(posts.every(p => p.sourceUrl === io.conf.website && p.content.includes(io.conf.website))).toBe(true);
      expect(posts.map(p => p.scheduledDate.toISOString().slice(0, 10))).toEqual([
        "2026-10-19", "2026-10-19", "2026-10-20", "2026-10-20", "2026-10-21", "2026-10-21",
      ]);
    }
    expect(io.posts.every(p => p.overrideImageUrl.startsWith("/public-objects/"))).toBe(true);
    expect(io.complete.mock.calls[0][1]).toContain("Do not invent sessions, speakers, attendance");
  });

  it("does not increase volume when the image pool is bigger than the schedule", async () => {
    io.images = Array.from({ length: 10 }, (_, i) => pool(`image${i}`));
    await generateConferencePostsAsync("webinar", "tenant.example", "job", options);
    expect(io.posts).toHaveLength(12);
  });

  it("does not make volume image-dependent when no end date is configured", async () => {
    io.conf.promoEndDate = null;
    await generateConferencePostsAsync("webinar", "tenant.example", "job", options);
    expect(io.posts).toHaveLength(4);
  });

  it("fails before deleting or writing posts if all choices are stale, failed or archived", async () => {
    io.images = io.images.slice(3);
    await expect(generateConferencePostsAsync("webinar", "tenant.example", "job", options)).rejects.toThrow("at least one ready");
    expect(io.deletePosts).not.toHaveBeenCalled();
    expect(io.posts).toHaveLength(0);
  });

  it("fails before replacing a batch if copy invents a session or speaker", async () => {
    io.complete.mockResolvedValue({ text: '["Join our keynote session with speaker Alex.", "We are attending the summit."]' });
    await expect(generateConferencePostsAsync("webinar", "tenant.example", "job", options)).rejects.toThrow("session, speaker, or attendance");
    expect(io.deletePosts).not.toHaveBeenCalled();
    expect(io.posts).toHaveLength(0);
  });

  it("preserves the conference's mixed anchor/session flow", async () => {
    io.sessions = [{ id: "session", title: "Saved session", sortOrder: 0, url: "https://example.com/session" }];
    io.images = [pool("upload"), pool("session", "template_composite", { sessionId: "session", role: "session" })];
    await generateConferencePostsAsync("webinar", "tenant.example", "job", options);
    expect(io.posts).toHaveLength(12);
    expect(io.posts.filter(p => p.postRole === "session")).toHaveLength(6);
    expect(io.posts.filter(p => p.postRole === "session").every(p =>
      p.conferenceSessionId === "session" && p.sourceUrl === "https://example.com/session")).toBe(true);
  });

  it("creates, renders and reuses default anchor graphics for events with sessions", async () => {
    io.conf.anchorPostCount = 2;
    io.sessions = [{ id: "session", title: "Saved session", sortOrder: 0 }];
    io.images = [pool("session", "template_composite", { sessionId: "session", role: "session" })];
    const renderOptions = { ...options, generateImages: true };
    await generateConferencePostsAsync("webinar", "tenant.example", "job", renderOptions);
    expect(io.images.filter(i => i.role === "anchor")).toHaveLength(2);
    expect(io.save).toHaveBeenCalledTimes(2);
    expect(io.posts.filter(p => p.postRole === "anchor").length).toBeGreaterThan(0);
    expect(io.posts.every(p => p.conferenceImageId && p.overrideImageUrl?.startsWith("/public-objects/"))).toBe(true);
    await generateConferencePostsAsync("webinar", "tenant.example", "job-again", renderOptions);
    expect(io.images.filter(i => i.role === "anchor")).toHaveLength(2);
    expect(io.save).toHaveBeenCalledTimes(2);
  }, 30000);

  it("creates an anchor for a new sessionless event without changing cadence volume", async () => {
    io.conf.anchorPostCount = 1;
    io.images = [];
    await generateConferencePostsAsync("webinar", "tenant.example", "job", { ...options, generateImages: true });
    expect(io.images).toHaveLength(1);
    expect(io.posts).toHaveLength(12);
    expect(io.posts.every(p => p.postRole === "anchor" && p.overrideImageUrl)).toBe(true);
  }, 30000);

  it("never saves text-only anchors when auto-render is disabled", async () => {
    io.sessions = [{ id: "session", title: "Saved session", sortOrder: 0 }];
    io.images = [pool("session", "template_composite", { sessionId: "session", role: "session" })];
    await expect(generateConferencePostsAsync("webinar", "tenant.example", "job", options))
      .rejects.toThrow("ready event image");
    expect(io.deletePosts).not.toHaveBeenCalled();
    expect(io.posts).toHaveLength(0);
  });

  it("preserves the existing batch when all newly created anchors fail to render", async () => {
    io.images = [];
    io.save.mockRejectedValue(new Error("storage unavailable"));
    await expect(generateConferencePostsAsync("webinar", "tenant.example", "job", { ...options, generateImages: true }))
      .rejects.toThrow("ready event image");
    expect(io.deletePosts).not.toHaveBeenCalled();
    expect(io.posts).toHaveLength(0);
  });

  it("does not add defaults over an existing failed anchor pool", async () => {
    io.images = [pool("failed", "logo_composite", { renderError: "failed" })];
    await expect(generateConferencePostsAsync("webinar", "tenant.example", "job", { ...options, generateImages: true }))
      .rejects.toThrow("ready event image");
    expect(io.images).toHaveLength(1);
    expect(io.deletePosts).not.toHaveBeenCalled();
  });
});
