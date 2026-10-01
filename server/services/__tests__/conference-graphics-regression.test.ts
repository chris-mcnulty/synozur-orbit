import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conference, ConferenceImage, ConferenceSession } from "@shared/schema";

// Only I/O is mocked: PNG encoding, resizing and SVG compositing use real Sharp.
const io = vi.hoisted(() => ({
  where: vi.fn(),
  update: vi.fn(),
  save: vi.fn(),
  download: vi.fn(),
}));
vi.mock("../../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: io.where }) }),
    update: io.update,
  },
}));
vi.mock("../../replit_integrations/object_storage/objectStorage", () => ({
  ObjectStorageService: class {
    getPublicObjectSearchPaths() { return ["/fixture-bucket/public"]; }
    async searchPublicObject(url: string) {
      return { download: () => io.download(url) };
    }
  },
  objectStorageClient: {
    bucket: () => ({ file: () => ({ save: io.save }) }),
  },
}));
vi.mock("../artifact-storage-helper", () => ({ archiveArtifactToSpe: vi.fn() }));
vi.mock("../ai-provider", () => ({ completeForFeature: vi.fn() }));
vi.mock("../voice-service", () => ({
  fetchVoiceProfile: vi.fn(), buildSystemPrompt: vi.fn(), parseVariants: vi.fn(),
}));

import { renderConferenceImage } from "../conference-promotion-service";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const eventLogo = fixture("conference-event-logo.svg");
const companyLogo = fixture("conference-company-logo.svg");
// Use a checked-in, real TTF rather than a fake @font-face or a host system font.
const fontPath = fileURLToPath(new URL("../../../client/public/fonts/MetroNovaBold.ttf", import.meta.url));
const fontBytes = readFileSync(fontPath);
const fontAsset = {
  fontUsage: "heading", fontFamily: "Metro Nova", fontWeight: "700",
  fileType: "font/ttf", fileUrl: "/public-objects/fixture-font.ttf",
};
const tenant = { primaryColor: "#2468AC", logoUrl: "/public-objects/company.svg" };
const conference = {
  id: "fixture-conference", tenantDomain: "fixture.example", marketId: null,
  name: "Collaboration Summit", location: "Seattle & Online",
  startDate: new Date("2026-10-01T00:00:00Z"),
  endDate: new Date("2026-10-03T00:00:00Z"),
  eventLogoFileUrl: "/public-objects/event.svg",
  website: "https://www.example.com/summit", createdBy: "fixture-user",
} as Conference;
const session = {
  id: "fixture-session", conferenceId: conference.id,
  title: "Building Better Workplaces",
  speakers: [{ name: "Alex Rivera" }, { name: "Sam Taylor" }],
  speaker: "Legacy name must not appear",
  room: "Room 4 & 5", sessionStart: new Date("2026-10-02T14:30:00Z"),
} as ConferenceSession;
function image(role: "anchor" | "session", extra: Partial<ConferenceImage> = {}): ConferenceImage {
  return {
    id: `fixture-${role}`, conferenceId: conference.id, tenantDomain: conference.tenantDomain,
    role, source: role === "anchor" ? "logo_composite" : "template_composite",
    sessionId: role === "session" ? session.id : null,
    fileUrl: null, backgroundId: null, templateAssetId: null, ...extra,
  } as ConferenceImage;
}

function rows(...results: unknown[][]) {
  for (const result of results) io.where.mockResolvedValueOnce(result);
}
function savedPng(): Buffer {
  expect(io.save).toHaveBeenCalledTimes(1);
  expect(io.save.mock.calls[0][1]).toEqual({ metadata: { contentType: "image/png" } });
  return io.save.mock.calls[0][0];
}
async function pixels(png: Buffer) {
  expect(await sharp(png).metadata()).toMatchObject({ width: 1200, height: 675, format: "png" });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
}
function expectColor(actual: number[], rgb: number[], tolerance = 0) {
  rgb.forEach((value, i) => expect(Math.abs(actual[i] - value)).toBeLessThanOrEqual(tolerance));
  expect(actual[3]).toBe(255);
}

describe("conference brand rendering regressions", () => {
  let compositeSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetAllMocks();
    io.update.mockReturnValue({ set: () => ({ where: vi.fn().mockResolvedValue(undefined) }) });
    io.download.mockImplementation(async (url: string) => {
      const bytes = {
        "company.svg": companyLogo, "event.svg": eventLogo, "fixture-font.ttf": fontBytes,
      }[url];
      if (!bytes) throw new Error(`Fixture asset is inaccessible: ${url}`);
      return [bytes];
    });
    compositeSpy = vi.spyOn(sharp.prototype, "composite");
  });
  afterEach(() => vi.restoreAllMocks());

  function overlaySvg(): string {
    const layers = compositeSpy.mock.calls[0][0] as sharp.OverlayOptions[];
    expect(layers).toHaveLength(3); // text/scrim + event logo + company logo
    return (layers[0].input as Buffer).toString();
  }
  function expectBrandFont(svg: string) {
    expect(svg).toContain(`font-family: 'Metro Nova'; font-weight: 700; src: url('data:font/ttf;base64,${fontBytes.toString("base64")}')`);
    const textTags = svg.match(/<text\b[^>]*>/g) ?? [];
    expect(textTags.length).toBeGreaterThan(0);
    for (const tag of textTags) {
      expect(tag).toContain('font-family="\'Metro Nova\', \'Avenir Next LT Pro\'');
    }
  }

  it("renders an anchor with both logos, tenant color, configured font and event information", async () => {
    rows([tenant], [], [fontAsset]);
    expect(await renderConferenceImage(image("anchor"), conference)).toMatch(/^\/public-objects\/conference-images\/.*\.png$/);
    const at = await pixels(savedPng());
    expectColor(at(475, 225), [255, 204, 0]);
    expectColor(at(600, 260), [255, 255, 255]);
    expectColor(at(965, 590), [0, 221, 136]);
    expectColor(at(1060, 615), [255, 255, 255]);
    expectColor(at(0, 0), [36, 104, 172], 1);
    const svg = overlaySvg();
    expectBrandFont(svg);
    expect(svg).toContain("Collaboration Summit");
    expect(svg).toContain("Seattle &amp; Online");
    expect(svg).toContain("October 1–3");
    expect(svg).toContain("example.com/summit");
    expect(svg).toContain('stop-color="rgba(36,104,172,0.18)"');
    expect(io.update).toHaveBeenCalledTimes(1);
  });

  it("renders a session with the same brand kit and actual structured session details", async () => {
    rows([tenant], [], [fontAsset]);
    await renderConferenceImage(image("session"), conference, session);
    const at = await pixels(savedPng());
    expectColor(at(69, 49), [255, 204, 0]);
    expectColor(at(194, 94), [255, 255, 255]);
    expectColor(at(965, 595), [0, 221, 136]);
    expectColor(at(1060, 619), [255, 255, 255]);
    expectColor(at(0, 0), [31, 84, 140], 1);
    const svg = overlaySvg();
    expectBrandFont(svg);
    expect(svg).toContain("Building Better Workplaces");
    expect(svg).toContain("Alex Rivera, Sam Taylor");
    expect(svg).not.toContain(session.speaker);
    expect(svg).toContain("Room 4 &amp; 5 · Oct 2, 2026, 2:30 PM");
    expect(svg).toContain("October 1–3");
    expect(svg).toContain("example.com/summit");
  });

  it("uses a selected template's pixels instead of silently replacing it with a gradient", async () => {
    const template = await sharp({ create: { width: 1200, height: 675, channels: 3, background: "#cc4488" } }).png().toBuffer();
    io.download.mockImplementationOnce(async () => [companyLogo])
      .mockImplementationOnce(async () => [eventLogo])
      .mockImplementationOnce(async () => [template]);
    rows([tenant], [], [{ fileUrl: "/public-objects/template.png", marketId: null }], [fontAsset]);
    await renderConferenceImage(image("session", { templateAssetId: "fixture-template" }), conference, session);
    const at = await pixels(savedPng());
    expectColor(at(0, 0), [157, 57, 113], 1);
    expectBrandFont(overlaySvg());
  });

  describe.each(["anchor", "session"] as const)("%s fails closed", (role) => {
    async function expectFailure(conf: Conference, record: ConferenceImage, message: string) {
      await expect(renderConferenceImage(record, conf, role === "session" ? session : undefined))
        .rejects.toThrow(message);
      expect(io.save).not.toHaveBeenCalled();
      expect(io.update).not.toHaveBeenCalled();
      expect(compositeSpy).not.toHaveBeenCalled();
    }
    it("rejects a missing company logo", async () => {
      rows([{ ...tenant, logoUrl: null }], []);
      await expectFailure(conference, image(role), "Configure a company logo");
    });
    it("rejects a missing event logo", async () => {
      rows([tenant], []);
      await expectFailure({ ...conference, eventLogoFileUrl: null }, image(role), "Upload the conference event logo");
    });
    it("rejects an inaccessible configured font without saving a fallback graphic", async () => {
      rows([tenant], [], [{ ...fontAsset, fileUrl: "/public-objects/missing-font.ttf" }]);
      await expectFailure(conference, image(role), "Fixture asset is inaccessible: missing-font.ttf");
    });
    it("rejects incomplete configured font metadata", async () => {
      rows([tenant], [], [{ ...fontAsset, fontFamily: null }]);
      await expectFailure(conference, image(role), "Configured tenant font is missing");
    });
  });

  it("rejects an inaccessible selected template without saving a gradient fallback", async () => {
    rows([tenant], [], [{ fileUrl: "/public-objects/missing-template.png", marketId: null }]);
    await expect(renderConferenceImage(image("session", { templateAssetId: "missing-template" }), conference, session))
      .rejects.toThrow("Fixture asset is inaccessible: missing-template.png");
    expect(io.save).not.toHaveBeenCalled();
    expect(io.update).not.toHaveBeenCalled();
  });

  it("rejects a selected template that is no longer available", async () => {
    rows([tenant], [], []);
    await expect(renderConferenceImage(image("session", { templateAssetId: "deleted-template" }), conference, session))
      .rejects.toThrow("Selected brand template is not available for this market");
    expect(io.save).not.toHaveBeenCalled();
    expect(io.update).not.toHaveBeenCalled();
  });
});