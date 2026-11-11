// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApolloRevealPreview as Preview } from "@shared/apollo-reveal";
import ApolloRevealPreview from "../apollo-reveal-preview";
import { apiRequest } from "@/lib/queryClient";
vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
const request = vi.mocked(apiRequest);
const candidate = { candidate: { name: "Alice Chen", title: "Director", companyName: "Acme", email: null, linkedinUrl: null, geography: null, industry: null, segment: null, sourceUrl: null, source: "apollo" as const }, scored: { score: 80, qualified: true, disqualified: false } };
function preview(id = "person-1"): Preview {
  return { id, displayName: `Alice ${id} C***n`, title: "Director", companyName: "Acme", companyDomain: "acme.com", token: `token-${id}`, expiresAt: new Date(Date.now() + 1_800_000).toISOString() };
}
function mount(previews: Preview[] = [preview()]) {
  const onRevealed = vi.fn(), onBusyChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><ApolloRevealPreview campaignId="campaign" previews={previews} onRevealed={onRevealed} onBusyChange={onBusyChange} /></QueryClientProvider>);
  return { onRevealed, onBusyChange };
}
beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue(Response.json({ candidates: [candidate], outcomes: [{ previewId: "person-1", status: "revealed", message: "Revealed" }], attemptedCount: 1 }));
});
afterEach(cleanup);
describe("explicit paid Apollo reveal review", () => {
  it("starts unselected and never calls Apollo from preview, selection or first review", () => {
    mount();
    expect((screen.getByRole("checkbox") as HTMLInputElement).getAttribute("data-state")).toBe("unchecked");
    expect((screen.getByRole("button", { name: "Review paid reveal" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Review paid reveal" }));
    expect(screen.getByText(/may use up to 1 Apollo credits/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm paid reveal" })).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
  it("reveals only confirmed tokens and returns candidates for separate import review", async () => {
    const { onRevealed, onBusyChange } = mount();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Review paid reveal" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm paid reveal" }));
    await waitFor(() => expect(onRevealed).toHaveBeenCalledWith([candidate]));
    expect(request).toHaveBeenCalledExactlyOnceWith("POST", "/api/sales-outreach/campaigns/campaign/discover/reveal", { tokens: ["token-person-1"], confirmCredits: true });
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  });
  it("lets the user go back without spending credits", () => {
    mount(); fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Review paid reveal" }));
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.queryByRole("button", { name: "Confirm paid reveal" })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
  it("blocks expired previews and a selection larger than ten", () => {
    mount([ { ...preview("expired"), expiresAt: new Date(Date.now() - 1).toISOString() }, ...Array.from({ length: 11 }, (_, i) => preview(String(i))) ]);
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes[0].disabled).toBe(true);
    for (const box of boxes.slice(1, 11)) fireEvent.click(box);
    expect(boxes[11].disabled).toBe(true);
    expect(screen.getByText("10 selected · up to 10 Apollo credits")).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
  it("shows partial failures while retaining successes for import review", async () => {
    request.mockResolvedValueOnce(Response.json({ candidates: [candidate], attemptedCount: 2, outcomes: [
      { previewId: "person-1", status: "revealed", message: "Revealed" },
      { previewId: "person-2", status: "failed", message: "Credits may have been used; no retry." },
    ] }));
    const { onRevealed } = mount([preview(), preview("person-2")]);
    screen.getAllByRole("checkbox").forEach(box => fireEvent.click(box));
    fireEvent.click(screen.getByRole("button", { name: "Review paid reveal" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm paid reveal" }));
    expect(await screen.findByText(/Credits may have been used/)).toBeTruthy();
    expect(onRevealed).toHaveBeenCalledWith([candidate]);
  });
  it("does not retry an uncertain paid request and locks attempted previews", async () => {
    request.mockRejectedValueOnce(new Error("Network disconnected"));
    const { onRevealed } = mount();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Review paid reveal" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm paid reveal" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
    expect(onRevealed).not.toHaveBeenCalled();
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  });
});
