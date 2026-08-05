import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  allocateCredit,
  aggregateByCampaign,
  deriveChannel,
  isConversionEvent,
  type Touchpoint,
  type AttributionModel,
} from "../attribution-service";

// Helper to build a minimal touchpoint
function tp(id: string, campaignId: string | null = null, campaignName: string | null = null): Touchpoint {
  return {
    id,
    occurredAt: new Date(`2026-01-0${id}T12:00:00Z`),
    eventType: "link_click",
    channel: "Email",
    campaignId,
    campaignName,
  };
}

function credits(result: ReturnType<typeof allocateCredit>): number[] {
  return result.map((r) => parseFloat(r.credit.toFixed(4)));
}

// ─── allocateCredit ────────────────────────────────────────────────────────

describe("allocateCredit — empty input", () => {
  it("returns empty array", () => {
    assert.deepEqual(allocateCredit([], "linear"), []);
  });
});

describe("allocateCredit — single touchpoint", () => {
  const models: AttributionModel[] = ["first-touch", "last-touch", "linear", "position-based"];
  for (const model of models) {
    it(`${model}: single touchpoint gets 100% credit`, () => {
      const result = allocateCredit([tp("1", "c1")], model);
      assert.equal(result.length, 1);
      assert.equal(result[0].credit, 1);
      assert.equal(result[0].creditPct, "100.0%");
    });
  }
});

describe("allocateCredit — two touchpoints", () => {
  it("first-touch: first gets 100%", () => {
    const result = allocateCredit([tp("1"), tp("2")], "first-touch");
    assert.deepEqual(credits(result), [1, 0]);
  });

  it("last-touch: last gets 100%", () => {
    const result = allocateCredit([tp("1"), tp("2")], "last-touch");
    assert.deepEqual(credits(result), [0, 1]);
  });

  it("linear: equal split 50/50", () => {
    const result = allocateCredit([tp("1"), tp("2")], "linear");
    assert.deepEqual(credits(result), [0.5, 0.5]);
  });

  it("position-based: two touchpoints split 50/50", () => {
    // n=2 special case: 50/50
    const result = allocateCredit([tp("1"), tp("2")], "position-based");
    assert.deepEqual(credits(result), [0.5, 0.5]);
  });
});

describe("allocateCredit — three touchpoints", () => {
  it("first-touch: only first gets credit", () => {
    const result = allocateCredit([tp("1"), tp("2"), tp("3")], "first-touch");
    assert.deepEqual(credits(result), [1, 0, 0]);
  });

  it("last-touch: only last gets credit", () => {
    const result = allocateCredit([tp("1"), tp("2"), tp("3")], "last-touch");
    assert.deepEqual(credits(result), [0, 0, 1]);
  });

  it("linear: equal thirds", () => {
    const result = allocateCredit([tp("1"), tp("2"), tp("3")], "linear");
    const sum = result.reduce((s, r) => s + r.credit, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, "credits must sum to 1");
    for (const r of result) {
      assert.ok(Math.abs(r.credit - 1 / 3) < 1e-9);
    }
  });

  it("position-based: 40/20/40", () => {
    const result = allocateCredit([tp("1"), tp("2"), tp("3")], "position-based");
    assert.ok(Math.abs(result[0].credit - 0.4) < 1e-9, "first should be 0.4");
    assert.ok(Math.abs(result[1].credit - 0.2) < 1e-9, "middle should be 0.2");
    assert.ok(Math.abs(result[2].credit - 0.4) < 1e-9, "last should be 0.4");
  });
});

describe("allocateCredit — five touchpoints (position-based)", () => {
  it("40% first + 40% last + 20% split 3 ways across middle", () => {
    const result = allocateCredit(
      [tp("1"), tp("2"), tp("3"), tp("4"), tp("5")],
      "position-based",
    );
    assert.ok(Math.abs(result[0].credit - 0.4) < 1e-9, "first = 0.4");
    assert.ok(Math.abs(result[4].credit - 0.4) < 1e-9, "last = 0.4");
    const middleShare = 0.2 / 3;
    for (const r of result.slice(1, 4)) {
      assert.ok(Math.abs(r.credit - middleShare) < 1e-9, `middle = ${middleShare}`);
    }
    const sum = result.reduce((s, r) => s + r.credit, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, "sum must be 1");
  });
});

// ─── aggregateByCampaign ───────────────────────────────────────────────────

describe("aggregateByCampaign", () => {
  it("sums credit per campaignId", () => {
    const tps = [
      tp("1", "camp-a", "Campaign A"),
      tp("2", "camp-b", "Campaign B"),
      tp("3", "camp-a", "Campaign A"),
    ];
    const credited = allocateCredit(tps, "linear"); // 1/3 each
    const agg = aggregateByCampaign(credited);
    const a = agg.find((x) => x.campaignId === "camp-a")!;
    const b = agg.find((x) => x.campaignId === "camp-b")!;
    assert.ok(Math.abs(a.credit - 2 / 3) < 1e-9, "camp-a gets 2/3");
    assert.ok(Math.abs(b.credit - 1 / 3) < 1e-9, "camp-b gets 1/3");
    assert.equal(a.touchpoints, 2);
    assert.equal(b.touchpoints, 1);
  });

  it("null campaignId buckets as a single unknown group", () => {
    const tps = [tp("1", null), tp("2", null), tp("3", "camp-a", "A")];
    const credited = allocateCredit(tps, "linear");
    const agg = aggregateByCampaign(credited);
    const none = agg.find((x) => x.campaignId === null)!;
    assert.equal(none.touchpoints, 2);
    assert.ok(Math.abs(none.credit - 2 / 3) < 1e-9);
  });

  it("sorts descending by credit", () => {
    const tps = [tp("1", "low"), tp("2", "high"), tp("3", "high")];
    const credited = allocateCredit(tps, "linear");
    const agg = aggregateByCampaign(credited);
    assert.equal(agg[0].campaignId, "high");
    assert.equal(agg[1].campaignId, "low");
  });
});

// ─── multiple conversions per contact (scenario test) ─────────────────────

describe("multi-conversion scenario", () => {
  it("each conversion window independently distributes 1 unit of credit", () => {
    // Simulates two conversions: first after tps 1+2, second after tps 1+2+3+4
    const conv1Touchpoints = [tp("1", "camp-a"), tp("2", "camp-b")];
    const conv2Touchpoints = [tp("1", "camp-a"), tp("2", "camp-b"), tp("3", "camp-a"), tp("4", "camp-b")];

    const c1 = allocateCredit(conv1Touchpoints, "linear");
    const c2 = allocateCredit(conv2Touchpoints, "linear");

    const sum1 = c1.reduce((s, r) => s + r.credit, 0);
    const sum2 = c2.reduce((s, r) => s + r.credit, 0);
    assert.ok(Math.abs(sum1 - 1) < 1e-9, "conv1 sums to 1");
    assert.ok(Math.abs(sum2 - 1) < 1e-9, "conv2 sums to 1");
  });
});

// ─── deriveChannel ─────────────────────────────────────────────────────────

describe("deriveChannel", () => {
  it("maps email event types to Email", () => {
    assert.equal(deriveChannel("email_sent", null), "Email");
    assert.equal(deriveChannel("email_open", null), "Email");
    assert.equal(deriveChannel("email_click", null), "Email");
  });

  it("maps social_engage to Social", () => {
    assert.equal(deriveChannel("social_engage", null), "Social");
  });

  it("maps form_submit to Web (Form)", () => {
    assert.equal(deriveChannel("form_submit", null), "Web (Form)");
  });

  it("maps page_view to Web", () => {
    assert.equal(deriveChannel("page_view", null), "Web");
  });

  it("classifies link_click by source", () => {
    assert.equal(deriveChannel("link_click", "linkedin"), "LinkedIn");
    assert.equal(deriveChannel("link_click", "twitter.com"), "X / Twitter");
    assert.equal(deriveChannel("link_click", "email-campaign"), "Email");
    assert.equal(deriveChannel("link_click", "unknown-source"), "Link");
    assert.equal(deriveChannel("link_click", null), "Link");
  });
});

// ─── isConversionEvent ─────────────────────────────────────────────────────

describe("isConversionEvent", () => {
  it("recognises form_submit as the sole conversion event type", () => {
    assert.equal(isConversionEvent("form_submit", null), true);
    assert.equal(isConversionEvent("form_submit", {}), true);
    assert.equal(isConversionEvent("form_submit", { page: "/contact" }), true);
  });

  it("does not treat lifecycle_change as a conversion (event never emitted in contact timeline)", () => {
    // The contact system advances lifecycleStage on the contacts row but does
    // NOT append a lifecycle_change event to marketing_contact_events, so this
    // event type is never present in the timeline.
    assert.equal(isConversionEvent("lifecycle_change", { stage: "mql" }), false);
    assert.equal(isConversionEvent("lifecycle_change", { stage: "sql" }), false);
    assert.equal(isConversionEvent("lifecycle_change", null), false);
  });

  it("does not mark regular engagement events as conversions", () => {
    assert.equal(isConversionEvent("link_click", null), false);
    assert.equal(isConversionEvent("email_click", null), false);
    assert.equal(isConversionEvent("email_open", null), false);
    assert.equal(isConversionEvent("page_view", null), false);
    assert.equal(isConversionEvent("social_engage", null), false);
  });
});
