// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({ rows: [] as any[], cancelled: [] as string[][], toast: vi.fn() }));
vi.mock("@/components/layout/AppLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/marketing/CalendarViewSwitcher", () => ({ CalendarViewSwitcher: () => null }));
vi.mock("@/components/marketing/SocialPostEditor", () => ({ default: () => <div data-testid="opened-editor" /> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/tabContext", () => ({ getTabMarketId: () => "market", getTabTenantId: () => "tenant" }));
// Use native option selection in this behavioral test; the production Radix
// controls and dialog primitives are unchanged.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => <select aria-label="Filter by campaign" value={value} onChange={e => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));
import QueuePage from "../queue";

const base = {
  platform: "linkedin", status: "approved", publishedAt: null,
  scheduledDate: new Date(Date.now() + 86400000).toISOString(),
  deliveryMode: null, publishError: null, accountName: "Example account",
  publishClaimToken: null, leadImageUrl: "/public-objects/source.png",
};
beforeEach(() => {
  state.cancelled = [];
  state.toast.mockClear();
  state.rows = [
    { ...base, id: "one", preview: "Polaris post", campaignId: "polaris", campaignName: "Polaris 065" },
    { ...base, id: "two", preview: "Other campaign post", campaignId: "other", campaignName: "Other campaign" },
    { ...base, id: "claimed", preview: "Sending now", campaignId: "polaris", campaignName: "Polaris 065", publishClaimToken: "claim" },
    { ...base, id: "solo", preview: "Standalone copy", campaignId: null, campaignName: null, leadImageUrl: null },
  ];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/generated-posts/bulk-cancel") {
      const ids = JSON.parse(init!.body as string).postIds as string[];
      state.cancelled.push(ids);
      state.rows = state.rows.filter(p => !ids.includes(p.id));
      return { ok: true, json: async () => ({ cancelled: ids.length, cancelledIds: ids, skipped: 0, skippedIds: [] }) };
    }
    return { ok: true, json: async () => input.startsWith("/api/generated-posts/calendar") ? state.rows : [] };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><QueuePage /></QueryClientProvider>);
}

describe("Posting Queue controls", () => {
  it("shows campaign links and source images, and filters campaigns and standalone posts", async () => {
    mount();
    await screen.findByTestId("queue-row-one");
    expect(screen.getByTestId("queue-campaign-link-one").getAttribute("href")).toBe("/app/marketing/campaigns/polaris");
    expect(screen.getByTestId("queue-row-one").querySelector("img")?.getAttribute("src")).toBe("/public-objects/source.png");
    fireEvent.change(screen.getByLabelText("Filter by campaign"), { target: { value: "polaris" } });
    expect(screen.queryByTestId("queue-row-two")).toBeNull();
    expect(screen.getByTestId("queue-row-one")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter by campaign"), { target: { value: "standalone" } });
    expect(screen.getByTestId("queue-row-solo")).toBeTruthy();
    expect(screen.queryByTestId("queue-row-one")).toBeNull();
  });
  it("selects only visible cancellable posts and confirms before sending exact IDs", async () => {
    mount();
    await screen.findByTestId("queue-row-one");
    fireEvent.change(screen.getByLabelText("Filter by campaign"), { target: { value: "polaris" } });
    expect((screen.getByTestId("queue-select-claimed") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("queue-select-all"));
    expect(screen.queryByTestId("opened-editor")).toBeNull();
    expect(state.cancelled).toHaveLength(0);
    fireEvent.click(screen.getByTestId("queue-bulk-cancel"));
    expect(state.cancelled).toHaveLength(0);
    fireEvent.click(await screen.findByTestId("queue-bulk-cancel-confirm"));
    await waitFor(() => expect(state.cancelled).toEqual([["one"]]));
  });
  it("clears selection on campaign changes", async () => {
    mount();
    await screen.findByTestId("queue-row-one");
    fireEvent.click(screen.getByTestId("queue-select-one"));
    expect(screen.getByTestId("queue-bulk-cancel")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter by campaign"), { target: { value: "other" } });
    expect(screen.queryByTestId("queue-bulk-cancel")).toBeNull();
    expect(state.cancelled).toHaveLength(0);
  });
});
