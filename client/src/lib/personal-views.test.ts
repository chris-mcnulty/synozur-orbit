import { describe, expect, it } from "vitest";
import { changeViews, emptyViews, readViews, validateDocument, viewStorageKey, MAX_VIEWS } from "./personal-views";
import {
  prospectViewDefaults, prospectViewSchema, calendarViewDefaults, calendarViewSchema,
  marketingCampaignViewDefaults, marketingCampaignViewSchema, outreachCampaignViewSchema, urlViewState,
} from "./personal-view-schemas";

describe("personal saved view store", () => {
  it("supports create, apply, update, rename, delete and reset without mutating saved snapshots", () => {
    const defaults = marketingCampaignViewDefaults;
    let doc = emptyViews(defaults);
    doc = changeViews(doc, { type: "change", state: { campaignSearch: "launch", statusFilter: "active" } }, defaults);
    doc = changeViews(doc, { type: "create", id: "one", name: " Launch " }, defaults);
    doc = changeViews(doc, { type: "change", state: defaults }, defaults);
    expect(doc.views[0].state.campaignSearch).toBe("launch");
    doc = changeViews(doc, { type: "apply", id: "one" }, defaults);
    expect(doc.last.statusFilter).toBe("active");
    doc = changeViews(doc, { type: "change", state: { ...doc.last, campaignSearch: "updated" } }, defaults);
    doc = changeViews(doc, { type: "update", id: "one" }, defaults);
    doc = changeViews(doc, { type: "rename", id: "one", name: "Renamed" }, defaults);
    expect(doc.views[0]).toMatchObject({ name: "Renamed", state: { campaignSearch: "updated" } });
    doc = changeViews(doc, { type: "reset" }, defaults);
    expect(doc.last).toEqual(defaults);
    expect(doc.activeId).toBeNull();
    expect(doc.views).toHaveLength(1);
    doc = changeViews(doc, { type: "delete", id: "one" }, defaults);
    expect(doc.views).toEqual([]);
  });
  it("enforces unique names, count and size limits", () => {
    let doc = emptyViews(marketingCampaignViewDefaults);
    expect(() => changeViews(doc, { type: "create", id: "x", name: " " }, doc.last)).toThrow();
    for (let i = 0; i < MAX_VIEWS; i++) doc = changeViews(doc, { type: "create", id: `${i}`, name: `View ${i}` }, doc.last);
    expect(() => changeViews(doc, { type: "create", id: "extra", name: "Extra" }, doc.last)).toThrow("20");
    expect(() => changeViews(doc, { type: "rename", id: "0", name: "view 1" }, doc.last)).toThrow();
    const read = readViews({ getItem: () => "a".repeat(64001) }, "key", marketingCampaignViewSchema, doc.last);
    expect(read.notice).toBeTruthy();
    expect(read.doc.views).toEqual([]);
  });
  it("isolates all six context dimensions with unambiguous keys", () => {
    const c = { userId: "u", tenantId: "t", marketId: "m", surface: "prospects", campaignId: "c" };
    const keys = [viewStorageKey(c), ...Object.keys(c).map(k => viewStorageKey({ ...c, [k]: "other" }))];
    expect(new Set(keys).size).toBe(6);
    expect(viewStorageKey({ ...c, userId: "a:b", tenantId: "c" })).not.toBe(viewStorageKey({ ...c, userId: "a", tenantId: "b:c" }));
  });
  it.each(["{bad", JSON.stringify({ version: 99 }), JSON.stringify({ version: 1, views: null })])("handles invalid storage visibly: %s", raw => {
    const read = readViews({ getItem: () => raw }, "k", marketingCampaignViewSchema, marketingCampaignViewDefaults);
    expect(read.doc.last).toEqual(marketingCampaignViewDefaults);
    expect(read.notice).toBeTruthy();
  });
  it("handles storage denial without breaking the page", () => {
    expect(readViews({ getItem() { throw new Error("denied"); } }, "k", marketingCampaignViewSchema, marketingCampaignViewDefaults).notice).toBeTruthy();
  });
  it("prunes stale prospect sources and classification options, but retains valid sorting and search", () => {
    const schema = prospectViewSchema([{ id: "p", source: "manual", classification: { tags: ["vip"], eventRoles: ["speaker"], sourceDetail: "" } }]);
    const input = { ...prospectViewDefaults, sourceFilter: "removed", sortKey: "name", searchQ: "Acme",
      classification: { ...prospectViewDefaults.classification, tag: "deleted", eventRole: "speaker", attendance: "obsolete" } };
    const doc = validateDocument({ ...emptyViews(input), views: [{ id: "v", name: "Old", state: input }] }, schema, prospectViewDefaults);
    expect(doc.last).toMatchObject({ sourceFilter: "all", sortKey: "name", searchQ: "Acme", classification: { tag: "all", eventRole: "speaker", attendance: "all" } });
    expect(doc.views[0].state).toEqual(doc.last);
    expect(prospectViewSchema().parse(input).sourceFilter).toBe("removed"); // wait for fetched options
  });
  it("prunes deleted calendar campaigns and channels in both calendar and backlog", () => {
    const state = { ...calendarViewDefaults, view: "backlog", grouping: "quarter", typeFilter: "social:removed",
      filters: { ...calendarViewDefaults.filters, campaignId: "gone", solutionAreaId: "theme" },
      backlogFilters: { ...calendarViewDefaults.backlogFilters, conferenceId: "gone", status: "approved" } };
    const schema = calendarViewSchema({ campaigns: [], solutionAreas: [{ id: "theme" }], conferences: [] });
    expect(schema.parse(state)).toMatchObject({ view: "backlog", grouping: "quarter", typeFilter: "all",
      filters: { campaignId: "all", solutionAreaId: "theme" }, backlogFilters: { conferenceId: "all", status: "approved" } });
    expect(schema.parse({ ...state, view: "outdated", grouping: "week" })).toMatchObject({ view: "calendar", grouping: "month" });
  });
  it("round-trips the three surface families and strips actions, selections, dates and editor contents", () => {
    for (const [schema, defaults] of [
      [marketingCampaignViewSchema, marketingCampaignViewDefaults], [outreachCampaignViewSchema, {}],
      [prospectViewSchema(), prospectViewDefaults], [calendarViewSchema(), calendarViewDefaults],
    ] as const) {
      const input = { ...defaults, selected: ["contact"], draftBody: "private draft", addOpen: true, anchor: "2020-01-01", export: true, token: "never-store" };
      const parsed = schema.parse(input);
      expect(parsed).toEqual(defaults);
    }
  });
  it("gives explicit filters and item links precedence without persisting deep-link/action parameters", () => {
    expect(urlViewState(marketingCampaignViewDefaults, "?q=URL&status=active&preselect=asset")).toEqual({ campaignSearch: "URL", statusFilter: "active" });
    expect(urlViewState(prospectViewDefaults, "?prospect=p&draft=d&searchQ=URL")).toEqual({ ...prospectViewDefaults, searchQ: "URL" });
    const override = urlViewState(calendarViewDefaults, "?post=p&date=2026-01-01&campaignId=valid&typeFilter=social:linkedin");
    expect(override).toEqual({ ...calendarViewDefaults, filters: { ...calendarViewDefaults.filters, campaignId: "valid" }, typeFilter: "social:linkedin" });
    expect(JSON.stringify(override)).not.toContain("2026-01-01");
  });
});
