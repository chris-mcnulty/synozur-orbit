import { it, expect, vi, afterEach } from "vitest";
vi.mock("../../utils/encryption", () => ({ decryptSecret: () => "test-access-token" }));
vi.mock("../platform-credentials-service", () => ({ getPlatformCredentials: vi.fn(), isDirectPublishEnabled: vi.fn() }));
import { InstagramPublisher } from "../social-publishers/instagram";

afterEach(() => vi.unstubAllGlobals());
it("sends a link-free caption to Instagram without changing saved content or the media URL", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, text: async () => '{"error":{"message":"test boundary"}}' });
  vi.stubGlobal("fetch", fetchMock);
  const post: any = { content: "Look at the light.\nhttps://example.com/print", overrideImageUrl: "https://example.com/art.jpg", hashtags: ["Art"] };
  await new InstagramPublisher().publish({
    account: { encryptedAccessToken: "test-only", authorUrn: "ig:user:123" }, post,
  } as any);
  const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(payload.caption).toBe("Look at the light.\n\n#Art");
  expect(payload.image_url).toBe("https://example.com/art.jpg");
  expect(post.content).toContain("https://example.com/print");
});
it("fails explicitly if removing links leaves no caption", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const result = await new InstagramPublisher().publish({
    account: { encryptedAccessToken: "test-only", authorUrn: "ig:user:123" },
    post: { content: "https://example.com/print", overrideImageUrl: "https://example.com/art.jpg" },
  } as any);
  expect(result.errorCode).toBe("empty_caption");
  expect(fetchMock).not.toHaveBeenCalled();
});
