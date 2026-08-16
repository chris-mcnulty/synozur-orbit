/**
 * Shared image-retrieval helper (Task #777).
 *
 * Covers:
 *  - storage-direct path for /public-objects/ URLs (relative + absolute)
 *  - typed errors: image_not_found (missing object / 404), image_forbidden (401/403)
 *  - fast in-place retries for transient failures (5xx, network errors)
 *  - checkImageResolvable preflight semantics (transient vs permanent)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const storageState = vi.hoisted(() => ({
  /** filePath → file object or null (missing). Function values throw. */
  files: new Map<string, any>(),
  searchCalls: [] as string[],
  /** When set, searchPublicObject throws this many times before succeeding. */
  throwTimes: 0,
  throwErr: null as any,
}));

// DNS is mocked so hostname tests never hit the network: *.example.com
// resolves to a public address; internal.test resolves to a private one.
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => {
    if (host.endsWith("example.com")) return [{ address: "93.184.216.34", family: 4 }];
    if (host === "internal.test") return [{ address: "10.0.0.5", family: 4 }];
    throw new Error(`ENOTFOUND ${host}`);
  },
}));

vi.mock("../../replit_integrations/object_storage/objectStorage", () => ({
  ObjectStorageService: class {
    async searchPublicObject(filePath: string) {
      storageState.searchCalls.push(filePath);
      if (storageState.throwTimes > 0) {
        storageState.throwTimes -= 1;
        throw storageState.throwErr ?? new Error("storage hiccup");
      }
      return storageState.files.get(filePath) ?? null;
    }
  },
}));

import {
  fetchImageBytes,
  checkImageResolvable,
  publicObjectPath,
  ImageRetrievalError,
  makePinnedLookup,
} from "../social-publishers/image-retrieval";

const makeFile = (bytes: Buffer, contentType = "image/png") => ({
  getMetadata: async () => [{ contentType }],
  download: async () => [bytes],
});

const NO_RETRY = { retryDelaysMs: [] as number[] };
const FAST_RETRY = { retryDelaysMs: [1, 1] };

beforeEach(() => {
  storageState.files.clear();
  storageState.searchCalls.length = 0;
  storageState.throwTimes = 0;
  storageState.throwErr = null;
  vi.restoreAllMocks();
});

describe("publicObjectPath", () => {
  it("extracts the path from relative and absolute /public-objects/ URLs", () => {
    expect(publicObjectPath("/public-objects/social/img.png")).toBe("social/img.png");
    expect(publicObjectPath("https://app.example.com/public-objects/social/img.png")).toBe("social/img.png");
  });
  it("returns null for external URLs and traversal attempts", () => {
    expect(publicObjectPath("https://cdn.example.com/img.png")).toBeNull();
    expect(publicObjectPath("/public-objects/../secret")).toBeNull();
  });
});

describe("fetchImageBytes — storage-direct path", () => {
  it("reads own-storage images in-process without any HTTP fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    storageState.files.set("social/img.png", makeFile(Buffer.from("png-bytes")));
    const res = await fetchImageBytes("/public-objects/social/img.png", NO_RETRY);
    expect(res.buffer.toString()).toBe("png-bytes");
    expect(res.contentType).toBe("image/png");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("handles absolute URLs pointing at the app's own route", async () => {
    storageState.files.set("social/img.png", makeFile(Buffer.from("x")));
    const res = await fetchImageBytes("https://orbit.example.com/public-objects/social/img.png", NO_RETRY);
    expect(res.buffer.toString()).toBe("x");
  });

  it("throws image_not_found immediately for missing objects (no retries)", async () => {
    await expect(fetchImageBytes("/public-objects/gone.png", FAST_RETRY))
      .rejects.toMatchObject({ code: "image_not_found", transient: false });
    expect(storageState.searchCalls.length).toBe(1);
  });

  it("retries transient storage errors and succeeds in place", async () => {
    storageState.throwTimes = 2;
    storageState.files.set("social/img.png", makeFile(Buffer.from("ok")));
    const res = await fetchImageBytes("/public-objects/social/img.png", FAST_RETRY);
    expect(res.buffer.toString()).toBe("ok");
    expect(storageState.searchCalls.length).toBe(3);
  });

  it("throws image_fetch_failed (transient) after exhausting retries", async () => {
    storageState.throwTimes = 99;
    await expect(fetchImageBytes("/public-objects/social/img.png", FAST_RETRY))
      .rejects.toMatchObject({ code: "image_fetch_failed", transient: true });
    expect(storageState.searchCalls.length).toBe(3); // 1 + 2 retries
  });
});

describe("fetchImageBytes — external URLs", () => {
  const mockFetchSequence = (responses: Array<Response | Error>) => {
    let i = 0;
    return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const r = responses[Math.min(i++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    });
  };

  it("fetches external URLs over HTTP", async () => {
    mockFetchSequence([new Response(Buffer.from("ext"), { status: 200, headers: { "content-type": "image/jpeg" } })]);
    const res = await fetchImageBytes("https://cdn.example.com/a.jpg", NO_RETRY);
    expect(res.buffer.toString()).toBe("ext");
    expect(res.contentType).toBe("image/jpeg");
  });

  it("throws image_not_found on 404 without retrying", async () => {
    const spy = mockFetchSequence([new Response("", { status: 404 })]);
    await expect(fetchImageBytes("https://cdn.example.com/a.jpg", FAST_RETRY))
      .rejects.toMatchObject({ code: "image_not_found" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("throws image_forbidden on 403 without retrying", async () => {
    const spy = mockFetchSequence([new Response("", { status: 403 })]);
    await expect(fetchImageBytes("https://cdn.example.com/a.jpg", FAST_RETRY))
      .rejects.toMatchObject({ code: "image_forbidden" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx and network errors, then succeeds", async () => {
    const spy = mockFetchSequence([
      new Response("", { status: 503 }),
      new TypeError("fetch failed"),
      new Response(Buffer.from("ok"), { status: 200 }),
    ]);
    const res = await fetchImageBytes("https://cdn.example.com/a.jpg", FAST_RETRY);
    expect(res.buffer.toString()).toBe("ok");
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("throws transient image_fetch_failed after exhausting retries", async () => {
    const spy = mockFetchSequence([new Response("", { status: 500 })]);
    await expect(fetchImageBytes("https://cdn.example.com/a.jpg", FAST_RETRY))
      .rejects.toMatchObject({ code: "image_fetch_failed", transient: true });
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

describe("fetchImageBytes — size caps", () => {
  it("rejects an external response with an oversized declared Content-Length before reading", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new ReadableStream(), {
        status: 200,
        headers: { "content-length": String(21 * 1024 * 1024) },
      }),
    );
    await expect(fetchImageBytes("https://cdn.example.com/huge.jpg", NO_RETRY))
      .rejects.toMatchObject({ code: "image_fetch_failed", transient: false });
  });

  it("aborts an unbounded chunked external response once the byte cap is hit", async () => {
    let pulls = 0;
    const chunk = new Uint8Array(1024 * 1024); // 1 MB per pull, no content-length
    const endless = new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk);
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(endless, { status: 200 }));
    await expect(fetchImageBytes("https://cdn.example.com/endless.jpg", NO_RETRY))
      .rejects.toMatchObject({ code: "image_fetch_failed", transient: false });
    expect(pulls).toBeLessThan(30); // stopped at the ~20 MB cap, not unbounded
  });

  it("rejects oversized storage objects from metadata without downloading", async () => {
    const file = {
      getMetadata: async () => [{ contentType: "image/png", size: 25 * 1024 * 1024 }],
      download: vi.fn(async () => [Buffer.from("x")]),
    };
    storageState.files.set("huge.png", file);
    await expect(fetchImageBytes("/public-objects/huge.png", NO_RETRY))
      .rejects.toMatchObject({ code: "image_fetch_failed", transient: false });
    expect(file.download).not.toHaveBeenCalled();
  });
});

describe("fetchImageBytes — SSRF guard", () => {
  it.each([
    "http://127.0.0.1:5000/img.png",
    "http://10.0.0.8/img.png",
    "http://169.254.169.254/latest/meta-data",
    "http://192.168.1.10/a.png",
    "http://[::1]/a.png",
    // IPv4-mapped IPv6 in dotted and WHATWG-normalized hex forms — a
    // regression class where loopback/metadata hid behind ::ffff:0:0/96.
    "http://[::ffff:127.0.0.1]/a.png",
    "http://[::ffff:7f00:1]/a.png",
    "http://[::ffff:169.254.169.254]/latest/meta-data",
    "http://[::ffff:a9fe:a9fe]/latest/meta-data",
    "http://[::ffff:a00:5]/a.png", // ::ffff:10.0.0.5
    "http://[64:ff9b::a9fe:a9fe]/a.png", // NAT64-embedded metadata IP
    "http://localhost:8080/a.png",
  ])("rejects private/internal destination %s without fetching", async (url) => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(fetchImageBytes(url, NO_RETRY)).rejects.toMatchObject({ code: "image_forbidden" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects hostnames that resolve to private addresses", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(fetchImageBytes("http://internal.test/a.png", NO_RETRY))
      .rejects.toMatchObject({ code: "image_forbidden" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects non-http(s) protocols", async () => {
    await expect(fetchImageBytes("file:///etc/passwd", NO_RETRY))
      .rejects.toMatchObject({ code: "image_forbidden" });
  });

  it("rejects redirects that target private addresses", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 302, headers: { location: "http://169.254.169.254/creds" } }),
    );
    await expect(fetchImageBytes("https://cdn.example.com/a.jpg", NO_RETRY))
      .rejects.toMatchObject({ code: "image_forbidden" });
    expect(spy).toHaveBeenCalledTimes(1); // only the first (public) hop was fetched
  });

  it("pins the connection to the validated address (DNS-rebinding defense)", async () => {
    // Every external fetch must carry a dispatcher whose DNS lookup is
    // pinned, so a second resolution at connect time can't swap targets.
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Buffer.from("ok"), { status: 200 }),
    );
    await fetchImageBytes("https://cdn.example.com/a.jpg", NO_RETRY);
    const init = spy.mock.calls[0][1] as any;
    expect(init.dispatcher).toBeDefined();
  });

  it("makePinnedLookup always answers with the validated address, never re-resolving", () => {
    const lookup = makePinnedLookup("93.184.216.34", 4);
    // Callback style used by undici's connector ({ all: false } path):
    lookup("evil-rebinder.example.com", { family: 0 }, (err: any, address: any, family: any) => {
      expect(err).toBeNull();
      expect(address).toBe("93.184.216.34");
      expect(family).toBe(4);
    });
    // { all: true } path:
    lookup("evil-rebinder.example.com", { all: true }, (err: any, addrs: any) => {
      expect(err).toBeNull();
      expect(addrs).toEqual([{ address: "93.184.216.34", family: 4 }]);
    });
  });

  it("follows redirects between public hosts", async () => {
    let n = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      n += 1;
      if (n === 1) return new Response("", { status: 301, headers: { location: "https://cdn2.example.com/b.jpg" } });
      return new Response(Buffer.from("moved"), { status: 200, headers: { "content-type": "image/png" } });
    });
    const res = await fetchImageBytes("https://cdn.example.com/a.jpg", NO_RETRY);
    expect(res.buffer.toString()).toBe("moved");
  });
});

describe("checkImageResolvable (preflight)", () => {
  it("passes for existing own-storage images without downloading bytes", async () => {
    const file = makeFile(Buffer.from("x"));
    const dl = vi.spyOn(file, "download");
    storageState.files.set("a.png", file);
    expect(await checkImageResolvable("/public-objects/a.png")).toEqual({ ok: true });
    expect(dl).not.toHaveBeenCalled();
  });

  it("flags missing own-storage images as permanent image_not_found", async () => {
    const res = await checkImageResolvable("/public-objects/gone.png");
    expect(res.ok).toBe(false);
    expect(res.code).toBe("image_not_found");
    expect(res.transient).toBeFalsy();
  });

  it("reports storage hiccups as transient so the sweep skips flagging", async () => {
    storageState.throwTimes = 99;
    const res = await checkImageResolvable("/public-objects/a.png");
    expect(res.ok).toBe(false);
    expect(res.transient).toBe(true);
  });

  it("treats SharePoint URLs as ok (Graph branch handles them at publish)", async () => {
    const res = await checkImageResolvable("https://x.sharepoint.com/contentstorage/y/img.png");
    expect(res).toEqual({ ok: true });
  });

  it("flags external 404s as permanent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    const res = await checkImageResolvable("https://cdn.example.com/a.jpg", { retryDelaysMs: [] });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("image_not_found");
  });
});
