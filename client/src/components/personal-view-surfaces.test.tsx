// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MarketingCampaigns from "@/pages/app/marketing/campaigns";
import OutreachCampaigns from "@/pages/app/sales/outreach-campaigns";
import ProspectDirectory from "@/pages/app/sales/campaign-detail";
import MarketingCalendar from "@/pages/app/marketing/marketing-calendar";
import { setTabTenantId, setTabMarketId } from "@/lib/tabContext";
import { emptyViews, viewStorageKey } from "@/lib/personal-views";
import { marketingCampaignViewDefaults, prospectViewDefaults, calendarViewDefaults } from "@/lib/personal-view-schemas";

vi.mock("@/components/layout/AppLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/lib/userContext", () => ({ useUser: () => ({ user: { id: "u", role: "Domain Admin", name: "Editor" } }) }));
vi.mock("@/hooks/useFeatureFlag", () => ({ useFeatureFlag: () => true }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("wouter", () => ({
  useSearch: () => "",
  useLocation: () => ["/", vi.fn()],
  useParams: () => ({ id: "campaign-one" }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
const campaign = { id: "campaign-one", name: "Launch", status: "active", goalType: "meeting", createdBy: "u", channels: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" };
const person = { id: "person", name: "Maya", title: "Director", companyName: "Acme", email: "maya@example.test", status: "new", source: "manual", icpScore: 90 };
const requests: string[] = [];
function seed(surface: string, state: unknown, campaignId?: string) {
  const key = viewStorageKey({ userId: "u", tenantId: "t", marketId: "m", surface, campaignId });
  localStorage.setItem(key, JSON.stringify(emptyViews(state)));
}
function setup(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: {
    retry: false,
    queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json(),
  } } });
  const mount = render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return { ...mount, client };
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); requests.length = 0;
  setTabTenantId("t"); setTabMarketId("m");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(`${init?.method ?? "GET"} ${url}`);
    let data: unknown = [];
    if (url === "/api/context") data = { activeTenantId: "t", activeMarketId: "m" };
    else if (url === "/api/sales-outreach/discovery/status") data = { backends: [] };
    else if (url.endsWith("/performance")) data = { total: 1, contacted: 0, replied: 0, replyRate: 0, funnel: { new: 1 }, signals: [], recommendations: [] };
    else if (url === "/api/marketing-calendar/filters") data = { campaigns: [{ id: "campaign-one", name: "Launch" }], solutionAreas: [], conferences: [], socialChannels: [], contentFormats: [] };
    else if (url === "/api/sales-outreach/campaigns/campaign-one/prospects") data = [person];
    else if (url === "/api/sales-outreach/campaigns/campaign-one") data = campaign;
    else if (url === "/api/sales-outreach/campaigns") data = [campaign];
    else if (url.startsWith("/api/campaigns?")) data = { items: [campaign], total: 1, page: 1, pageSize: 24, hasMore: false };
    else if (url.includes("readiness")) data = null;
    return Response.json(data);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("saved views on the actual supported pages", () => {
  it("restores marketing campaign list filters without opening its create wizard", async () => {
    seed("marketing-campaigns", { ...marketingCampaignViewDefaults, campaignSearch: "Launch", statusFilter: "active" });
    const { client } = setup(<MarketingCampaigns />);
    expect((screen.getByTestId("input-search-campaigns") as HTMLInputElement).value).toBe("Launch");
    await screen.findByTestId("card-campaign-campaign-one");
    expect(requests.some(url => url.includes("q=Launch") && url.includes("status=active"))).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("personal-view-controls")).toBeTruthy();
    client.clear();
  });
  it("shows personal controls on the outreach list without executing campaign actions", async () => {
    const { client } = setup(<OutreachCampaigns />);
    await screen.findByTestId("campaign-campaign-one");
    expect(screen.getByTestId("personal-view-controls")).toBeTruthy();
    expect(requests.every(url => url.startsWith("GET "))).toBe(true);
    client.clear();
  });
  it("restores the prospect directory search and sort while keeping direct row Edit and workspace tabs", async () => {
    seed("outreach-prospects", { ...prospectViewDefaults, searchQ: "Maya", sortKey: "name", sortDir: "asc", messagingGroupFilter: "unassigned" }, "campaign-one");
    const { client } = setup(<ProspectDirectory />);
    await screen.findByTestId("input-prospect-search");
    expect((screen.getByTestId("input-prospect-search") as HTMLInputElement).value).toBe("Maya");
    expect((screen.getByTestId("select-messaging-group-filter") as HTMLSelectElement).value).toBe("unassigned");
    expect(screen.getByTestId("edit-prospect-person").textContent).toContain("Edit");
    for (const name of ["Overview", "Prospects", "Meetings", "Setup", "Next Steps"]) expect(screen.getByRole("tab", { name })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(requests.every(url => url.startsWith("GET "))).toBe(true);
    client.clear();
  });
  it("restores the calendar backlog mode, prunes a deleted campaign and never schedules or exports", async () => {
    seed("marketing-calendar", { ...calendarViewDefaults, view: "backlog", filters: { ...calendarViewDefaults.filters, campaignId: "deleted" }, backlogFilters: { ...calendarViewDefaults.backlogFilters, status: "approved" } });
    const { client } = setup(<MarketingCalendar />);
    await waitFor(() => expect(screen.getByText("Unavailable or invalid saved filters were reset.")).toBeTruthy());
    expect(screen.getByTestId("select-backlog-status").textContent).toContain("Approved");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(requests.every(url => url.startsWith("GET "))).toBe(true);
    client.clear();
  });
});
