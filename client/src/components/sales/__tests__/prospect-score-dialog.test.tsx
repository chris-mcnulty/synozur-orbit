// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, act, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { effectiveScoringFacts } from "@shared/prospect-scoring";
import ProspectScoreDialog, { ProspectScoreButton } from "../prospect-score-dialog";
import { missingScoringLabels, scoreSignalState, type ScorablePerson } from "../prospect-score-helpers";
import { useProspectRescore } from "../use-prospect-rescore";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
const request = vi.mocked(apiRequest);
const person: ScorablePerson = {
  id: "mira", name: "Mira Desai", title: "Operations lead", icpScore: 24,
  signals: { industry: "Logistics", geography: "London", segment: "" },
  scoreBreakdown: { threshold: 70, matchedPersonaName: "Operations leaders", signals: [
    { key: "role", label: "Role fit", weight: 40, matched: false },
    { key: "industry", label: "Industry", weight: 24, matched: true },
    { key: "segment", label: "Segment", weight: 16, matched: false, absent: true, note: "Segment unknown" },
  ] },
};
const result = { score: 64, breakdown: { signals: [{ key: "role", label: "Role fit", weight: 40, matched: true }] }, facts: { title: "VP Operations", industry: "Logistics", geography: "London", segment: "" } };
function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
function mount(role = "Analyst", contact = person) {
  const { client, wrapper } = setup();
  const onClose = vi.fn();
  render(<ProspectScoreDialog campaignId="summit" person={contact} criteria={{ targetRoles: ["VP Operations"], industries: ["Logistics"], geographies: ["UK"] }} role={role} onClose={onClose} />, { wrapper });
  return { client, onClose };
}
beforeEach(() => { request.mockReset(); request.mockResolvedValue(Response.json(result)); });
afterEach(cleanup);

describe("scoring facts and explanations", () => {
  it("distinguishes confirmed mismatch from missing facts without inventing points", () => {
    expect(scoreSignalState(person.scoreBreakdown!.signals![0])).toBe("mismatch");
    expect(scoreSignalState(person.scoreBreakdown!.signals![1])).toBe("matched");
    expect(scoreSignalState(person.scoreBreakdown!.signals![2])).toBe("missing");
    expect(missingScoringLabels(person)).toEqual(["Segment"]);
    mount();
    expect(screen.getByTestId("score-signal-role").textContent).toContain("Mismatch");
    expect(screen.getByTestId("score-signal-segment").textContent).toContain("Missing data");
    expect(screen.getByTestId("score-signal-industry").textContent).toContain("24 / 24 pts");
    expect(screen.getByTestId("score-current").textContent).toBe("24/100");
    expect(screen.getByTestId("score-target-criteria").textContent).toContain("VP Operations");
    expect(screen.getByTestId("score-best-persona").textContent).toContain("Operations leaders");
    expect(request).not.toHaveBeenCalled();
  });
  it("prefills effective campaign overrides instead of shared contact values", () => {
    const overridden = { ...person, classification: { tags: [], eventRoles: [], sourceDetail: "", scoringFacts: result.facts } };
    expect(effectiveScoringFacts(overridden)).toEqual(result.facts);
    mount("Analyst", overridden);
    expect((screen.getByLabelText("Title / role") as HTMLInputElement).value).toBe("VP Operations");
    expect((screen.getByLabelText("Industry") as HTMLInputElement).value).toBe("Logistics");
  });
  it("makes even an unscored contact without a dossier inspectable", () => {
    const onClick = vi.fn();
    render(<ProspectScoreButton person={{ ...person, icpScore: null }} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: /Inspect score for Mira Desai: unscored, incomplete data/ }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByTestId("score-incomplete-mira").textContent).toBe("Incomplete data");
  });
  it("falls back to missing required facts for legacy contacts, not mismatch guesses", () => {
    expect(missingScoringLabels({ ...person, scoreBreakdown: null }, { segments: ["Enterprise"], industries: ["Logistics"] })).toEqual(["Segment"]);
  });
  it("provides an honest empty explanation and read-only access for other roles", () => {
    mount("Standard User", { ...person, scoreBreakdown: null });
    expect(screen.getByTestId("score-no-breakdown")).toBeTruthy();
    expect(screen.getByTestId("score-read-only")).toBeTruthy();
    expect((screen.getByLabelText("Title / role") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByTestId("score-save-rescore")).toBeNull();
    expect(screen.queryByTestId("score-rescore-saved")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});

describe("explicit deterministic rescoring", () => {
  it("atomically saves all four facts, displays actual server score and invalidates both workspaces", async () => {
    const { client } = mount();
    client.setQueryData(["/api/sales-outreach/campaigns", "summit", "prospects"], [person]);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.change(screen.getByLabelText("Title / role"), { target: { value: "VP Operations" } });
    fireEvent.click(screen.getByTestId("score-save-rescore"));
    await waitFor(() => expect(screen.getByTestId("score-current").textContent).toBe("64/100"));
    expect(request).toHaveBeenCalledExactlyOnceWith("POST", "/api/sales-outreach/campaigns/summit/prospects/mira/rescore", { facts: result.facts });
    expect(client.getQueryData<ScorablePerson[]>(["/api/sales-outreach/campaigns", "summit", "prospects"])?.[0].title).toBe("Operations lead");
    expect(client.getQueryData<ScorablePerson[]>(["/api/sales-outreach/campaigns", "summit", "prospects"])?.[0].classification?.scoringFacts).toEqual(result.facts);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/sales-outreach/campaigns", "summit", "prospects"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/sales-outreach/campaigns/summit/meetings"] });
  });
  it("rescores saved facts with {} without submitting or erasing unsaved edits", async () => {
    mount();
    fireEvent.change(screen.getByLabelText("Title / role"), { target: { value: "Unverified draft" } });
    fireEvent.click(screen.getByTestId("score-rescore-saved"));
    await screen.findByTestId("score-save-success");
    expect(request).toHaveBeenCalledExactlyOnceWith("POST", "/api/sales-outreach/campaigns/summit/prospects/mira/rescore", {});
    expect((screen.getByLabelText("Title / role") as HTMLInputElement).value).toBe("Unverified draft");
  });
  it("retains edits and previous score on failure and retries only on explicit action", async () => {
    request.mockRejectedValueOnce(new Error("503: Please retry"));
    mount();
    fireEvent.change(screen.getByLabelText("Title / role"), { target: { value: "VP Operations" } });
    fireEvent.click(screen.getByTestId("score-save-rescore"));
    expect((await screen.findByRole("alert")).textContent).toBe("Please retry");
    expect(screen.getByTestId("score-current").textContent).toBe("24/100");
    expect((screen.getByLabelText("Title / role") as HTMLInputElement).value).toBe("VP Operations");
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("score-save-rescore"));
    await screen.findByTestId("score-save-success");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("allows server scores to decrease rather than artificially increasing them", async () => {
    request.mockResolvedValueOnce(Response.json({ ...result, score: 8 }));
    mount();
    fireEvent.click(screen.getByTestId("score-rescore-saved"));
    await waitFor(() => expect(screen.getByTestId("score-current").textContent).toBe("8/100"));
  });
  it("guards the mutation for unauthorized roles even outside the read-only UI", async () => {
    const { wrapper } = setup();
    const { result: hook } = renderHook(() => useProspectRescore("summit", "mira", "Standard User"), { wrapper });
    await act(async () => { await expect(hook.current.mutateAsync(undefined)).rejects.toThrow("cannot change"); });
    expect(request).not.toHaveBeenCalled();
  });
  it("scopes facts and mutation state when switching contact/campaign keys", async () => {
    const { wrapper } = setup();
    const props = { criteria: {}, role: "Analyst", onClose: vi.fn() };
    const { rerender } = render(<ProspectScoreDialog key="summit:mira" campaignId="summit" person={person} {...props} />, { wrapper });
    fireEvent.change(screen.getByLabelText("Title / role"), { target: { value: "Private draft" } });
    rerender(<ProspectScoreDialog key="forum:luis" campaignId="forum" person={{ ...person, id: "luis", title: "Founder" }} {...props} />);
    expect((screen.getByLabelText("Title / role") as HTMLInputElement).value).toBe("Founder");
    fireEvent.click(screen.getByTestId("score-save-rescore"));
    await screen.findByTestId("score-save-success");
    expect(request).toHaveBeenCalledWith("POST", "/api/sales-outreach/campaigns/forum/prospects/luis/rescore", { facts: { title: "Founder", industry: "Logistics", geography: "London", segment: "" } });
  });
});
