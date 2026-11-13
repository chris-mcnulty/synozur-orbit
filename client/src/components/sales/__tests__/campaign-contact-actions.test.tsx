// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CampaignContactActions from "../campaign-contact-actions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

afterEach(cleanup);

describe("compact contact action menu", () => {
  it("opens a menu containing the Compose submenu and allows editing", () => {
    const edit = vi.fn();
    render(<DropdownMenu defaultOpen><DropdownMenuTrigger asChild><Button>Contact actions</Button></DropdownMenuTrigger>
      <DropdownMenuContent><CampaignContactActions>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger asChild><Button data-testid="compose-contact"><span>Compose</span><span aria-hidden>▾</span></Button></DropdownMenuSubTrigger>
          <DropdownMenuSubContent><DropdownMenuItem>Outreach</DropdownMenuItem></DropdownMenuSubContent>
        </DropdownMenuSub>
        <Button onClick={edit}>Edit contact</Button>
      </CampaignContactActions></DropdownMenuContent>
    </DropdownMenu>);
    expect(screen.getByRole("menuitem", { name: "Compose" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Compose" }), { key: "ArrowRight" });
    expect(screen.getByRole("menuitem", { name: "Outreach" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Outreach" }), { key: "ArrowLeft" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit contact" }));
    expect(edit).toHaveBeenCalledOnce();
  });
  it("preserves every supplied action handler and test id while exposing menu semantics", () => {
    const handlers = Array.from({ length: 8 }, () => vi.fn());
    const labels = ["History & hold", "Saved drafts", "Dossier", "Research", "Find contact details", "Add to HubSpot", "Edit contact details", "Remove prospect"];
    render(<DropdownMenu open><DropdownMenuTrigger asChild><Button>Contact actions</Button></DropdownMenuTrigger>
      <DropdownMenuContent><CampaignContactActions>{labels.map((label, index) => <Button key={label} data-testid={`action-${index}`} onClick={handlers[index]}>{label}</Button>)}</CampaignContactActions></DropdownMenuContent>
    </DropdownMenu>);
    labels.forEach((label, index) => {
      expect(screen.getByRole("menuitem", { name: label }).getAttribute("data-testid")).toBe(`action-${index}`);
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Saved drafts" }));
    expect(handlers[1]).toHaveBeenCalledOnce();
    expect(handlers[0]).not.toHaveBeenCalled();
  });
  it("does not expose forbidden actions and retains disabled pending states", () => {
    render(<DropdownMenu open><DropdownMenuTrigger asChild><Button>Contact actions</Button></DropdownMenuTrigger>
      <DropdownMenuContent><CampaignContactActions><Button hidden>Restricted action</Button><Button disabled>Researching</Button></CampaignContactActions></DropdownMenuContent>
    </DropdownMenu>);
    expect(screen.queryByRole("menuitem", { name: "Restricted action" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Researching" }).getAttribute("aria-disabled")).toBe("true");
  });
});
