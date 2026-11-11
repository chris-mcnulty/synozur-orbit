// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ComposeClarification, { formatClarificationText } from "../compose-clarification";
const props = {
  open: true, onOpenChange: vi.fn(), recipientName: "Example Contact", channelLabel: "Email",
  code: "OUTREACH_NEEDS_INPUT", explanation: "### **Please confirm**\n- The event details are missing.",
  questions: ["1. **When** is the event?", "- Who is `attending`?"],
  additionalContext: "", onContextChange: vi.fn(), retryError: "", isPending: false, onRetry: vi.fn(), onDiscard: vi.fn(),
};
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("compose clarification dialog", () => {
  it("owns generation failures without asking the user to correct their input", () => {
    render(<ComposeClarification {...props} code="OUTREACH_INVALID_DRAFT" explanation="Orbit could not verify its generated copy." />);
    expect(screen.getByText("Orbit could not finish this draft")).toBeTruthy();
    expect(screen.getByText(/This is not an error in your input/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("What needs attention")).toBeNull();
    expect(screen.queryByTestId("compose-clarification-questions")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry drafting" }));
    expect(props.onRetry).toHaveBeenCalledOnce();
    expect(props.onContextChange).not.toHaveBeenCalled();
  });
  it("formats markdown as readable private questions with an accessible answer area", () => {
    render(<ComposeClarification {...props} />);
    expect(screen.getByText("Clarify before drafting")).toBeTruthy();
    expect(screen.getByText("When is the event?")).toBeTruthy();
    expect(screen.getByText("Who is attending?")).toBeTruthy();
    expect(screen.getByText("Example Contact")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your private context"), { target: { value: "The event is November 18." } });
    expect(props.onContextChange).toHaveBeenCalledWith("The event is November 18.");
    expect(props.onRetry).not.toHaveBeenCalled();
  });
  it("keeps close and keep-for-later separate from explicit discard", () => {
    render(<ComposeClarification {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep for later" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onDiscard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard clarification" }));
    expect(props.onDiscard).toHaveBeenCalledTimes(1);
  });
  it("prevents accidental outside dismissal and disables dismissal during drafting", () => {
    render(<ComposeClarification {...props} isPending />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Keep for later" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Discard clarification" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
  });
  it("preserves entered answers when hidden and shown again", () => {
    function Harness() {
      const [open, setOpen] = useState(true), [answer, setAnswer] = useState("");
      return <><button onClick={() => setOpen(true)}>Resume clarification</button>
        <ComposeClarification {...props} open={open} onOpenChange={setOpen} additionalContext={answer} onContextChange={setAnswer} />
      </>;
    }
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "We are attending on Wednesday." } });
    fireEvent.click(screen.getByRole("button", { name: "Keep for later" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume clarification" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("We are attending on Wednesday.");
  });
  it("shows retry failures inline without clearing answers and retries only on a click", () => {
    render(<ComposeClarification {...props} retryError="Service temporarily unavailable" additionalContext="Confirmed date" />);
    expect(screen.getByRole("alert").textContent).toContain("Service temporarily unavailable");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Confirmed date");
    expect(props.onRetry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry drafting" }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });
  it("does not claim an unknown network outcome created no draft", () => {
    render(<ComposeClarification {...props} code="COMPOSE_FAILED" />);
    expect(screen.getByText("Drafting could not finish")).toBeTruthy();
    expect(screen.queryByText(/No draft was saved/)).toBeNull();
  });
  it("does not interpret untrusted markup and removes code fences and HTTP prefixes", () => {
    expect(formatClarificationText("422: ### **Confirm**\n```text\n1. `When?`\n```")).toBe("Confirm\n\nWhen?");
    render(<ComposeClarification {...props} explanation='<img src="x" onerror="alert(1)"> **Question**' />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByTestId("compose-clarification-explanation").textContent).toContain('<img src="x"');
  });
});
