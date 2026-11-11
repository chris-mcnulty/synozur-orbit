// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultMeetingContact } from "@shared/conference-meetings";
import { apiRequest } from "@/lib/queryClient";
import { ClassificationBadges, ClassificationEditor, ClassificationSource, ClassificationToolbar } from "../campaign-classification";
import { canClassifyCampaign, classificationSearchText, emptyClassificationFilters, groupClassifiedPeople, matchesClassification, UNCLASSIFIED, visibleSelectedIds, type ClassifiedPerson } from "../campaign-classification-helpers";
import { useCampaignClassification } from "../use-campaign-classification";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const people: ClassifiedPerson[] = [
  { id: "one", name: "Mira Chen", source: "manual", classification: { tags: ["Priority", "Briefing"], eventRoles: ["speaker", "sponsor"], sourceDetail: "Referred by colleague" }, meeting: { ...defaultMeetingContact(), relationships: ["customer", "partner"], attendance: "confirmed", attendanceEvidence: "Registration confirmed" } },
  { id: "two", name: "Luis Ortiz", source: "hubspot" },
];
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("campaign classification helpers", () => {
  it("keeps flat contacts unique and exposes overlapping memberships", () => {
    expect(groupClassifiedPeople([...people, people[0]], "none")[0].people).toHaveLength(2);
    const groups = groupClassifiedPeople(people, "relationship");
    expect(groups.find(group => group.key === "customer")?.people[0].id).toBe("one");
    expect(groups.find(group => group.key === "partner")?.people[0].id).toBe("one");
    expect(groups.find(group => group.key === UNCLASSIFIED)?.people[0].id).toBe("two");
    expect(groups.reduce((sum, group) => sum + group.people.length, 0)).toBe(3);
  });
  it("combines classification dimensions and handles case-insensitive tags", () => {
    const filters = { ...emptyClassificationFilters(), relationship: "partner", attendance: "confirmed", eventRole: "speaker", tag: "PRIORITY" };
    expect(people.filter(person => matchesClassification(person, filters)).map(person => person.id)).toEqual(["one"]);
    expect(matchesClassification(people[0], { ...filters, eventRole: "organizer" })).toBe(false);
    expect(matchesClassification(people[1], { ...emptyClassificationFilters(), attendance: UNCLASSIFIED })).toBe(true);
  });
  it("counts only supplied filtered contacts and preserves provenance labels", () => {
    const groups = groupClassifiedPeople([people[1]], "source");
    expect(groups.map(group => [group.label, group.people.length])).toEqual([["HubSpot", 1]]);
    expect(groupClassifiedPeople(people, "source").some(group => group.label === "Added manually")).toBe(true);
  });
  it("searches, filters, and groups source detail separately from immutable source", () => {
    expect(classificationSearchText(people[0])).toContain("referred by colleague");
    expect(matchesClassification(people[0], { ...emptyClassificationFilters(), sourceDetail: "REFERRED BY COLLEAGUE" })).toBe(true);
    expect(groupClassifiedPeople(people, "sourceDetail").map(group => group.key)).toEqual(["referred by colleague", UNCLASSIFIED]);
    expect(people[0].source).toBe("manual");
  });
  it("caps selection at 200 unique visible IDs", () => {
    const many = Array.from({ length: 213 }, (_, index) => ({ id: String(index) }));
    expect(visibleSelectedIds(["hidden", ...many.map(person => person.id), "1"], many)).toHaveLength(200);
    expect(visibleSelectedIds(["hidden", "one", "one"], people)).toEqual(["one"]);
  });
  it("allows exactly the backend classification roles", () => {
    for (const role of ["Analyst", "Domain Admin", "Global Admin"]) expect(canClassifyCampaign(role)).toBe(true);
    for (const role of ["Standard User", "", undefined]) expect(canClassifyCampaign(role)).toBe(false);
  });
});

describe("classification controls", () => {
  it("shows overlapping badges, confirmation evidence and read-only honest source", () => {
    render(<><ClassificationBadges person={people[0]} /><ClassificationSource person={people[0]} /></>);
    for (const text of ["Customer", "Partner", "Confirmed attendee", "Speaker", "Sponsor", "Added manually", "Referred by colleague"]) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByTitle("Registration confirmed")).toBeTruthy();
  });
  it("requires explicitly marked sparse changes and never submits source", async () => {
    const save = vi.fn().mockResolvedValue({});
    render(<ClassificationEditor people={[people[0]]} onClose={vi.fn()} onSave={save} isSaving={false} error="" />);
    expect((screen.getByTestId("classification-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("classification-change-sourceDetail"));
    fireEvent.change(screen.getByLabelText("Source detail"), { target: { value: "From me" } });
    fireEvent.click(screen.getByTestId("classification-save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ sourceDetail: "From me" }));
    expect(screen.queryByLabelText("Source")).toBeNull();
  });
  it("lets bulk changes add and remove tags without replacing relationships", async () => {
    const save = vi.fn().mockResolvedValue({});
    render(<ClassificationEditor people={people} onClose={vi.fn()} onSave={save} isSaving={false} error="" />);
    fireEvent.click(screen.getByTestId("classification-change-tags"));
    fireEvent.change(screen.getByLabelText("Tag update mode"), { target: { value: "remove" } });
    fireEvent.change(screen.getByLabelText("Campaign tags"), { target: { value: "Priority, Briefing" } });
    fireEvent.click(screen.getByTestId("classification-tags-commit"));
    fireEvent.click(screen.getByTestId("classification-save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ tags: ["Priority", "Briefing"], tagsMode: "remove" }));
  });
  it("retains errors and form changes for retry", () => {
    render(<ClassificationEditor people={people} onClose={vi.fn()} onSave={vi.fn()} isSaving={false} error="Please retry" />);
    expect(screen.getByRole("alert").textContent).toBe("Please retry");
    fireEvent.click(screen.getByTestId("classification-change-eventRoles"));
    fireEvent.click(screen.getByTestId("classification-event-role-speaker"));
    fireEvent.click(screen.getByTestId("classification-event-role-sponsor"));
    expect(screen.getByTestId("classification-event-role-speaker").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("classification-event-role-sponsor").getAttribute("aria-pressed")).toBe("true");
  });
  it("explains memberships and keeps classification read-only for other roles", () => {
    render(<ClassificationToolbar people={people} filters={emptyClassificationFilters()} onFiltersChange={vi.fn()} groupBy="relationship" onGroupByChange={vi.fn()} selectedCount={0} canEdit={false} onEdit={vi.fn()} onClear={vi.fn()} uniqueCount={2} membershipCount={3} />);
    expect(screen.getByTestId("classification-count").textContent).toContain("2 unique contacts · 3 group memberships");
    expect(screen.queryByTestId("classification-edit-selected")).toBeNull();
    expect(screen.getByText("Classification is read-only for your role.")).toBeTruthy();
  });
});

describe("classification controller", () => {
  function setup() {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return { client, wrapper };
  }
  it("sends sparse patches and invalidates contacts and meeting prep", async () => {
    vi.mocked(apiRequest).mockResolvedValue(Response.json({ updated: 1 }));
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCampaignClassification({ campaignId: "campaign", people, role: "Analyst" }), { wrapper });
    const { act } = await import("@testing-library/react");
    act(() => result.current.openEditor(["one"]));
    await act(async () => { await result.current.save({ attendance: "confirmed" }); });
    expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/sales-outreach/campaigns/campaign/prospects/classification", { prospectIds: ["one"], patch: { attendance: "confirmed" } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/sales-outreach/campaigns", "campaign", "prospects"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/sales-outreach/campaigns/campaign/meetings"] });
  });
  it("clears selection on filter and campaign changes and excludes hidden people", async () => {
    const { wrapper } = setup();
    const { result, rerender } = renderHook(({ campaignId, filterScope, visible }) => useCampaignClassification({ campaignId, people: visible, role: "Analyst", filterScope }), { wrapper, initialProps: { campaignId: "first", filterScope: "", visible: people } });
    const { act } = await import("@testing-library/react");
    act(() => result.current.toggleAll(true));
    expect(result.current.selectedIds).toHaveLength(2);
    rerender({ campaignId: "first", filterScope: "", visible: [people[1]] });
    expect(result.current.selectedIds).toEqual(["two"]);
    rerender({ campaignId: "first", filterScope: "search", visible: people });
    expect(result.current.selectedIds).toEqual([]);
    act(() => result.current.toggleAll(true));
    rerender({ campaignId: "second", filterScope: "search", visible: people });
    expect(result.current.selectedIds).toEqual([]);
  });
});
