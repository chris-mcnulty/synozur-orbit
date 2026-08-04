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
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { SocialAccountReauthBanner } from "../social-accounts";

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
