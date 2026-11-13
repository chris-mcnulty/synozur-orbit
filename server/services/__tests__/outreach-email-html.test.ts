import { afterEach, describe, expect, it, vi } from "vitest";
import { outreachEmailHtml } from "../outreach-email-html";
import { createOutlookDraft } from "../outlook-draft-service";
import { getValidGraphToken } from "../planner-graph-client";

vi.mock("../planner-graph-client", () => ({ getValidGraphToken: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

describe("HTML outreach drafts for Outlook", () => {
  it("preserves paragraphs, line breaks, Unicode and the reviewed copy", () => {
    const html = outreachEmailHtml("Hi Jane,\r\nGood to meet you.\r\n\r\nLet's catch up — at the event.\r\n\r\nAlex");
    expect(html.match(/<p /g)).toHaveLength(3);
    expect(html).toContain("Hi Jane,<br>Good to meet you.");
    expect(html).toContain("Let&#39;s catch up — at the event.");
    expect(html).toContain(">Alex</p>");
  });
  it("makes booking and other web links clickable without changing query parameters", () => {
    const html = outreachEmailHtml("Book: https://example.com/book?event=one&team=two\nMore: https://example.com/info.");
    expect(html).toContain('<a href="https://example.com/book?event=one&amp;team=two">https://example.com/book?event=one&amp;team=two</a>');
    expect(html).toContain('<a href="https://example.com/info">https://example.com/info</a>.');
  });
  it("does not swallow parentheses outside a link or remove balanced URL parentheses", () => {
    expect(outreachEmailHtml("(https://example.com/book).")).toContain('<a href="https://example.com/book">https://example.com/book</a>).');
    expect(outreachEmailHtml("https://example.com/book(team)")).toContain('href="https://example.com/book(team)"');
  });
  it("escapes markup and attribute injection rather than treating generated text as trusted HTML", () => {
    const html = outreachEmailHtml('<script>alert("x")</script>\n<img src=x onerror=alert(1)>\nhttps://example.com/" onclick="bad"\njavascript:alert(1)');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('<a href="https://example.com/">https://example.com/</a>&quot; onclick=&quot;bad&quot;');
  });
  it("does not generate a signature, tracking, images or sending behavior", () => {
    expect(outreachEmailHtml("Hi Jane")).not.toMatch(/<img|<script|signature|unsubscribe|tracking/i);
    expect(outreachEmailHtml("")).toContain('<p style="margin:0 0 12px 0;"></p>');
  });
  it("sends Graph an HTML draft, not an email send or a plain-text message", async () => {
    vi.mocked(getValidGraphToken).mockResolvedValue("fixture-token");
    const graph = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "draft-fixture", webLink: "https://outlook.office.com/drafts/fixture",
    }), { status: 201 }));
    vi.stubGlobal("fetch", graph);
    const content = outreachEmailHtml("Hi Jane,\n\nBook: https://example.com/book");
    const result = await createOutlookDraft({
      userId: "fixture-user", subject: "Meet at the event", toEmail: "fixture@example.invalid",
      body: content, contentType: "HTML",
    });
    expect(graph).toHaveBeenCalledOnce();
    expect(graph.mock.calls[0][0]).toBe("https://graph.microsoft.com/v1.0/me/messages");
    expect(JSON.parse(graph.mock.calls[0][1].body)).toEqual({
      subject: "Meet at the event", body: { contentType: "HTML", content },
      toRecipients: [{ emailAddress: { address: "fixture@example.invalid" } }],
    });
    expect(result.draftId).toBe("draft-fixture");
  });
});
