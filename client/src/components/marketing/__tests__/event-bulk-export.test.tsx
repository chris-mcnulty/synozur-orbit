// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const io = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: io.api }));
vi.mock("@/lib/tabContext", () => ({ getTabMarketId: () => "market" }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => <input type="checkbox" checked={checked}
    onChange={e => onCheckedChange(e.target.checked)} {...props} />,
}));
import EventBulkExportDialog from "../EventBulkExportDialog";

const events = [
  { id: "event-a", name: "Event A", status: "active" },
  { id: "event-b", name: "Event B", status: "active" },
  { id: "archived", name: "Archived Event", status: "archived" },
];
const preview = {
  totalPosts: 8, exportablePosts: 4, automaticPosts: 2, csvPosts: 2,
  undatedOrPastPosts: 1, draftPosts: 1, claimedPosts: 0, deliveredPosts: 2,
};
const json = (data: unknown) => ({ json: async () => data });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><EventBulkExportDialog open onOpenChange={vi.fn()} events={events} /></QueryClientProvider>);
}
async function selectTargets() {
  await screen.findByText("LinkedIn Brand");
  fireEvent.click(screen.getByLabelText("Event A"));
  fireEvent.click(screen.getByLabelText("Event B"));
  fireEvent.click(screen.getByLabelText(/LinkedIn Brand/));
}

describe("event bulk export interaction", () => {
  beforeEach(() => {
    io.api.mockReset().mockImplementation(async (_method: string, url: string) => {
      if (url === "/api/social-accounts") return json([
        { id: "linkedin", accountName: "LinkedIn Brand", platform: "linkedin", status: "active" },
        { id: "twitter", accountName: "X Brand", platform: "twitter", status: "active" },
      ]);
      if (url === "/api/conferences/export-preview") return json(preview);
      if (url === "/api/conferences/export-csv") return {
        blob: async () => new Blob(["combined csv"]),
        headers: { get: () => "post-a,post-b" },
      };
      if (url === "/api/conferences/mark-export-delivered") return json({ updated: 2 });
      throw new Error(`Unexpected request ${url}`);
    });
    URL.createObjectURL = vi.fn(() => "blob:export");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("requires explicit events and accounts instead of exporting every target", async () => {
    mount();
    await screen.findByText("LinkedIn Brand");
    expect((screen.getByRole("button", { name: "Preview export" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Archived Event")).toBeNull();
    expect(io.api.mock.calls.filter(call => call[0] === "POST")).toHaveLength(0);
    await selectTargets();
    fireEvent.click(screen.getByRole("button", { name: "Preview export" }));
    await screen.findByText("Export preview");
    expect(io.api).toHaveBeenCalledWith("POST", "/api/conferences/export-preview", {
      conferenceIds: ["event-a", "event-b"], socialAccountIds: ["linkedin"],
    });
  });

  it("downloads one combined file, then requires a separate successful-import confirmation", async () => {
    mount();
    await selectTargets();
    fireEvent.click(screen.getByRole("button", { name: "Preview export" }));
    await screen.findByText("Export preview");
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    await screen.findByText("CSV downloaded; import pending");
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(io.api).toHaveBeenCalledWith("POST", "/api/conferences/export-csv", expect.objectContaining({
      conferenceIds: ["event-a", "event-b"], socialAccountIds: ["linkedin"], format: "socialpilot",
    }));
    expect(io.api.mock.calls.some(call => call[1] === "/api/conferences/mark-export-delivered")).toBe(false);
    const confirm = screen.getByRole("button", { name: "Confirm successful import" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("I successfully imported this CSV into the selected scheduler."));
    fireEvent.click(confirm);
    await screen.findByText("Import recorded");
    expect(io.api).toHaveBeenCalledWith("POST", "/api/conferences/mark-export-delivered", {
      conferenceIds: ["event-a", "event-b"], socialAccountIds: ["linkedin"], postIds: ["post-a", "post-b"],
    });
  });

  it("clears the prior preview when account selection changes", async () => {
    mount();
    await selectTargets();
    fireEvent.click(screen.getByRole("button", { name: "Preview export" }));
    await screen.findByText("Export preview");
    await act(async () => { fireEvent.click(screen.getByLabelText(/X Brand/)); });
    await waitFor(() => expect(screen.queryByText("Export preview")).toBeNull());
    expect(screen.getByRole("button", { name: "Preview export" })).toBeTruthy();
  });
});
