// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { apiRequest } from "@/lib/queryClient";
import { useHubspotPreview } from "../use-hubspot-preview";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  ApiError: class extends Error {},
}));
const row = { hubspotContactId: "hs-23", name: "Maya Chen", email: null, company: "Cedar", jobTitle: null, alreadyOnCampaign: false };
function response(contacts = [row]) {
  return { ok: true, json: async () => ({ contacts }) } as Response;
}
beforeEach(() => { vi.mocked(apiRequest).mockReset(); });
afterEach(cleanup);

describe("HubSpot preview isolation", () => {
  it("never searches automatically; submits company alone as a separate field", async () => {
    vi.mocked(apiRequest).mockResolvedValue(response());
    const { result } = renderHook(() => useHubspotPreview("campaign-a", "tenant-a:market-a"));
    expect(apiRequest).not.toHaveBeenCalled();
    act(() => result.current.setCompany("  Cedar  "));
    await act(async () => { await result.current.search(); });
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/sales-outreach/campaigns/campaign-a/preview-hubspot", {
      company: "Cedar", query: undefined, limit: 50,
    });
    expect(result.current.selected.has("hs-23")).toBe(true);
  });

  it("clears results and selection immediately when company changes", async () => {
    vi.mocked(apiRequest).mockResolvedValue(response());
    const { result } = renderHook(() => useHubspotPreview("campaign-a", "tenant-a"));
    await act(async () => { await result.current.search("Cedar"); });
    act(() => result.current.setCompany("Morrow"));
    expect(result.current.contacts).toBeNull();
    expect(result.current.selected.size).toBe(0);
  });

  it("ignores an old company response after editing the company", async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(apiRequest).mockImplementation(() => new Promise(done => { resolve = done; }));
    const { result } = renderHook(() => useHubspotPreview("campaign-a", "tenant-a"));
    let pending!: Promise<void>;
    act(() => { pending = result.current.search("Cedar"); });
    act(() => result.current.setCompany("Morrow"));
    await act(async () => { resolve(response()); await pending; });
    expect(result.current.contacts).toBeNull();
    expect(result.current.selected.size).toBe(0);
    expect(result.current.searching).toBe(false);
  });

  it("ignores a previous scope response and resets the search fields", async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(apiRequest).mockImplementation(() => new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(({ scope }) => useHubspotPreview("campaign-a", scope), { initialProps: { scope: "tenant-a" } });
    act(() => result.current.setCompany("Cedar"));
    let pending!: Promise<void>;
    act(() => { pending = result.current.search(); });
    rerender({ scope: "tenant-b" });
    await act(async () => { resolve(response()); await pending; });
    expect(result.current.company).toBe("");
    expect(result.current.contacts).toBeNull();
    expect(result.current.selected.size).toBe(0);
  });

  it("does not preselect existing campaign contacts", async () => {
    vi.mocked(apiRequest).mockResolvedValue(response([{ ...row, alreadyOnCampaign: true }]));
    const { result } = renderHook(() => useHubspotPreview("campaign-a", "tenant-a"));
    await act(async () => { await result.current.search(); });
    expect(result.current.contacts).toHaveLength(1);
    expect(result.current.selected.size).toBe(0);
  });
});
