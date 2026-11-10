// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PasteContactsDialog, { type ParsedContact } from "../paste-contacts-dialog";
import { apiRequest } from "@/lib/queryClient";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));

const request = vi.mocked(apiRequest);
const contact: ParsedContact = {
  name: "Maya Chen",
  title: "VP of Operations",
  companyName: "Northstar Labs",
  email: "maya@example.com",
  linkedinUrl: "",
};

function mount(onImport = vi.fn().mockResolvedValue(undefined), props: { requireEmailOrLinkedin?: boolean } = {}) {
  return render(
    <PasteContactsDialog
      open
      onOpenChange={vi.fn()}
      campaignId="campaign-1"
      onImport={onImport}
      {...props}
    />,
  );
}

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue(Response.json({ contacts: [contact], warnings: ["Check the company spelling."] }));
});
afterEach(cleanup);

describe("paste contacts review", () => {
  it("parses only on request, shows warnings, allows edits and imports only selected named contacts", async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    mount(onImport);
    fireEvent.change(screen.getByLabelText("Contact text to parse"), {
      target: { value: "Maya Chen, VP of Operations at Northstar Labs" },
    });

    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Extract contacts" }));
    await screen.findByText("Check the company spelling.");
    expect(request).toHaveBeenCalledWith("POST", "/api/sales-outreach/campaigns/campaign-1/parse-contacts", {
      text: "Maya Chen, VP of Operations at Northstar Labs",
    });

    fireEvent.change(screen.getByLabelText("title for Maya Chen"), { target: { value: "Chief Operating Officer" } });
    fireEvent.click(screen.getByRole("button", { name: "Import 1 selected" }));
    await screen.findByText("Contacts added");
    expect(onImport).toHaveBeenCalledWith([{ ...contact, title: "Chief Operating Officer" }]);
    expect(request.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1);
  });

  it("clears parsed rows and selection as soon as raw text changes", async () => {
    mount();
    fireEvent.change(screen.getByLabelText("Contact text to parse"), { target: { value: "Maya Chen" } });
    fireEvent.click(screen.getByRole("button", { name: "Extract contacts" }));
    await screen.findByLabelText("email for Maya Chen");
    expect((screen.getByRole("button", { name: "Import 1 selected" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("Contact text to parse"), { target: { value: "A different raw note" } });
    expect(screen.queryByLabelText("email for Maya Chen")).toBeNull();
    expect((screen.getByRole("button", { name: "Import selected" }) as HTMLButtonElement).disabled).toBe(true);
    expect(request.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1);
  });

  it("keeps event contacts without email or LinkedIn visible but not selectable", async () => {
    request.mockResolvedValue(Response.json({
      contacts: [{ name: "Rae Morgan", title: "Director", companyName: "Fieldwork", email: "", linkedinUrl: "" }],
      warnings: [],
    }));
    mount(vi.fn().mockResolvedValue(undefined), { requireEmailOrLinkedin: true });
    fireEvent.change(screen.getByLabelText("Contact text to parse"), { target: { value: "Rae Morgan at Fieldwork" } });
    fireEvent.click(screen.getByRole("button", { name: "Extract contacts" }));
    await screen.findByText("Add an email address or LinkedIn profile before importing this event contact.");
    expect((screen.getByRole("checkbox", { name: "Select Rae Morgan" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Import selected" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("requires correction or removal of invalid edited contact details", async () => {
    mount();
    fireEvent.change(screen.getByLabelText("Contact text to parse"), { target: { value: "Maya Chen" } });
    fireEvent.click(screen.getByRole("button", { name: "Extract contacts" }));
    await screen.findByLabelText("email for Maya Chen");
    fireEvent.change(screen.getByLabelText("email for Maya Chen"), { target: { value: "bad-address" } });
    expect(screen.getByText("Enter a valid email address or leave it blank.")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Select Maya Chen" }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("email for Maya Chen"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("linkedinUrl for Maya Chen"), { target: { value: "https://example.com/not-linkedin" } });
    expect(screen.getByText("Enter a valid LinkedIn person profile URL or leave it blank.")).toBeTruthy();
  });

  it("shows a useful empty result and recovers from parse errors", async () => {
    request.mockResolvedValueOnce(Response.json({ contacts: [], warnings: ["No people were recognized."] }));
    mount();
    fireEvent.change(screen.getByLabelText("Contact text to parse"), { target: { value: "A company and product note" } });
    fireEvent.click(screen.getByRole("button", { name: "Extract contacts" }));
    await screen.findByText("No named contacts found");
    expect(screen.getByText("No people were recognized.")).toBeTruthy();

    request.mockRejectedValueOnce(new Error("Parser unavailable"));
    fireEvent.change(screen.getByLabelText("Contact text to parse"), { target: { value: "Maya Chen" } });
    fireEvent.click(screen.getByRole("button", { name: "Extract contacts" }));
    await screen.findByRole("alert");
    expect(screen.getByText("Parser unavailable")).toBeTruthy();
  });

  it("does not restore an old response after text changes during parsing", async () => {
    let finish!: (response: Response) => void;
    request.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    mount();
    fireEvent.change(screen.getByLabelText("Contact text to parse"), { target: { value: "Maya Chen" } });
    fireEvent.click(screen.getByRole("button", { name: "Extract contacts" }));
    await waitFor(() => expect(finish).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Contact text to parse"), { target: { value: "Rae Morgan" } });
    finish(Response.json({ contacts: [contact], warnings: [] }));
    await waitFor(() => expect(screen.queryByText("Review notes")).toBeNull());
    expect(screen.queryByLabelText("email for Maya Chen")).toBeNull();
    expect((screen.getByRole("button", { name: "Import selected" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
