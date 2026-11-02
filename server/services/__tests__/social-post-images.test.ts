import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ results: [] as any[][], filters: [] as any[] }));
vi.mock("../../db", () => ({
  db: {
    select: () => {
      const result = state.results.shift() || [];
      const chain: any = {
        from: () => chain, leftJoin: () => chain,
        where: (filter: any) => { state.filters.push(filter); return chain; },
        orderBy: () => chain,
        then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    },
  },
}));
import { resolveSocialPostImages, selectPostImage, withPublishImage } from "../social-post-images";

const post = {
  tenantDomain: "example.com", campaignId: "campaign", sourceAssetId: null,
  sourceUrl: "https://example.com/article", status: "approved",
};
const source = {
  id: "asset", campaignId: "campaign", url: post.sourceUrl,
  leadImageUrl: "/public-objects/article.png", fileUrl: null, fileType: null,
};

beforeEach(() => { state.results = []; state.filters = []; });

describe("social image precedence", () => {
  it("uses the linked source article for legacy posts with no sourceAssetId", () => {
    expect(selectPostImage(post, [source], new Map())).toBe(source.leadImageUrl);
  });
  it("preserves explicit image and brand overrides over source images", () => {
    expect(selectPostImage({ ...post, overrideImageUrl: "/custom.png" }, [source], new Map())).toBe("/custom.png");
    expect(selectPostImage({ ...post, overrideBrandAssetId: "brand" }, [source], new Map([["brand", "/brand.png"]]))).toBe("/brand.png");
  });
  it("prefers sourceAssetId over URL and ignores unrelated campaign defaults", () => {
    const byId = { ...source, id: "exact", url: null, leadImageUrl: "/exact.png" };
    expect(selectPostImage({ ...post, sourceAssetId: "exact" }, [source, byId], new Map())).toBe("/exact.png");
    expect(selectPostImage({ ...post, campaignId: "other", sourceUrl: null }, [source], new Map())).toBeNull();
  });
  it("uses campaign asset order as the final legacy default", () => {
    expect(selectPostImage({ ...post, sourceUrl: null }, [source, { ...source, leadImageUrl: "/second.png" }], new Map())).toBe(source.leadImageUrl);
  });
  it("does not pretend previously text-only delivered posts included source images", () => {
    for (const status of ["published", "exported"]) {
      expect(selectPostImage({ ...post, status }, [source], new Map())).toBeNull();
      expect(selectPostImage({ ...post, status, overrideImageUrl: "/attempted.png" }, [source], new Map())).toBe("/attempted.png");
    }
    expect(selectPostImage({ ...post, publishedAt: new Date() }, [source], new Map())).toBeNull();
  });
  it("does not replace an explicitly selected missing brand image with an unrelated default", () => {
    expect(selectPostImage({ ...post, overrideBrandAssetId: "missing" }, [source], new Map())).toBeNull();
  });
  it("accepts source image files but not PDF file URLs", () => {
    const fileSource = { ...source, leadImageUrl: null, fileUrl: "/original.png", fileType: "image/png" };
    expect(selectPostImage(post, [fileSource], new Map())).toBe("/original.png");
    expect(selectPostImage(post, [{ ...fileSource, fileType: "application/pdf" }], new Map())).toBeNull();
  });
});

describe("image lookup and publisher hydration", () => {
  it("batches lookups and scopes every lookup to the tenant", async () => {
    state.results = [[source]];
    const result = await resolveSocialPostImages([post, { ...post }]);
    expect(result.map(p => p.leadImageUrl)).toEqual([source.leadImageUrl, source.leadImageUrl]);
    expect(state.filters).toHaveLength(1);
    expect(new PgDialect().sqlToQuery(state.filters[0]).params).toContain(post.tenantDomain);
  });
  it("feeds the resolved image as a required publisher override for legacy posts", async () => {
    state.results = [[source]];
    expect((await withPublishImage(post)).overrideImageUrl).toBe(source.leadImageUrl);
    expect(post).not.toHaveProperty("overrideImageUrl");
  });
  it("resolves selected brand assets with tenant ownership filtering", async () => {
    state.results = [[{ id: "brand", fileUrl: "/brand.png", url: "/unused.png" }], [source]];
    const result = await withPublishImage({ ...post, overrideBrandAssetId: "brand" });
    expect(result.overrideImageUrl).toBe("/brand.png");
    expect(state.filters).toHaveLength(2);
    for (const filter of state.filters) expect(new PgDialect().sqlToQuery(filter).params).toContain(post.tenantDomain);
  });
  it("rejects an unavailable selected asset rather than silently posting text", async () => {
    state.results = [[], [source]];
    await expect(withPublishImage({ ...post, overrideBrandAssetId: "missing" })).rejects.toThrow("selected post image is unavailable");
  });
  it("does not look up images for delivered or explicitly imaged posts", async () => {
    const result = await resolveSocialPostImages([{ ...post, status: "published" }, { ...post, overrideImageUrl: "/custom.png" }]);
    expect(result.map(p => p.leadImageUrl)).toEqual([null, "/custom.png"]);
    expect(state.filters).toHaveLength(0);
  });
});
