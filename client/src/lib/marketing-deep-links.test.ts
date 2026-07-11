import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { itemDeepLinkHref } from "./marketing-deep-links";

describe("itemDeepLinkHref", () => {
  it("returns undefined when the item id is missing", () => {
    expect(itemDeepLinkHref({ itemType: "brief", itemId: "" })).toBeUndefined();
  });

  describe("brief", () => {
    it("links to the editorial calendar with just the brief param", () => {
      expect(itemDeepLinkHref({ itemType: "brief", itemId: "b1" })).toBe(
        "/app/marketing/editorial-calendar?brief=b1",
      );
    });

    it("includes the campaignId when provided", () => {
      expect(
        itemDeepLinkHref({ itemType: "brief", itemId: "b1", campaignId: "c9" }),
      ).toBe("/app/marketing/editorial-calendar?campaignId=c9&brief=b1");
    });

    it("includes the calendar id when provided", () => {
      expect(
        itemDeepLinkHref({ itemType: "brief", itemId: "b1", calendarId: "cal7" }),
      ).toBe("/app/marketing/editorial-calendar?calendar=cal7&brief=b1");
    });

    it("includes both calendar and campaign ids when provided", () => {
      expect(
        itemDeepLinkHref({
          itemType: "brief",
          itemId: "b1",
          calendarId: "cal7",
          campaignId: "c9",
        }),
      ).toBe(
        "/app/marketing/editorial-calendar?calendar=cal7&campaignId=c9&brief=b1",
      );
    });

    it("ignores null campaign / calendar ids", () => {
      expect(
        itemDeepLinkHref({
          itemType: "brief",
          itemId: "b1",
          calendarId: null,
          campaignId: null,
        }),
      ).toBe("/app/marketing/editorial-calendar?brief=b1");
    });
  });

  describe("email", () => {
    it("links to the email newsletters page with the emailId param", () => {
      expect(itemDeepLinkHref({ itemType: "email", itemId: "e42" })).toBe(
        "/app/marketing/email-newsletters?emailId=e42",
      );
    });

    it("url-encodes the email id", () => {
      expect(itemDeepLinkHref({ itemType: "email", itemId: "a b/c" })).toBe(
        "/app/marketing/email-newsletters?emailId=a%20b%2Fc",
      );
    });
  });

  describe("social", () => {
    it("links to the campaign Social Posts tab when a campaign is known", () => {
      expect(
        itemDeepLinkHref({ itemType: "social", itemId: "p5", campaignId: "c9" }),
      ).toBe("/app/marketing/campaigns/c9?post=p5#posts");
    });

    it("url-encodes both campaign id and post id in the campaign link", () => {
      expect(
        itemDeepLinkHref({
          itemType: "social",
          itemId: "p/5",
          campaignId: "c 9",
        }),
      ).toBe("/app/marketing/campaigns/c%209?post=p%2F5#posts");
    });

    it("falls back to the Master Social Calendar when no campaign is known", () => {
      expect(itemDeepLinkHref({ itemType: "social", itemId: "p5" })).toBe(
        "/app/marketing/calendar?post=p5",
      );
    });

    it("adds the date param on the Master Social Calendar link", () => {
      expect(
        itemDeepLinkHref({
          itemType: "social",
          itemId: "p5",
          date: "2026-07-03",
        }),
      ).toBe("/app/marketing/calendar?post=p5&date=2026-07-03");
    });

    it("prefers the campaign link even when a date is present", () => {
      expect(
        itemDeepLinkHref({
          itemType: "social",
          itemId: "p5",
          campaignId: "c9",
          date: "2026-07-03",
        }),
      ).toBe("/app/marketing/campaigns/c9?post=p5#posts");
    });
  });
});

/**
 * Regression guard: the deep-link helper builds URLs with a fixed set of query
 * params, and the landing behavior only works if each target page still reads
 * the matching param. A rename/refactor on a page would silently break the
 * landing with no compile error — these checks fail loudly instead.
 */
describe("target pages still read their deep-link params", () => {
  const pagesDir = path.resolve(
    import.meta.dirname,
    "..",
    "pages",
    "app",
    "marketing",
  );
  const read = (file: string) =>
    readFileSync(path.join(pagesDir, file), "utf8");

  it("editorial-calendar passes paramName: \"brief\" to useDeepLinkFocus and reads ?campaignId=", () => {
    const src = read("editorial-calendar.tsx");
    // The ?brief= param is read inside useDeepLinkFocus via the paramName option.
    // Renaming the string here OR in the hook's URLSearchParams call breaks the
    // render-level test in use-deep-link-focus.test.tsx.
    expect(src).toContain('paramName: "brief"');
    // ?campaignId= is still read inline (separate campaign-filter state).
    expect(src).toContain('.get("campaignId")');
  });

  it("email-newsletters passes paramName: \"emailId\" to useDeepLinkFocus", () => {
    const src = read("email-newsletters.tsx");
    expect(src).toContain('paramName: "emailId"');
  });

  it("calendar (Master Social Calendar) passes paramName: \"post\" to useDeepLinkFocus and reads ?date=", () => {
    const src = read("calendar.tsx");
    expect(src).toContain('paramName: "post"');
    expect(src).toContain('.get("date")');
  });

  it("campaign-detail passes paramName: \"post\" to useDeepLinkFocus and preReveal activates the posts tab", () => {
    const src = read("campaign-detail.tsx");
    // The ?post= param is read inside useDeepLinkFocus via paramName: "post".
    // Renaming the string here OR in the hook's URLSearchParams call breaks the
    // render-level test in use-deep-link-focus.test.tsx.
    expect(src).toContain('paramName: "post"');
    // The preReveal callback must switch to the posts tab BEFORE the DOM is
    // queried, so the card element exists when the hook tries to scroll to it.
    // Removing preReveal or moving the tab-switch to onFound (which fires
    // AFTER the scroll) would silently break deep-links to posts in other tabs.
    expect(src).toContain("preReveal");
    expect(src).toContain('setActiveTab("posts")');
  });
});
