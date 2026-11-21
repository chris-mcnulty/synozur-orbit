// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, act } from "@testing-library/react";
import { usePersonalViews } from "./use-personal-views";
import { setTabTenantId, setTabMarketId, clearTabContext } from "@/lib/tabContext";
import { marketingCampaignViewSchema, marketingCampaignViewDefaults } from "@/lib/personal-view-schemas";

vi.mock("@/lib/userContext", () => ({ useUser: () => ({ user: { id: "u" } }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock("wouter", () => ({ useSearch: () => "" }));
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setTabTenantId("t1"); setTabMarketId("m1"); });
afterEach(cleanup);
describe("same-tab context notifications", () => {
  it("switches preferences immediately without waiting for a context refetch or parent render", () => {
    const { result } = renderHook(() => usePersonalViews({ surface: "campaigns", schema: marketingCampaignViewSchema, defaults: marketingCampaignViewDefaults }));
    act(() => result.current.field("campaignSearch")[1]("Only tenant one"));
    act(() => { setTabTenantId("t2"); setTabMarketId("m2"); });
    expect(result.current.state.campaignSearch).toBe("");
    act(() => result.current.field("campaignSearch")[1]("Only tenant two"));
    act(() => { setTabTenantId("t1"); setTabMarketId("m1"); });
    expect(result.current.state.campaignSearch).toBe("Only tenant one");
    act(() => clearTabContext());
    expect(result.current.state.campaignSearch).toBe("");
    expect(result.current.enabled).toBe(false);
  });
});
