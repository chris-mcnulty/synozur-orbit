// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LinkedMeetingContacts from "../linked-meeting-contacts";
import { defaultMeetingContact } from "@shared/conference-meetings";

const contacts = [
  { id: "current", name: "Avery Chen", companyName: "Northstar Labs", meeting: defaultMeetingContact() },
  { id: "one", name: "Morgan Lee", companyName: "Northstar Labs", meeting: defaultMeetingContact() },
  { id: "two", name: "Riley Shah", companyName: "Northstar Labs", meeting: defaultMeetingContact() },
  { id: "other", name: "Jordan Park", companyName: "Fieldstone", meeting: defaultMeetingContact() },
];

function mount(onSave: (ids: string[]) => Promise<unknown>, linkedIds = ["current", "other"]) {
  return render(<LinkedMeetingContacts currentId="current" contacts={contacts} linkedIds={linkedIds} onSave={onSave} />);
}

afterEach(cleanup);

describe("linked meeting contacts", () => {
  it("can select two people at the same company and explicitly save them", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    mount(onSave);

    fireEvent.click(screen.getByRole("checkbox", { name: "Morgan Lee, Northstar Labs" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Riley Shah, Northstar Labs" }));
    const savedChips = screen.getByText("Currently linked").parentElement?.querySelector("ul");
    expect(savedChips?.textContent).toContain("Jordan Park");
    expect(savedChips?.textContent).not.toContain("Morgan Lee");
    fireEvent.click(screen.getByRole("button", { name: "Save linked people" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(["current", "other", "one", "two"]));
  });

  it("unlinks previously linked people when unchecked", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    mount(onSave);

    fireEvent.click(screen.getByRole("checkbox", { name: "Jordan Park, Fieldstone" }));
    fireEvent.click(screen.getByRole("button", { name: "Save linked people" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(["current"]));
  });

  it("shows save errors and retains the selected contacts for retry", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Network unavailable"));
    mount(onSave);
    fireEvent.click(screen.getByRole("checkbox", { name: "Morgan Lee, Northstar Labs" }));
    fireEvent.click(screen.getByRole("button", { name: "Save linked people" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Network unavailable");
    expect((screen.getByRole("checkbox", { name: "Morgan Lee, Northstar Labs" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Avery Chen.*always included/ }) as HTMLInputElement).checked).toBe(true);
    expect(onSave).toHaveBeenCalledWith(["current", "other", "one"]);
  });

  it("always includes the current contact in the saved selection", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    mount(onSave, ["other"]);

    expect((screen.getByRole("checkbox", { name: /Avery Chen.*always included/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Avery Chen.*always included/ }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save linked people" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(["other", "current"]));
  });

  it("keeps the original meeting contact selected and locked", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<LinkedMeetingContacts currentId="current" requiredIds={["other"]} contacts={contacts} linkedIds={["current"]} onSave={onSave} />);

    const original = screen.getByRole("checkbox", { name: /Jordan Park.*original meeting contact.*always included/ }) as HTMLInputElement;
    expect(original.checked).toBe(true);
    expect(original.disabled).toBe(true);
    expect(screen.getByText(/Original meeting contact/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save linked people" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(["current", "other"]));
  });

  it("keeps saved linked chips unchanged while a selection is pending", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    mount(onSave, ["current"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Morgan Lee, Northstar Labs" }));

    const savedChips = screen.getByText("Currently linked").parentElement?.querySelector("ul");
    expect(savedChips?.textContent).toContain("Avery Chen");
    expect(savedChips?.textContent).not.toContain("Morgan Lee");
  });
});
