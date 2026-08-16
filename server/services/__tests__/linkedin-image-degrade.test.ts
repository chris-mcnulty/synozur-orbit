/**
 * LinkedIn publisher — image degradation paths after the shared
 * image-retrieval helper (Task #777).
 *
 * - Single-image post WITHOUT an override image: an unrecoverable image
 *   still degrades to a text-only post (publish succeeds).
 * - Single-image post WITH an override image: the typed image code
 *   (image_not_found) propagates as the publish error so the worker can
 *   classify it as permanent.
 * - Carousel: slides that fail to load are skipped; the post publishes with
 *   the remaining slides.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const helper = vi.hoisted(() => ({
  /** imageUrl → Buffer | Error to throw */
  images: new Map<string, any>(),
}));

vi.mock("../social-publishers/image-retrieval", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    fetchImageBytes: async (url: string) => {
      const v = helper.images.get(url);
      if (v instanceof Error) throw v;
      if (!v) throw new actual.ImageRetrievalError("image_not_found", `missing: ${url}`);
      return { buffer: v, contentType: "image/png" };
    },
  };
});

vi.mock("../platform-credentials-service", () => ({
  getPlatformCredentials: async () => ({ clientId: "id", clientSecret: "secret" }),
  isLinkedInDirectPublishEnabled: () => true,
}));
vi.mock("../linkedin-provider", () => ({ isLinkedInMcpConfigured: () => false }));
vi.mock("../linkedin-mcp-client", () => ({ callLinkedInTool: vi.fn(), extractText: vi.fn() }));
vi.mock("../../utils/encryption", () => ({
  decryptSecret: (s: string) => s.replace(/^enc:/, ""),
  encryptSecret: (s: string) => `enc:${s}`,
}));
vi.mock("../sharepoint-graph-client.js", () => ({ GraphClient: class {} }));

import { ImageRetrievalError } from "../social-publishers/image-retrieval";
import { getPublisher } from "../social-publishers";

const account: any = {
  id: "acct-1",
  platform: "linkedin",
  authorUrn: "urn:li:person:abc",
  encryptedAccessToken: "enc:token",
  tokenExpiresAt: new Date(Date.now() + 3600_000),
};

/** Mock the LinkedIn REST surface: image init/PUT, document init (404), posts. */
function mockLinkedInApi() {
  let imageN = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes("/v2/images?action=initializeUpload")) {
      imageN += 1;
      return new Response(JSON.stringify({
        value: { uploadUrl: `https://upload.linkedin.test/${imageN}`, image: `urn:li:image:${imageN}` },
      }), { status: 200 });
    }
    if (url.startsWith("https://upload.linkedin.test/")) {
      return new Response("", { status: 201 });
    }
    if (url.includes("/rest/documents?action=initializeUpload")) {
      // Document API unavailable → carousel falls back to multiImage.
      return new Response(JSON.stringify({ message: "RESOURCE_NOT_FOUND" }), { status: 404 });
    }
    if (url.endsWith("/v2/posts")) {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: "urn:li:share:1", __sentBody: body }), {
        status: 200,
        headers: { "x-restli-id": "urn:li:share:1" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  helper.images.clear();
  vi.restoreAllMocks();
});

describe("LinkedIn image degradation", () => {
  it("degrades to text-only when a non-override image is unrecoverable", async () => {
    const spy = mockLinkedInApi();
    const post: any = {
      id: "p1", content: "hello", hashtags: [],
      leadImageUrl: "/public-objects/missing.png", overrideImageUrl: null,
    };
    const result = await getPublisher("linkedin")!.publish({ account, post } as any);
    expect(result.success).toBe(true);
    const postCall = spy.mock.calls.find(c => String(c[0]).endsWith("/v2/posts"))!;
    const sent = JSON.parse((postCall[1] as any).body);
    expect(sent.content).toBeUndefined(); // text-only
  });

  it("fails with the typed image code when the override image is missing", async () => {
    mockLinkedInApi();
    const post: any = {
      id: "p2", content: "hello", hashtags: [],
      overrideImageUrl: "/public-objects/missing.png",
    };
    const result = await getPublisher("linkedin")!.publish({ account, post } as any);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("image_not_found");
  });

  it("carousel skips failed slides and publishes the rest via multiImage", async () => {
    mockLinkedInApi();
    // Valid 1x1 transparent PNG so buildCarouselPdf can embed the slides.
    const onePxPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    helper.images.set("/public-objects/s1.png", onePxPng);
    helper.images.set("/public-objects/s3.png", onePxPng);
    helper.images.set("/public-objects/s2.png", new ImageRetrievalError("image_fetch_failed", "blip", true));
    const post: any = {
      id: "p3", content: "carousel", hashtags: [], postFormat: "carousel",
      carouselSlides: [
        { imageUrl: "/public-objects/s1.png" },
        { imageUrl: "/public-objects/s2.png" },
        { imageUrl: "/public-objects/s3.png" },
      ],
    };
    const result = await getPublisher("linkedin")!.publish({ account, post } as any);
    expect(result.success).toBe(true);
  });
});
