import { describe, it, expect } from "vitest";
import { lookupNaicsCrosswalk } from "../naics-crosswalk";
import { buildCbpQueryUrl, EMPSZES_ALL } from "../census-market-data-provider";

describe("naics crosswalk (pure fast-path)", () => {
  it("maps SaaS/software to Software Publishers with high confidence", () => {
    const hits = lookupNaicsCrosswalk("B2B SaaS software for marketers");
    const codes = hits.map((h) => h.code);
    expect(codes).toContain("511210");
    expect(hits.every((h) => h.source === "crosswalk")).toBe(true);
    expect(hits.find((h) => h.code === "511210")!.confidence).toBeGreaterThanOrEqual(0.65);
  });

  it("maps a sector-range industry (manufacturing) to its NAICS range", () => {
    const hits = lookupNaicsCrosswalk("industrial manufacturing companies");
    expect(hits.map((h) => h.code)).toContain("31-33");
  });

  it("matches on token boundaries: 'hospital' hits, 'hospitality' does not", () => {
    expect(lookupNaicsCrosswalk("regional hospital network").map((h) => h.code)).toContain("622");
    expect(lookupNaicsCrosswalk("hospitality and travel").map((h) => h.code)).not.toContain("622");
  });

  it("returns [] for empty or unknown input", () => {
    expect(lookupNaicsCrosswalk("")).toEqual([]);
    expect(lookupNaicsCrosswalk("   ")).toEqual([]);
    expect(lookupNaicsCrosswalk("qwertyuiop nonsense")).toEqual([]);
  });

  it("dedupes when multiple keywords point at the same code", () => {
    const hits = lookupNaicsCrosswalk("software and cloud software");
    const softwarePublishers = hits.filter((h) => h.code === "511210");
    expect(softwarePublishers).toHaveLength(1);
  });
});

describe("buildCbpQueryUrl (pure)", () => {
  it("builds a national query with the standard variables and NAICS predicate", () => {
    const url = buildCbpQueryUrl({ naicsCode: "5415", apiKey: "TESTKEY" });
    expect(url).toContain("/data/2023/cbp?");
    expect(url).toContain("NAICS2017=5415");
    expect(url).toContain("for=us");        // us:* (URL-encoded)
    expect(url).toContain("get=NAICS2017");
    expect(url).toContain("ESTAB");
    expect(url).toContain("key=TESTKEY");
  });

  it("honors an explicit year, geography, and employment size class", () => {
    const url = buildCbpQueryUrl({
      naicsCode: "62",
      geographyFor: "state:06",
      empSizeClass: EMPSZES_ALL,
      year: 2021,
      apiKey: "K",
    });
    expect(url).toContain("/data/2021/cbp?");
    expect(url).toContain("EMPSZES=001");
    expect(url).toContain("state%3A06"); // colon URL-encoded
  });

  it("omits the key parameter when apiKey is empty", () => {
    const url = buildCbpQueryUrl({ naicsCode: "52", apiKey: "" });
    expect(url).not.toContain("key=");
  });
});
