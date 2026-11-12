// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SavedOutreachDrafts from "../saved-outreach-drafts";

const draft = { id: "draft-1", campaignId: "campaign-1", channel: "email", stepNumber: 1, subject: "Saved subject", body: "Saved body", status: "draft_pending_approval", complianceFlags: null };
function setup(rows: unknown[], requestedDraftId?: string) {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
  vi.stubGlobal("fetch", fetcher);
  const onOpen = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SavedOutreachDrafts
    prospectId="person-1" prospectName="Test contact" campaignId="campaign-1" scope="tenant-user"
    requestedDraftId={requestedDraftId} onOpen={onOpen} onClose={vi.fn()}
  /></QueryClientProvider>);
  return { onOpen, fetcher };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("reopen saved outreach drafts without Outlook", () => {
  it("opens the existing saved subject and body without composing or approving", async () => {
    const { onOpen, fetcher } = setup([draft]);
    fireEvent.click(await screen.findByRole("button", { name: "Open draft" }));
    expect(onOpen).toHaveBeenCalledWith(draft);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/sales-outreach/prospects/person-1/touches", { credentials: "include" });
  });
  it("excludes already-approved messages and drafts from other campaigns", async () => {
    setup([draft, { ...draft, id: "approved", status: "approved", subject: "Already approved" }, { ...draft, id: "other", campaignId: "other", subject: "Other campaign" }]);
    await screen.findByText("Saved subject");
    expect(screen.queryByText("Already approved")).toBeNull();
    expect(screen.queryByText("Other campaign")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Open draft" })).toHaveLength(1);
  });
  it("automatically opens only the exact draft requested by an Inbox link", async () => {
    const second = { ...draft, id: "draft-2", subject: "Second saved draft" };
    const { onOpen } = setup([draft, second], "draft-2");
    await waitFor(() => expect(onOpen).toHaveBeenCalledExactlyOnceWith(second));
  });
  it("explains stale links rather than opening another draft", async () => {
    const { onOpen } = setup([draft], "missing");
    await screen.findByRole("alert");
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText(/no longer available for editing/)).toBeTruthy();
  });
  it("shows an empty state without generating a replacement", async () => {
    const { onOpen } = setup([]);
    await screen.findByText("No pending drafts for this contact in this campaign.");
    expect(onOpen).not.toHaveBeenCalled();
  });
  it("offers retry after a load failure", async () => {
    const { fetcher } = setup([]);
    fetcher.mockResolvedValueOnce({ ok: false });
    // The initial request starts during render; force its response to fail on a remount.
    cleanup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><SavedOutreachDrafts prospectId="person-1" prospectName="Test" campaignId="campaign-1" scope="tenant-user" onOpen={vi.fn()} onClose={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByText("No pending drafts for this contact in this campaign.");
  });
});
