// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EventWebsiteImportDialog from "../EventWebsiteImportDialog";
import { apiRequest } from "@/lib/queryClient";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/tabContext", () => ({ getTabMarketId: () => "market-test" }));
vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
}));

const event = {
  id: "website-event", slug: "orbit-live", title: "Orbit Live",
  startDate: "2026-09-12", endDate: "2026-09-13", location: "Seattle",
  timezone: null,
  sessions: [{
    id: "session-a", title: "Designing reliable imports", sessionType: "WORKSHOP",
    speakers: "Maya Chen", track: "Engineering", room: "Hall C", startTime: null,
  }],
};
const request = vi.mocked(apiRequest);
let client: QueryClient;

function mount(open = true, onOpenChange = vi.fn()) {
  const view = (isOpen: boolean) => <QueryClientProvider client={client}>
    <EventWebsiteImportDialog open={isOpen} onOpenChange={onOpenChange} />
  </QueryClientProvider>;
  return { ...render(view(open)), view, onOpenChange };
}

async function preview(source = "orbit-live") {
  fireEvent.change(screen.getByLabelText("Event URL or slug"), { target: { value: source } });
  fireEvent.click(screen.getByRole("button", { name: "Preview event" }));
  await screen.findByText("Designing reliable imports");
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  request.mockReset();
  request.mockImplementation(async (method, url) => {
    if (url === "/api/integrations/website/status") return Response.json({ connected: true });
    if (url.startsWith("/api/conferences/website-preview?")) return Response.json({ event });
    if (method === "POST") return Response.json({
      conferenceId: "conf-result", eventUpdated: true, sessionsAdded: 1, sessionsUpdated: 2, sessionsSkipped: 3,
    });
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
});
afterEach(() => { cleanup(); client.clear(); });

describe("event website import", () => {
  it("requires preview and explicit confirmation, then imports the reviewed source and refreshes detail/list caches", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    mount();
    expect((screen.getByRole("button", { name: "Confirm import" }) as HTMLButtonElement).disabled).toBe(true);
    await preview("https://site.example/events/orbit-live?ref=schedule");
    expect(request).toHaveBeenCalledWith("GET", "/api/conferences/website-preview?source=https%3A%2F%2Fsite.example%2Fevents%2Forbit-live%3Fref%3Dschedule");
    expect(screen.getByText("Start time not provided · Engineering · Hall C")).toBeTruthy();
    expect(screen.getByText("Not provided by source")).toBeTruthy();
    expect(request.mock.calls.filter(([method]) => method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await screen.findByText("Import complete");
    expect(request).toHaveBeenCalledWith("POST", "/api/conferences/import-website", { source: "https://site.example/events/orbit-live?ref=schedule" });
    expect(screen.getByRole("link", { name: "Open Event Promotion" }).getAttribute("href")).toBe("/app/marketing/conferences/conf-result");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/conferences"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/conferences", "conf-result"] });
    expect(client.getQueryCache().find({ queryKey: ["/api/conferences/website-preview", "market-test", "https://site.example/events/orbit-live?ref=schedule"] })).toBeTruthy();
  });

  it("invalidates the preview and confirmation on every edit and resets on reopen", async () => {
    const rendered = mount();
    await preview();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Event URL or slug"), { target: { value: "a-different-event" } });
    expect(screen.queryByText("Designing reliable imports")).toBeNull();
    expect((screen.getByRole("button", { name: "Confirm import" }) as HTMLButtonElement).disabled).toBe(true);
    rendered.rerender(rendered.view(false));
    rendered.rerender(rendered.view(true));
    expect((screen.getByLabelText("Event URL or slug") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(request.mock.calls.filter(([method]) => method === "POST")).toHaveLength(0);
  });

  it("surfaces unavailable-website and preview errors without silently treating them as empty results", async () => {
    request.mockRejectedValue(new Error("Website authentication expired"));
    mount();
    await screen.findByText(/Could not check website connection/);
    fireEvent.change(screen.getByLabelText("Event URL or slug"), { target: { value: "orbit-live" } });
    const button = screen.getByRole("button", { name: "Preview event" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await screen.findByText(/Could not load event & schedule: Website authentication expired/);
    expect((screen.getByRole("button", { name: "Confirm import" }) as HTMLButtonElement).disabled).toBe(true);
    request.mockImplementation(async (_method, url) => url.includes("website-preview")
      ? Response.json({ event }) : Response.json({ connected: true }));
    fireEvent.click(screen.getByRole("button", { name: "Preview event" }));
    await screen.findByText("Designing reliable imports");
  });

  it("explains a missing schedule and permits a confirmed details-only import", async () => {
    request.mockImplementation(async (_method, url) => url.includes("website-preview")
      ? Response.json({ event: { ...event, sessions: [] } }) : Response.json({ connected: true }));
    mount();
    fireEvent.change(screen.getByLabelText("Event URL or slug"), { target: { value: "orbit-live" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview event" }));
    await screen.findByText(/No sessions were returned/);
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect((screen.getByRole("button", { name: "Confirm import" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("does not restore a stale preview when the source is edited during loading", async () => {
    let resolvePreview!: (response: Response) => void;
    request.mockImplementation(async (_method, url) => url.includes("website-preview")
      ? new Promise<Response>((resolve) => { resolvePreview = resolve; })
      : Response.json({ connected: true }));
    mount();
    fireEvent.change(screen.getByLabelText("Event URL or slug"), { target: { value: "orbit-live" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview event" }));
    await waitFor(() => expect(resolvePreview).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Event URL or slug"), { target: { value: "different-event" } });
    resolvePreview(Response.json({ event }));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.queryByText("Designing reliable imports")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect((screen.getByRole("button", { name: "Confirm import" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows import errors and keeps the reviewed preview available for retry", async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (method, ...args) => {
      if (method === "POST") throw new Error("Website is temporarily unavailable");
      return original(method, ...args);
    });
    mount();
    await preview();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await screen.findByText(/Import failed: Website is temporarily unavailable/);
    expect(screen.getByText("Designing reliable imports")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm import" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("Import complete")).toBeNull();
  });
});
