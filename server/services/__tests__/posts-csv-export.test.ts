/**
 * Unit tests for the isOrbitDirectPost helper.
 *
 * This is the routing predicate that decides whether a post is published
 * natively by Orbit (excluded from CSV) or needs an external scheduler
 * (included in CSV). Tests cover all four classification branches plus
 * the paused-but-autoPublish edge case that triggered the original bug.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { selectRows } = vi.hoisted(() => ({ selectRows: [] as any[][] }));
const storageMocks = vi.hoisted(() => ({
  sourceGetMetadata: vi.fn(),
  sourceDownload: vi.fn(),
  destinationSave: vi.fn(),
  searchPublicObject: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(selectRows.shift() ?? []),
      }),
    }),
  },
}));

vi.mock("../../replit_integrations/object_storage/objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityFile = vi.fn(async () => ({
      getMetadata: storageMocks.sourceGetMetadata,
      download: storageMocks.sourceDownload,
    }));
    searchPublicObject = storageMocks.searchPublicObject;
    getPublicObjectSearchPaths = () => ["/public-bucket/public"];
  },
  objectStorageClient: {
    bucket: () => ({
      file: () => ({ save: storageMocks.destinationSave }),
    }),
  },
}));

import {
  buildPostsCsv,
  isOrbitDirectPost,
  resolveSocialPilotAccountId,
} from "../posts-csv-export";

beforeEach(() => {
  selectRows.length = 0;
  vi.clearAllMocks();
  storageMocks.sourceGetMetadata.mockResolvedValue([{ contentType: "image/jpeg" }]);
  storageMocks.sourceDownload.mockResolvedValue([Buffer.from("image")]);
  storageMocks.searchPublicObject.mockResolvedValue(null);
  storageMocks.destinationSave.mockResolvedValue(undefined);
});

function makeMap(entries: [string, boolean][]): Map<string, boolean> {
  return new Map(entries);
}

describe("isOrbitDirectPost", () => {
  // ── Explicit CSV override ────────────────────────────────────────────────
  describe("deliveryMode='csv' (explicit override)", () => {
    it("returns false (CSV-eligible) even when account has autoPublish=true", () => {
      const post = { deliveryMode: "csv", socialAccountId: "acct-1" };
      const map = makeMap([["acct-1", true]]);
      expect(isOrbitDirectPost(post, map)).toBe(false);
    });

    it("returns false even with no account link at all", () => {
      const post = { deliveryMode: "csv", socialAccountId: null };
      expect(isOrbitDirectPost(post, new Map())).toBe(false);
    });
  });

  // ── autoPublish=true → Orbit owns the post ───────────────────────────────
  describe("deliveryMode=null + autoPublish=true", () => {
    it("returns true (Orbit-direct) for a normal auto-publish account", () => {
      const post = { deliveryMode: null, socialAccountId: "acct-1" };
      const map = makeMap([["acct-1", true]]);
      expect(isOrbitDirectPost(post, map)).toBe(true);
    });

    it("returns true even when the account is publishingPaused (paused ≠ CSV)", () => {
      // publishingPaused is a worker gate, not an ownership signal.
      // The account still owns the post; exporting it to CSV while paused
      // would cause duplicates when Orbit publishing resumes.
      const post = { deliveryMode: null, socialAccountId: "acct-paused" };
      // autoPublishMap only tracks the autoPublish flag — paused is irrelevant
      const map = makeMap([["acct-paused", true]]);
      expect(isOrbitDirectPost(post, map)).toBe(true);
    });
  });

  // ── autoPublish=false → external scheduler handles this post ─────────────
  describe("deliveryMode=null + autoPublish=false", () => {
    it("returns false (CSV-eligible) when account has autoPublish=false", () => {
      const post = { deliveryMode: null, socialAccountId: "acct-2" };
      const map = makeMap([["acct-2", false]]);
      expect(isOrbitDirectPost(post, map)).toBe(false);
    });
  });

  // ── No linked account → conservative inclusion ───────────────────────────
  describe("deliveryMode=null + no linked account", () => {
    it("returns false (CSV-eligible) when socialAccountId is null", () => {
      const post = { deliveryMode: null, socialAccountId: null };
      expect(isOrbitDirectPost(post, new Map())).toBe(false);
    });

    it("returns false (CSV-eligible) when account is not in the map", () => {
      const post = { deliveryMode: null, socialAccountId: "unknown-acct" };
      const map = makeMap([["other-acct", true]]);
      expect(isOrbitDirectPost(post, map)).toBe(false);
    });
  });

  // ── Mixed accounts in one campaign ───────────────────────────────────────
  describe("mixed campaign: some autoPublish=true, some false", () => {
    const autoPublishMap = makeMap([
      ["x-acct", true],          // X — Orbit-direct (e.g. August New Cascadia bug scenario)
      ["fb-acct", false],        // Facebook — needs CSV
    ]);

    it("excludes X posts from CSV when X has autoPublish=true", () => {
      const xPost = { deliveryMode: null, socialAccountId: "x-acct" };
      expect(isOrbitDirectPost(xPost, autoPublishMap)).toBe(true);
    });

    it("includes Facebook posts in CSV when Facebook has autoPublish=false", () => {
      const fbPost = { deliveryMode: null, socialAccountId: "fb-acct" };
      expect(isOrbitDirectPost(fbPost, autoPublishMap)).toBe(false);
    });

    it("explicit deliveryMode='csv' on X account still exports to CSV", () => {
      const xCsvPost = { deliveryMode: "csv", socialAccountId: "x-acct" };
      expect(isOrbitDirectPost(xCsvPost, autoPublishMap)).toBe(false);
    });
  });
});

describe("SocialPilot account ID resolution", () => {
  it("prefers the separately configured SocialPilot ID over the OAuth provider ID", () => {
    expect(resolveSocialPilotAccountId({
      socialPilotAccountId: " socialpilot-profile-42 ",
      accountId: "urn:li:organization:provider-page",
    })).toBe("socialpilot-profile-42");
  });

  it("uses the historic provider ID only until a dedicated SocialPilot ID is saved", () => {
    expect(resolveSocialPilotAccountId({
      socialPilotAccountId: null,
      accountId: "legacy-socialpilot-id",
    })).toBe("legacy-socialpilot-id");
  });

  it("writes the dedicated SocialPilot ID to the SocialPilot CSV account column", async () => {
    selectRows.push([{
      id: "account-1",
      platform: "linkedin",
      accountName: "Orbit company page",
      accountId: "urn:li:organization:provider-page",
      socialPilotAccountId: "socialpilot-profile-42",
    }]);

    const csv = await buildPostsCsv({
      posts: [{
        id: "post-1",
        platform: "linkedin",
        socialAccountId: "account-1",
        content: "A post for SocialPilot",
        hashtags: [],
        scheduledDate: new Date("2030-01-10T15:00:00Z"),
      }],
      tenantDomain: "tenant.example.com",
      format: "socialpilot",
      tzOffset: 0,
    });

    expect(csv).toContain('"socialpilot-profile-42"');
    expect(csv).not.toContain('"urn:li:organization:provider-page"');
  });

  it("keeps SocialPilot first comments blank instead of repeating account names or tags", async () => {
    selectRows.push([{
      id: "account-1",
      platform: "linkedin",
      accountName: "Chris McNulty",
      accountId: "urn:li:person:provider-profile",
      socialPilotAccountId: "socialpilot-profile-42",
    }]);

    const csv = await buildPostsCsv({
      posts: [{
        id: "post-1",
        platform: "linkedin",
        socialAccountId: "account-1",
        content: "A post for SocialPilot",
        hashtags: ["CascadiaOceanic", "Alaska"],
        scheduledDate: new Date("2030-01-10T15:00:00Z"),
      }],
      tenantDomain: "tenant.example.com",
      format: "socialpilot",
      tzOffset: 0,
    });

    expect(csv).toBe(
      '"A post for SocialPilot","","Jan 10, 2030 3:00 PM","socialpilot-profile-42","","CascadiaOceanic;Alaska",""',
    );
    expect(csv).not.toContain("Chris McNulty");
    expect(csv).not.toContain("#CascadiaOceanic");
  });

  it("publishes private Orbit images and exports an absolute anonymous URL", async () => {
    const csv = await buildPostsCsv({
      posts: [{
        id: "post-1",
        platform: "linkedin",
        content: "A post with an uploaded image",
        hashtags: [],
        overrideImageUrl: "/objects/uploads/image-123",
        scheduledDate: new Date("2030-01-10T15:00:00Z"),
      }],
      tenantDomain: "tenant.example.com",
      format: "socialpilot",
      tzOffset: 0,
      imageBaseUrl: "https://orbit.example.com",
    });

    expect(storageMocks.destinationSave).toHaveBeenCalledWith(
      Buffer.from("image"),
      { contentType: "image/jpeg", resumable: false },
    );
    expect(csv).toContain(
      '"https://orbit.example.com/public-objects/social-exports/uploads/image-123"',
    );
    expect(csv).not.toContain('"/objects/uploads/image-123"');
  });
});
