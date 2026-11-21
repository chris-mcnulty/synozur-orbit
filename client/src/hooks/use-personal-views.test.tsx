// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { usePersonalViews } from "./use-personal-views";
import { PersonalViewControls } from "@/components/personal-view-controls";
import { marketingCampaignViewSchema, marketingCampaignViewDefaults, prospectViewSchema, prospectViewDefaults, calendarViewSchema, calendarViewDefaults, outreachCampaignViewSchema } from "@/lib/personal-view-schemas";
import { emptyViews, viewStorageKey } from "@/lib/personal-views";

const env = vi.hoisted(() => ({ user: "user-one", tenant: "tenant-one", market: "market-one", search: "" }));
vi.mock("@/lib/userContext", () => ({ useUser: () => ({ user: env.user ? { id: env.user } : null }) }));
vi.mock("@/lib/tabContext", () => ({
  getTabContextSnapshot: () => JSON.stringify([env.tenant, env.market]),
  subscribeTabContext: () => () => {},
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: { activeTenantId: env.tenant, activeMarketId: env.market } }) }));
vi.mock("wouter", () => ({ useSearch: () => env.search }));
function key(surface = "marketing-campaigns", campaignId?: string) {
  return viewStorageKey({ userId: env.user, tenantId: env.tenant, marketId: env.market, surface, campaignId });
}
function CampaignHarness({ campaignId }: { campaignId?: string }) {
  const model = usePersonalViews({ surface: "marketing-campaigns", campaignId, schema: marketingCampaignViewSchema, defaults: marketingCampaignViewDefaults });
  const [query, setQuery] = model.field("campaignSearch");
  const [editor, setEditor] = useState("");
  return <>
    <PersonalViewControls model={model} />
    <input aria-label="Campaign search" value={query} onChange={e => setQuery(e.target.value)} />
    <input aria-label="Unsaved campaign editor" value={editor} onChange={e => setEditor(e.target.value)} />
    <button onClick={() => model.dispatch({ type: "reset" })}>Reset filters</button>
    <button onClick={() => model.dispatch({ type: "apply", id: model.activeId! })}>Apply current view</button>
    <button onClick={() => model.dispatch({ type: "update", id: model.activeId! })}>Update current view</button>
    <button onClick={() => model.dispatch({ type: "rename", id: model.activeId!, name: "Renamed" })}>Rename current view</button>
    <button onClick={() => model.dispatch({ type: "delete", id: model.activeId! })}>Delete current view</button>
  </>;
}
function input(name: string) { return screen.getByLabelText(name) as HTMLInputElement; }
function change(name: string, value: string) { fireEvent.change(input(name), { target: { value } }); }
function save(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Save view" }));
  change("View name", name);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}
beforeEach(() => {
  Object.assign(env, { user: "user-one", tenant: "tenant-one", market: "market-one", search: "" });
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("personal view interactions and restoration", () => {
  it("names, applies, updates, renames, deletes and resets views while preserving unrelated unsaved input", () => {
    render(<CampaignHarness />);
    change("Unsaved campaign editor", "Keep this draft");
    change("Campaign search", "Launch");
    save("My launch");
    expect(screen.getByRole("option", { name: "My launch" })).toBeTruthy();
    change("Campaign search", "Other");
    expect(screen.getByText("Modified")).toBeTruthy();
    fireEvent.click(screen.getByText("Apply current view"));
    expect(input("Campaign search").value).toBe("Launch");
    change("Campaign search", "Updated");
    fireEvent.click(screen.getByText("Update current view"));
    expect(screen.queryByText("Modified")).toBeNull();
    fireEvent.click(screen.getByText("Rename current view"));
    expect(screen.getByRole("option", { name: "Renamed" })).toBeTruthy();
    fireEvent.click(screen.getByText("Reset filters"));
    expect(input("Campaign search").value).toBe("");
    fireEvent.change(screen.getByLabelText("Personal saved view"), { target: { value: JSON.parse(localStorage.getItem(key())!).views[0].id } });
    expect(input("Campaign search").value).toBe("Updated");
    fireEvent.click(screen.getByText("Delete current view"));
    expect(screen.queryByRole("option", { name: "Renamed" })).toBeNull();
    expect(input("Unsaved campaign editor").value).toBe("Keep this draft");
    expect(input("Campaign search").value).toBe("Updated"); // delete isn't reset
  });
  it("restores last-used state after remount and remembers an explicit reset", () => {
    const mount = render(<CampaignHarness />);
    change("Campaign search", "Resume me");
    mount.unmount();
    const again = render(<CampaignHarness />);
    expect(input("Campaign search").value).toBe("Resume me");
    fireEvent.click(screen.getByText("Reset filters"));
    again.unmount();
    render(<CampaignHarness />);
    expect(input("Campaign search").value).toBe("");
  });
  it("supports rename, update, delete confirmation and reset through the compact menu", async () => {
    render(<CampaignHarness />);
    change("Campaign search", "Original");
    save("Original view");
    async function menu(item: string) {
      fireEvent.keyDown(screen.getByRole("button", { name: "Manage saved view" }), { key: "Enter" });
      fireEvent.click(await screen.findByRole("menuitem", { name: item }));
    }
    await menu("Rename view");
    change("View name", "Renamed through menu");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("option", { name: "Renamed through menu" })).toBeTruthy();
    change("Campaign search", "Updated through menu");
    await menu("Update view");
    expect(screen.queryByText("Modified")).toBeNull();
    await menu("Reset to defaults");
    expect(input("Campaign search").value).toBe("");
    const id = JSON.parse(localStorage.getItem(key())!).views[0].id;
    fireEvent.change(screen.getByLabelText("Personal saved view"), { target: { value: id } });
    expect(input("Campaign search").value).toBe("Updated through menu");
    await menu("Delete view");
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("option", { name: "Renamed through menu" })).toBeTruthy();
    await menu("Delete view");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("option", { name: "Renamed through menu" })).toBeNull();
    expect(input("Campaign search").value).toBe("Updated through menu");
  });
  it.each(["user", "tenant", "market", "campaign"] as const)("isolates %s switches without writing previous search into the new context", dimension => {
    let campaignId = "campaign-one";
    const mount = render(<CampaignHarness campaignId={campaignId} />);
    change("Campaign search", "Only the original context");
    const oldKey = key("marketing-campaigns", campaignId);
    if (dimension === "campaign") campaignId = "campaign-two";
    else env[dimension] = `${dimension}-two`;
    mount.rerender(<CampaignHarness campaignId={campaignId} />);
    expect(input("Campaign search").value).toBe("");
    change("Campaign search", "Only the second context");
    expect(JSON.parse(localStorage.getItem(oldKey)!).last.campaignSearch).toBe("Only the original context");
    if (dimension === "campaign") campaignId = "campaign-one";
    else env[dimension] = `${dimension}-one`;
    mount.rerender(<CampaignHarness campaignId={campaignId} />);
    expect(input("Campaign search").value).toBe("Only the original context");
  });
  it("gives URL filters priority on mount, URL navigation, and explicit saved-view application", () => {
    const mount = render(<CampaignHarness />);
    change("Campaign search", "Remembered");
    save("Remembered view");
    env.search = "?q=URL&status=active";
    mount.rerender(<CampaignHarness />);
    expect(input("Campaign search").value).toBe("URL");
    fireEvent.click(screen.getByText("Apply current view"));
    expect(input("Campaign search").value).toBe("URL");
    mount.unmount();
    render(<CampaignHarness />);
    expect(input("Campaign search").value).toBe("URL");
  });
  it("reports invalid explicit URL filters rather than silently accepting them", () => {
    env.search = "?status=removed-status";
    render(<CampaignHarness />);
    expect(screen.getByRole("status").textContent).toContain("reset");
    expect(JSON.parse(localStorage.getItem(key())!).last.statusFilter).toBe("all");
  });
  it("clears remembered search for a prospect item deep link without opening or running anything", () => {
    function ProspectHarness() {
      const model = usePersonalViews({ surface: "prospects", campaignId: "c", schema: prospectViewSchema(), defaults: prospectViewDefaults });
      const [query, setQuery] = model.field("searchQ");
      return <input aria-label="Prospect search" value={query} onChange={e => setQuery(e.target.value)} />;
    }
    const mount = render(<ProspectHarness />);
    change("Prospect search", "Hidden contact");
    env.search = "?prospect=p&draft=d";
    mount.rerender(<ProspectHarness />);
    expect(input("Prospect search").value).toBe("");
    const stored = localStorage.getItem(key("prospects", "c"))!;
    expect(stored).not.toContain('"draft"');
    expect(stored).not.toContain('"prospect"');
  });
  it("prunes calendar references after options load and visibly reports removed filters", () => {
    const stale = { ...calendarViewDefaults, view: "backlog" as const, typeFilter: "social:deleted",
      filters: { ...calendarViewDefaults.filters, campaignId: "deleted" } };
    localStorage.setItem(key("calendar"), JSON.stringify(emptyViews(stale)));
    function CalendarHarness({ loaded }: { loaded: boolean }) {
      const model = usePersonalViews({ surface: "calendar", schema: calendarViewSchema(loaded ? { campaigns: [], solutionAreas: [], conferences: [] } : undefined), defaults: calendarViewDefaults });
      return <><PersonalViewControls model={model} /><output data-testid="calendar-state">{JSON.stringify(model.state)}</output></>;
    }
    const mount = render(<CalendarHarness loaded={false} />);
    expect(screen.getByTestId("calendar-state").textContent).toContain("deleted");
    mount.rerender(<CalendarHarness loaded />);
    expect(screen.getByTestId("calendar-state").textContent).not.toContain("deleted");
    expect(screen.getByTestId("calendar-state").textContent).toContain("backlog");
    expect(screen.getByText("Unavailable or invalid saved filters were reset.")).toBeTruthy();
  });
  it("handles read and write failures visibly and keeps filters usable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    render(<CampaignHarness />);
    expect(screen.getByRole("status").textContent).toContain("unavailable");
    change("Campaign search", "Still usable");
    expect(input("Campaign search").value).toBe("Still usable");
  });
  it("shows corrupt-version recovery without losing named-view controls", () => {
    localStorage.setItem(key(), JSON.stringify({ version: 999 }));
    render(<CampaignHarness />);
    expect(screen.getByRole("status").textContent).toContain("could not be read");
    change("Campaign search", "Recovered");
    save("New view");
    expect(screen.getByRole("option", { name: "New view" })).toBeTruthy();
  });
  it("supports the outreach list's current fixed default view without inventing filters", () => {
    function OutreachHarness() {
      const model = usePersonalViews({ surface: "outreach-campaigns", schema: outreachCampaignViewSchema, defaults: {} });
      return <PersonalViewControls model={model} />;
    }
    render(<OutreachHarness />);
    save("My campaigns");
    expect(JSON.parse(localStorage.getItem(key("outreach-campaigns"))!).views[0].state).toEqual({});
    expect(screen.getByText("Personal · this browser only")).toBeTruthy();
  });
  it("does not load or save while signed out", () => {
    env.user = "";
    render(<CampaignHarness />);
    expect((screen.getByRole("button", { name: "Save view" }) as HTMLButtonElement).disabled).toBe(true);
    expect(localStorage.length).toBe(0);
  });
});
