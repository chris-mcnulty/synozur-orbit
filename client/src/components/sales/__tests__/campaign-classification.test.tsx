// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultMeetingContact } from "@shared/conference-meetings";
import { apiRequest } from "@/lib/queryClient";
import { ClassificationBadges, ClassificationEditor, ClassificationSource, ClassificationToolbar } from "../campaign-classification";
import { canClassifyCampaign, classificationSearchText, emptyClassificationFilters, groupClassifiedPeople, matchesClassification, meetingPriorityRank, UNCLASSIFIED, visibleSelectedIds, type ClassifiedPerson } from "../campaign-classification-helpers";
import { useCampaignClassification } from "../use-campaign-classification";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const people: ClassifiedPerson[] = [
  { id: "one", name: "Mira Chen", source: "manual", classification: { tags: ["Priority", "Briefing"], eventRoles: ["speaker", "sponsor"], sourceDetail: "Referred by colleague" }, meeting: { ...defaultMeetingContact(), relationships: ["customer", "partner"], attendance: "confirmed", attendanceEvidence: "Registration confirmed" } },
  { id: "two", name: "Luis Ortiz", source: "hubspot" },
];
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("campaign classification helpers", () => {
  it("filters, searches and groups meeting priority independently of attendance and score", () => {
    const requested: ClassifiedPerson = { ...people[1], classification: { tags: [], eventRoles: [], sourceDetail: "", meetingPriority: "requested_meeting" } };
    const high: ClassifiedPerson = { id: "three", classification: { tags: [], eventRoles: [], sourceDetail: "", meetingPriority: "high" } };
    expect(matchesClassification(requested, { ...emptyClassificationFilters(), meetingPriority: "requested_meeting" })).toBe(true);
    expect(matchesClassification(people[0], { ...emptyClassificationFilters(), meetingPriority: "normal" })).toBe(true);
    expect(classificationSearchText(requested)).toContain("requested a meeting");
    expect(groupClassifiedPeople([people[0], high, requested], "meetingPriority").map(group => group.label)).toEqual(["Requested a meeting", "High", "Normal"]);
    expect([people[0], requested, high].sort((a, b) => meetingPriorityRank(b) - meetingPriorityRank(a)).map(person => person.id)).toEqual(["two", "three", "one"]);
    expect(requested.meeting).toBeUndefined();
  });
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
  it.each([true, false])("supports sparse priority edits for single (%s) and bulk without changing attendance", async single => {
    const save = vi.fn().mockResolvedValue({});
    render(<ClassificationEditor people={single ? [people[0]] : people} onClose={vi.fn()} onSave={save} isSaving={false} error="" />);
    fireEvent.change(screen.getByLabelText("Meeting priority"), { target: { value: "requested_meeting" } });
    fireEvent.click(screen.getByTestId("classification-save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ meetingPriority: "requested_meeting" }));
  });
  it("renders requested priority as an independent badge without attendance claims", () => {
    render(<ClassificationBadges person={{ ...people[1], classification: { tags: [], eventRoles: [], sourceDetail: "", meetingPriority: "requested_meeting" } }} />);
    expect(screen.getByTestId("meeting-priority-two").textContent).toBe("Requested a meeting");
    expect(screen.queryByText("Confirmed attendee")).toBeNull();
  });
  it("shows overlapping badges, confirmation evidence and read-only honest source", () => {
    render(<><ClassificationBadges person={people[0]} /><ClassificationSource person={people[0]} /></>);
    for (const text of ["Customer", "Partner", "Confirmed attendee", "Speaker", "Sponsor", "Added manually", "Referred by colleague"]) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByTitle("Registration confirmed")).toBeTruthy();
  });
  it("edits directly, omits untouched fields and never submits provenance", async () => {
    const save = vi.fn().mockResolvedValue({});
    render(<ClassificationEditor people={[people[0]]} onClose={vi.fn()} onSave={save} isSaving={false} error="" />);
    expect((screen.getByTestId("classification-save") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect((screen.getByLabelText("Attendance") as HTMLSelectElement).value).toBe("confirmed");
    expect((screen.getByLabelText("Source detail") as HTMLInputElement).value).toBe("Referred by colleague");
    fireEvent.change(screen.getByLabelText("Source detail"), { target: { value: "From me" } });
    fireEvent.click(screen.getByTestId("classification-save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ sourceDetail: "From me" }));
    expect(screen.queryByLabelText("Source")).toBeNull();
  });
  it("lets bulk changes add and remove tags without replacing relationships", async () => {
    const save = vi.fn().mockResolvedValue({});
    render(<ClassificationEditor people={people} onClose={vi.fn()} onSave={save} isSaving={false} error="" />);
    fireEvent.change(screen.getByLabelText("Tag update mode"), { target: { value: "remove" } });
    fireEvent.change(screen.getByLabelText("Campaign tags"), { target: { value: "Priority, Briefing" } });
    fireEvent.click(screen.getByTestId("classification-tags-commit"));
    fireEvent.click(screen.getByTestId("classification-save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ tags: ["Priority", "Briefing"], tagsMode: "remove" }));
  });
  it("retains errors and form changes for retry", () => {
    render(<ClassificationEditor people={people} onClose={vi.fn()} onSave={vi.fn()} isSaving={false} error="Please retry" />);
    expect(screen.getByRole("alert").textContent).toBe("Please retry");
    fireEvent.change(screen.getByLabelText("Event roles update mode"), { target: { value: "replace" } });
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
  it("shows mixed bulk values honestly and can return scalar changes to unchanged", async () => {
    const save = vi.fn().mockResolvedValue({});
    render(<ClassificationEditor people={people} onClose={vi.fn()} onSave={save} isSaving={false} error="" />);
    const attendance = screen.getByLabelText("Attendance") as HTMLSelectElement;
    expect(attendance.selectedOptions[0].textContent).toBe("Mixed — leave unchanged");
    expect((screen.getByLabelText("Meeting priority") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Unchanged (Normal)");
    expect((screen.getByLabelText("Relationships update mode") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Mixed — leave unchanged");
    expect(screen.getByTestId("classification-relationship-unknown").getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByTestId("classification-relationship-partner") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(attendance, { target: { value: "unknown" } });
    fireEvent.change(attendance, { target: { value: "__unchanged" } });
    fireEvent.change(screen.getByLabelText("Meeting priority"), { target: { value: "high" } });
    fireEvent.click(screen.getByTestId("classification-save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ meetingPriority: "high" }));
  });
  it("drops reverted single edits and supports undo without disabling controls", () => {
    render(<ClassificationEditor people={[people[0]]} onClose={vi.fn()} onSave={vi.fn()} isSaving={false} error="" />);
    fireEvent.change(screen.getByLabelText("Attendance"), { target: { value: "unknown" } });
    fireEvent.change(screen.getByLabelText("Attendance"), { target: { value: "confirmed" } });
    expect((screen.getByTestId("classification-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("classification-event-role-speaker"));
    fireEvent.click(screen.getByTestId("classification-event-role-speaker"));
    expect((screen.getByTestId("classification-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Source detail"), { target: { value: "" } });
    fireEvent.click(screen.getByLabelText("Undo Source detail"));
    expect((screen.getByLabelText("Source detail") as HTMLInputElement).value).toBe("Referred by colleague");
    expect((screen.getByTestId("classification-save") as HTMLButtonElement).disabled).toBe(true);
  });
  it("clears single fields and lists without inferring relationships", async () => {
    const save = vi.fn().mockResolvedValue({});
    render(<ClassificationEditor people={[people[0]]} onClose={vi.fn()} onSave={save} isSaving={false} error="" />);
    fireEvent.change(screen.getByLabelText("Attendance evidence"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Source detail"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("classification-event-role-speaker"));
    fireEvent.click(screen.getByTestId("classification-event-role-sponsor"));
    fireEvent.click(screen.getByTestId("classification-relationship-unknown"));
    fireEvent.click(screen.getByText("Clear all tags"));
    fireEvent.click(screen.getByTestId("classification-save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      attendanceEvidence: "", sourceDetail: "", eventRoles: [], relationships: ["unknown"], tags: [], tagsMode: "replace",
    }));
  });
  it("requires explicit bulk list replacement and supports empty lists and text", async () => {
    const save = vi.fn().mockResolvedValue({});
    render(<ClassificationEditor people={people} onClose={vi.fn()} onSave={save} isSaving={false} error="" />);
    fireEvent.change(screen.getByLabelText("Event roles update mode"), { target: { value: "replace" } });
    fireEvent.change(screen.getByLabelText("Relationships update mode"), { target: { value: "replace" } });
    fireEvent.click(screen.getByTestId("classification-relationship-partner"));
    fireEvent.click(screen.getByText("Clear evidence for all"));
    fireEvent.click(screen.getByText("Clear source detail for all"));
    fireEvent.change(screen.getByLabelText("Tag update mode"), { target: { value: "replace" } });
    fireEvent.click(screen.getByTestId("classification-save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      eventRoles: [], relationships: ["partner"], attendanceEvidence: "", sourceDetail: "", tags: [], tagsMode: "replace",
    }));
  });
  it.each(["add", "remove", "replace"])("includes pending bulk tags when saving in %s mode", async mode => {
    const save = vi.fn().mockResolvedValue({});
    render(<ClassificationEditor people={people} onClose={vi.fn()} onSave={save} isSaving={false} error="" />);
    fireEvent.change(screen.getByLabelText("Tag update mode"), { target: { value: mode } });
    fireEvent.change(screen.getByLabelText("Campaign tags"), { target: { value: "Briefing, briefing, New" } });
    fireEvent.click(screen.getByTestId("classification-save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ tags: ["briefing", "New"], tagsMode: mode }));
  });
  it("saves typed single tags together with current tags and other edits", async () => {
    const save = vi.fn().mockResolvedValue({});
    render(<ClassificationEditor people={[people[0]]} onClose={vi.fn()} onSave={save} isSaving={false} error="" />);
    fireEvent.change(screen.getByLabelText("Meeting priority"), { target: { value: "high" } });
    fireEvent.change(screen.getByLabelText("Campaign tags"), { target: { value: "New" } });
    fireEvent.click(screen.getByTestId("classification-save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ meetingPriority: "high", tags: ["Priority", "Briefing", "New"], tagsMode: "replace" }));
  });
  it("does not use existing single tags as add/remove operands", async () => {
    const save = vi.fn().mockResolvedValue({});
    render(<ClassificationEditor people={[people[0]]} onClose={vi.fn()} onSave={save} isSaving={false} error="" />);
    fireEvent.change(screen.getByLabelText("Tag update mode"), { target: { value: "remove" } });
    expect((screen.getByTestId("classification-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Campaign tags"), { target: { value: "Priority" } });
    fireEvent.click(screen.getByTestId("classification-save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ tags: ["Priority"], tagsMode: "remove" }));
  });
  it("validates pending tags without losing the draft and lets users retry", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
    render(<ClassificationEditor people={people} onClose={vi.fn()} onSave={save} isSaving={false} error="" />);
    fireEvent.change(screen.getByLabelText("Campaign tags"), { target: { value: "x".repeat(61) } });
    fireEvent.click(screen.getByTestId("classification-save"));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("60 characters");
    expect((screen.getByLabelText("Campaign tags") as HTMLInputElement).value).toHaveLength(61);
    fireEvent.change(screen.getByLabelText("Campaign tags"), { target: { value: "Briefing" } });
    fireEvent.click(screen.getByTestId("classification-save"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Please retry"));
    fireEvent.click(screen.getByTestId("classification-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith({ tags: ["Briefing"], tagsMode: "add" });
  });
  it("can undo pending tags and bulk replacements completely", () => {
    render(<ClassificationEditor people={people} onClose={vi.fn()} onSave={vi.fn()} isSaving={false} error="" />);
    fireEvent.change(screen.getByLabelText("Tag update mode"), { target: { value: "replace" } });
    fireEvent.change(screen.getByLabelText("Campaign tags"), { target: { value: "Pending" } });
    fireEvent.click(screen.getByLabelText("Undo Campaign tags"));
    expect((screen.getByLabelText("Campaign tags") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("classification-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Relationships update mode"), { target: { value: "replace" } });
    fireEvent.change(screen.getByLabelText("Relationships update mode"), { target: { value: "__unchanged" } });
    expect((screen.getByTestId("classification-save") as HTMLButtonElement).disabled).toBe(true);
  });
  it("disables editing and cancel during saving; cancel otherwise closes without saving", () => {
    const save = vi.fn();
    const close = vi.fn();
    const { rerender } = render(<ClassificationEditor people={[people[0]]} onClose={close} onSave={save} isSaving error="" />);
    expect((screen.getByLabelText("Attendance") as HTMLSelectElement).matches(":disabled")).toBe(true);
    expect((screen.getByLabelText("Campaign tags") as HTMLInputElement).matches(":disabled")).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<ClassificationEditor people={[people[0]]} onClose={close} onSave={save} isSaving={false} error="" />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
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
