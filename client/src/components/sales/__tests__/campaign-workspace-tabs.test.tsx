// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CampaignWorkspaceTabs, { type CampaignWorkspaceTab } from "../campaign-workspace-tabs";
afterEach(cleanup);

const sections = ["overview", "prospects", "meetings", "setup", "next-steps"] as const;
function Workspace() {
  const [tab, setTab] = useState<CampaignWorkspaceTab>("prospects");
  return <>
    <CampaignWorkspaceTabs value={tab} onChange={setTab} />
    {sections.map(section => <section key={section} id={`campaign-panel-${section}`}
      role="tabpanel" aria-labelledby={`campaign-tab-${section}`} hidden={section !== tab}>
      {section === "setup" ? <input aria-label="Unsaved setup" /> : section}
    </section>)}
  </>;
}

describe("separate campaign work areas", () => {
  it("starts with Prospects and shows only the selected work area", () => {
    render(<Workspace />);
    expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Overview", "Prospects", "Meetings", "Setup", "Next Steps"]);
    expect(screen.getByRole("tab", { name: "Prospects" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    for (const label of ["Overview", "Meetings", "Setup", "Next Steps", "Prospects"]) {
      fireEvent.click(screen.getByRole("tab", { name: label }));
      expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
      expect(screen.getByRole("tabpanel", { name: label })).toBeTruthy();
    }
  });
  it("retains unsaved input while switching between work areas", () => {
    render(<Workspace />);
    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
    fireEvent.change(screen.getByLabelText("Unsaved setup"), { target: { value: "Keep my availability" } });
    fireEvent.click(screen.getByRole("tab", { name: "Meetings" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
    expect((screen.getByLabelText("Unsaved setup") as HTMLInputElement).value).toBe("Keep my availability");
  });
  it("supports arrow, Home and End keys with focus following selection", () => {
    render(<Workspace />);
    const prospect = screen.getByRole("tab", { name: "Prospects" });
    prospect.focus();
    fireEvent.keyDown(prospect, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Meetings" }));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Next Steps" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Next Steps" }));
    expect(screen.getByRole("tabpanel", { name: "Next Steps" })).toBeTruthy();
  });
});
