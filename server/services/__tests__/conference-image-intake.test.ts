import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));
vi.mock("../../replit_integrations/object_storage/objectStorage", () => ({
  ObjectStorageService: class { getPublicObjectSearchPaths() { return ["/fixture/public"]; } },
  objectStorageClient: { bucket: () => ({ file: () => ({ save: io.save }) }) },
}));
vi.mock("../../db", () => ({ db: {} }));
vi.mock("../artifact-storage-helper", () => ({ archiveArtifactToSpe: vi.fn() }));
vi.mock("../ai-provider", () => ({ completeForFeature: vi.fn() }));
vi.mock("../voice-service", () => ({ fetchVoiceProfile: vi.fn(), buildSystemPrompt: vi.fn(), parseVariants: vi.fn() }));
import { publishConferenceSource, conferenceGraphicFailure } from "../conference-promotion-service";

describe("event linked-image intake uses the shared safe loader", () => {
  beforeEach(() => { vi.restoreAllMocks(); io.save.mockReset(); });
  it("decodes actual image bytes and publishes a PNG rather than retaining a remote URL", async () => {
    const bytes = await sharp({ create: { width: 30, height: 20, channels: 3, background: "green" } }).jpeg().toBuffer();
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes, { headers: { "content-type": "text/html" } }));
    const result = await publishConferenceSource("https://cdn.example.com/no-extension");
    expect(result.fileUrl).toMatch(/^\/public-objects\/conference-images\/.*\.png$/);
    expect(await sharp(io.save.mock.calls[0][0]).metadata()).toMatchObject({ format: "png", width: 30, height: 20 });
    expect((fetch.mock.calls[0][1] as any).dispatcher).toBeDefined();
  });
  it("rejects invalid bytes despite an image MIME label", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>Sign in</html>", { headers: { "content-type": "image/png" } }));
    await expect(publishConferenceSource("https://cdn.example.com/private.png")).rejects.toMatchObject({ code: "source_invalid" });
    expect(io.save).not.toHaveBeenCalled();
  });
  it("rejects redirects to private networks before connecting there", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", {
      status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" },
    }));
    await expect(publishConferenceSource("https://cdn.example.com/photo.png")).rejects.toMatchObject({ code: "source_invalid" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(io.save).not.toHaveBeenCalled();
  });
  it("rejects oversized responses before buffering or publishing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new ReadableStream(), {
      headers: { "content-length": String(21 * 1024 * 1024) },
    }));
    await expect(publishConferenceSource("https://cdn.example.com/huge.png")).rejects.toMatchObject({ code: "source_invalid" });
    expect(io.save).not.toHaveBeenCalled();
  });
  it("gives a safe actionable error for private external links without leaking their query", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 403 }));
    try {
      await publishConferenceSource("https://cdn.example.com/private.png?signature=do-not-expose");
      throw new Error("expected rejection");
    } catch (error) {
      const safe = conferenceGraphicFailure(error);
      expect(safe.code).toBe("source_invalid");
      expect(safe.error).toContain("accessible public image link");
      expect(safe.error).not.toContain("do-not-expose");
    }
    expect(io.save).not.toHaveBeenCalled();
  });
});
