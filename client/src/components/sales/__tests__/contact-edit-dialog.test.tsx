// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ContactEditDialog, { initialContactSettings, reviewedContactSettings, type EditableCampaignContact } from "../contact-edit-dialog";
import NewProspectClassification, { newProspectClassificationPayload, type NewProspectClassificationValue } from "../new-prospect-classification";
import ContactMeetingIndicator, { scheduledMeetingLabel } from "../contact-meeting-indicator";
import { defaultMeetingContact } from "@shared/conference-meetings";

const person: EditableCampaignContact = {
  id: "maya", name: "Maya Chen", title: "Director", companyName: "Cedar Systems", email: "maya@example.com", linkedinUrl: "",
  classification: { tags: ["personal", "priority"], eventRoles: ["speaker"], sourceDetail: "Met at roundtable", meetingPriority: "requested_meeting" },
  meeting: { ...defaultMeetingContact(), relationships: ["partner"], attendance: "confirmed", attendanceEvidence: "Registration list" },
  messagingGroup: "partner", familiarity: "known",
};
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("one reviewed contact editing flow", () => {
  it("preselects the partner brief without turning an unchanged default into a manual override", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ContactEditDialog contact={{ ...person, messagingGroup: null,
      meeting: { ...person.meeting!, relationships: ["partner", "prospect"] } }} onClose={vi.fn()} onSave={onSave} />);
    expect((screen.getByLabelText("Messaging group") as HTMLSelectElement).value).toBe("partner");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).not.toHaveProperty("messagingGroup");
  });
  it("keeps an explicitly cleared default cleared after reopening and saves deliberate removal", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ContactEditDialog contact={{ ...person, messagingGroup: null,
      signals: { messagingGroupCleared: true } }} onClose={vi.fn()} onSave={onSave} />);
    expect((screen.getByLabelText("Messaging group") as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Messaging group"), { target: { value: "partner" } });
    fireEvent.change(screen.getByLabelText("Messaging group"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ messagingGroup: null })));
  });
  it("prefills all existing values and saves shared details plus full campaign settings once", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ContactEditDialog contact={person} onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByRole("heading", { name: "Edit contact" })).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(person.name);
    expect((screen.getByLabelText("Attendance evidence") as HTMLInputElement).value).toBe("Registration list");
    expect(screen.getByRole("button", { name: "Partner" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("checkbox", { name: /Personal friendship/ }).getAttribute("data-state")).toBe("unchecked");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Chief Operating Officer" } });
    fireEvent.change(screen.getByLabelText("Campaign tags"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Speaker" }));
    fireEvent.click(screen.getByRole("button", { name: "Partner" }));
    fireEvent.change(screen.getByLabelText("Source detail"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Attendance evidence"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Messaging group"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Personal friendship/ }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      name: "Maya Chen", title: "Chief Operating Officer", companyName: "Cedar Systems", email: "maya@example.com", linkedinUrl: "",
      classification: { tags: [], tagsMode: "replace", eventRoles: [], sourceDetail: "", meetingPriority: "requested_meeting", relationships: ["unknown"], attendance: "confirmed", attendanceEvidence: "" },
      messagingGroup: null, familiarity: "personal_friend",
    });
  });

  it("resets unsaved fields and classification on reopening or keyed contact changes", () => {
    const props = { onClose: vi.fn(), onSave: vi.fn() };
    const { rerender } = render(<ContactEditDialog key="tenant:maya" contact={person} {...props} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Unsaved" } });
    fireEvent.change(screen.getByLabelText("Campaign tags"), { target: { value: "unsaved-tag" } });
    rerender(<></>);
    rerender(<ContactEditDialog key="tenant:maya" contact={person} {...props} />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(person.name);
    expect((screen.getByLabelText("Campaign tags") as HTMLInputElement).value).toBe("personal,priority");
    rerender(<ContactEditDialog key="other-tenant:rae" contact={{ ...person, id: "rae", name: "Rae Morgan", classification: null, familiarity: "unknown" }} {...props} />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Rae Morgan");
    expect((screen.getByLabelText("Campaign tags") as HTMLInputElement).value).toBe("");
  });

  it("retains reviewed edits on a failed save and retries only when asked", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("503: Save unavailable")).mockResolvedValue(undefined);
    render(<ContactEditDialog contact={person} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Campaign tags"), { target: { value: "reviewed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Save unavailable");
    expect((screen.getByLabelText("Campaign tags") as HTMLInputElement).value).toBe("reviewed");
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  });

  it("keeps create/import omission semantics separate from explicit edit clearing", () => {
    expect(newProspectClassificationPayload({ classification: { tags: [], sourceDetail: "", eventRoles: [] } })).toEqual({});
    expect(reviewedContactSettings({ classification: { tags: [], sourceDetail: "", eventRoles: [] } })).toMatchObject({
      classification: { tags: [], tagsMode: "replace", eventRoles: [], sourceDetail: "", relationships: ["unknown"] }, messagingGroup: null, familiarity: "unknown",
    });
    expect(initialContactSettings(person)).toMatchObject({ classification: { attendance: "confirmed", meetingPriority: "requested_meeting" }, familiarity: "known" });
  });
});

describe("explicit personal friendship", () => {
  it("does not infer friendship from tags; writes the tone-facing enum and clears it when unchecked", () => {
    let latest: NewProspectClassificationValue = {};
    function Form() {
      const [value, setValue] = useState(initialContactSettings(person));
      latest = value;
      return <NewProspectClassification mode="edit" value={value} onChange={setValue} />;
    }
    render(<Form />);
    const toggle = () => screen.getByRole("checkbox", { name: /Personal friendship/ });
    expect(toggle().getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(toggle());
    expect(reviewedContactSettings(latest).familiarity).toBe("personal_friend");
    expect((screen.getByLabelText("Familiarity") as HTMLSelectElement).value).toBe("personal_friend");
    fireEvent.click(toggle());
    expect(reviewedContactSettings(latest).familiarity).toBe("unknown");
    expect(latest.classification?.tags).toContain("personal");
    fireEvent.change(screen.getByLabelText("Familiarity"), { target: { value: "known" } });
    expect(toggle().getAttribute("data-state")).toBe("unchecked");
    expect(reviewedContactSettings(latest).familiarity).toBe("known");
  });
});

describe("main directory meeting indicator", () => {
  const booked = { ...defaultMeetingContact(), stage: "meeting_booked" as const, meetingAt: "2026-08-13T15:30:00Z", meetingOwner: "Maya Chen" };
  it("shows booked date/time and explicit timezone, and opens meeting review", () => {
    const onOpen = vi.fn();
    render(<ContactMeetingIndicator meeting={booked} timezone="Europe/London" onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: /Meeting booked/ });
    expect(button.textContent).toContain("2026");
    expect(button.textContent).toContain("Europe/London");
    expect(button.textContent).toMatch(/4:30|16:30/);
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it("labels local time or missing dates explicitly rather than inventing a schedule", () => {
    expect(scheduledMeetingLabel(booked)).toContain("your local time");
    expect(scheduledMeetingLabel({ ...booked, meetingAt: "" })).toBe("Meeting booked · date needed");
    expect(scheduledMeetingLabel({ ...booked, meetingAt: "invalid" })).toBe("Meeting booked · date needed");
  });
  it("does not call draft times, priority requests, follow-up stages or source proposals booked", () => {
    expect(scheduledMeetingLabel(null)).toBeNull();
    expect(scheduledMeetingLabel({ ...booked, stage: "shortlisted" })).toBeNull();
    expect(scheduledMeetingLabel({ ...booked, stage: "replied" })).toBeNull();
    expect(scheduledMeetingLabel({ ...booked, stage: "follow_up" })).toBeNull();
    const { container } = render(<ContactMeetingIndicator meeting={defaultMeetingContact()} onOpen={vi.fn()} />);
    expect(container.childElementCount).toBe(0);
  });
  it("never labels a cancelled invitation as a booked appointment", () => {
    expect(scheduledMeetingLabel(booked, "Europe/London", "cancelled")).toBe("Calendar invitation cancelled · review meeting");
    expect(scheduledMeetingLabel({ ...booked, calendarInvitation: { status: "cancelled" } })).toBe("Calendar invitation cancelled · review meeting");
  });
});
