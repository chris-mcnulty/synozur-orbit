// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import NewProspectDialog from "../new-prospect-dialog";

afterEach(cleanup);
const props = () => ({ canSubmit: true, saving: false, onSubmit: vi.fn(), onClose: vi.fn() });
const fields = <label>Name<input aria-label="Name" defaultValue="Jane" /></label>;

describe("visible prospect entry", () => {
  it("opens as an accessible dialog and focuses entry instead of a distant page section", async () => {
    render(<NewProspectDialog {...props()}>{fields}</NewProspectDialog>);
    expect(screen.getByRole("dialog", { name: "New prospect" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Name" })));
  });
  it("submits through the form without navigating away", () => {
    const handlers = props();
    render(<NewProspectDialog {...handlers}>{fields}</NewProspectDialog>);
    fireEvent.submit(screen.getByRole("form", { name: "Add prospect" }));
    expect(handlers.onSubmit).toHaveBeenCalledOnce();
  });
  it("blocks invalid submissions and lets the user cancel", () => {
    const handlers = props();
    render(<NewProspectDialog {...handlers} canSubmit={false}>{fields}</NewProspectDialog>);
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("form", { name: "Add prospect" }));
    expect(handlers.onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });
  it("shows save errors beside the form without losing entered contact details", () => {
    const handlers = props();
    const { rerender } = render(<NewProspectDialog {...handlers}>{fields}</NewProspectDialog>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Jane Smith" } });
    rerender(<NewProspectDialog {...handlers} error="Could not save; retry.">{fields}</NewProspectDialog>);
    expect(screen.getByRole("alert").textContent).toBe("Could not save; retry.");
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Jane Smith");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(handlers.onSubmit).toHaveBeenCalledOnce();
  });
  it("prevents duplicate submission and closing during a save", () => {
    const handlers = props();
    render(<NewProspectDialog {...handlers} saving>{fields}</NewProspectDialog>);
    expect((screen.getByRole("button", { name: "Adding…" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("form", { name: "Add prospect" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(handlers.onSubmit).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });
});
