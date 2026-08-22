// @vitest-environment jsdom
/**
 * Tests for the SocialAccountReauthBanner component exported from
 * social-accounts.tsx.
 *
 * These tests import the REAL application component so any change to the
 * banner condition, data-testid, content, or reconnect handler will cause
 * a test failure — providing an actual regression contract.
 *
 * Native vitest assertions are used throughout to avoid jest-dom type
 * configuration complexity.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  LinkedInAuthorPicker,
  LinkedInPublishingIdentity,
  resolveLinkedInPublishingIdentity,
  SocialAccountEditButton,
  SocialAccountReauthBanner,
} from "../social-accounts";

afterEach(cleanup);

const ACCOUNT_ID = "acct-linkedin-1";

describe("SocialAccountReauthBanner — conditional rendering", () => {
  it('renders the banner when lastPublishError is "needs_reauth"', () => {
    render(
      <SocialAccountReauthBanner
        account={{ id: ACCOUNT_ID, lastPublishError: "needs_reauth" }}
        onReconnect={() => {}}
      />,
    );

    expect(
      screen.getByTestId(`banner-reauth-${ACCOUNT_ID}`),
    ).not.toBeNull();
  });

  it("renders the Reconnect button inside the banner", () => {
    render(
      <SocialAccountReauthBanner
        account={{ id: ACCOUNT_ID, lastPublishError: "needs_reauth" }}
        onReconnect={() => {}}
      />,
    );

    const btn = screen.getByTestId(`button-reauth-reconnect-${ACCOUNT_ID}`);
    expect(btn).not.toBeNull();
    expect(btn.textContent?.toLowerCase()).toContain("reconnect");
  });

  it("shows 'Redirecting…' and disables the button while isPending is true", () => {
    render(
      <SocialAccountReauthBanner
        account={{ id: ACCOUNT_ID, lastPublishError: "needs_reauth" }}
        onReconnect={() => {}}
        isPending
      />,
    );

    const btn = screen.getByTestId(`button-reauth-reconnect-${ACCOUNT_ID}`);
    expect(btn.textContent?.toLowerCase()).toContain("redirecting");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("calls the onReconnect handler when the button is clicked", () => {
    const onReconnect = vi.fn();
    render(
      <SocialAccountReauthBanner
        account={{ id: ACCOUNT_ID, lastPublishError: "needs_reauth" }}
        onReconnect={onReconnect}
      />,
    );

    screen.getByTestId(`button-reauth-reconnect-${ACCOUNT_ID}`).click();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("does NOT render when lastPublishError is null", () => {
    render(
      <SocialAccountReauthBanner
        account={{ id: ACCOUNT_ID, lastPublishError: null }}
        onReconnect={() => {}}
      />,
    );

    expect(
      screen.queryByTestId(`banner-reauth-${ACCOUNT_ID}`),
    ).toBeNull();
  });

  it("does NOT render when lastPublishError is a different error string", () => {
    render(
      <SocialAccountReauthBanner
        account={{ id: ACCOUNT_ID, lastPublishError: "rate_limit_exceeded" }}
        onReconnect={() => {}}
      />,
    );

    expect(
      screen.queryByTestId(`banner-reauth-${ACCOUNT_ID}`),
    ).toBeNull();
  });

  it("does NOT render when lastPublishError is undefined", () => {
    render(
      <SocialAccountReauthBanner
        account={{ id: ACCOUNT_ID }}
        onReconnect={() => {}}
      />,
    );

    expect(
      screen.queryByTestId(`banner-reauth-${ACCOUNT_ID}`),
    ).toBeNull();
  });
});

describe("LinkedIn publishing identity", () => {
  const linkedinAccount = {
    id: ACCOUNT_ID,
    platform: "linkedin",
    accountName: "Personal name fallback",
    authorUrn: "urn:li:organization:orbit",
    authorMode: "organization" as const,
    availableAuthors: [
      { mode: "person" as const, urn: "urn:li:person:person-1", name: "Personal name" },
      { mode: "organization" as const, urn: "urn:li:organization:orbit", name: "Orbit company page" },
    ],
  };

  it("shows the currently selected company page rather than assuming a personal profile", () => {
    render(<LinkedInPublishingIdentity account={linkedinAccount} />);

    const identity = screen.getByTestId(`text-publishing-identity-${ACCOUNT_ID}`);
    expect(identity.textContent).toContain("Orbit company page");
    expect(identity.textContent).toContain("Company page");
  });

  it("resolves an authorized personal profile when that is the selected publishing identity", () => {
    expect(resolveLinkedInPublishingIdentity({
      ...linkedinAccount,
      authorUrn: "urn:li:person:person-1",
      authorMode: "person",
    })).toEqual({
      name: "Personal name",
      type: "Personal profile",
    });
  });

  it("lets an operator choose a different authorized publishing identity", async () => {
    // Radix Select scrolls its focused option into view. jsdom intentionally
    // omits this browser method, so provide the no-op browser contract needed
    // to exercise the real selection interaction.
    (HTMLElement.prototype as any).scrollIntoView = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <LinkedInAuthorPicker account={linkedinAccount} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId(`select-author-${ACCOUNT_ID}`));
    fireEvent.click(await screen.findByText("Personal name (Personal profile)"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/social-accounts/${ACCOUNT_ID}/linkedin/select-author`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ authorUrn: "urn:li:person:person-1" }),
        }),
      );
    });
    vi.unstubAllGlobals();
  });
});

describe("Social account edit access", () => {
  it("keeps the edit action visible and usable without hover, including on touch devices", () => {
    const onEdit = vi.fn();
    render(<SocialAccountEditButton accountId={ACCOUNT_ID} onEdit={onEdit} />);

    const button = screen.getByTestId(`button-edit-account-${ACCOUNT_ID}`);
    expect(button.getAttribute("class")).not.toContain("opacity-0");
    expect(button.getAttribute("aria-label")).toBe("Edit account settings");
    button.click();
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
