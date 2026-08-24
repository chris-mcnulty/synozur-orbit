import { describe, expect, it } from "vitest";
import { renderQuickNewsletterHtml } from "../quick-newsletter-layout";

describe("renderQuickNewsletterHtml", () => {
  it("turns only the supplied copy into a branded, mobile-ready email fragment", () => {
    const html = renderQuickNewsletterHtml({
      subject: "Three pieces at Airfield Estates",
      body: "Join us in Woodinville.\n\n- Three pieces\n- Through September",
      primaryColor: "#123456",
      secondaryColor: "#654321",
    });

    expect(html).toContain('width="560"');
    expect(html).toContain("#123456");
    expect(html).toContain("#654321");
    expect(html).toContain("font-size:16px");
    expect(html).toContain("Join us in Woodinville.");
    expect(html).toContain("<li");
    expect(html).not.toMatch(/About|footer|unsubscribe/i);
  });

  it("escapes the generated text instead of treating it as HTML", () => {
    const html = renderQuickNewsletterHtml({
      subject: "<Announcement>",
      body: "Read <this> first.",
    });

    expect(html).toContain("&lt;Announcement&gt;");
    expect(html).toContain("Read &lt;this&gt; first.");
    expect(html).not.toContain("<Announcement>");
  });
});