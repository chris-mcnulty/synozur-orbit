import { describe, it, expect } from "vitest";
import { constrainEmailImages } from "../email-image-layout";

describe("email image layout", () => {
  it("constrains a native-size image using inline CSS and an Outlook width", () => {
    const result = constrainEmailImages('<img src="https://example.com/large.jpg">');
    expect(result).toContain('width="560"');
    expect(result).toContain("width:560px;max-width:100%;height:auto;");
  });

  it("caps oversized width and removes fixed height without removing other styling", () => {
    const result = constrainEmailImages('<img src="/hero.jpg" width="2400" height="1600" style="width:2400px;height:1600px;margin:8px 0;border-radius:6px">');
    expect(result).toContain('width="560"');
    expect(result).not.toContain('height="');
    expect(result).not.toContain("1600px");
    expect(result).toContain("margin:8px 0;border-radius:6px;");
  });

  it("preserves small logos and section images", () => {
    expect(constrainEmailImages('<img src="/logo.png" width="96">')).toContain("width:96px");
    const section = constrainEmailImages('<img src="/card.png" width="220" style="width:100%;max-width:220px;height:auto">');
    expect(section).toContain('width="220"');
    expect(section).toContain("width:220px;max-width:100%");
  });

  it("preserves percentage widths below 100 and respects small CSS limits", () => {
    expect(constrainEmailImages('<img src="/a" style="width:50%;max-width:200px">')).toContain("width:50%;max-width:200px;");
  });

  it("works in full documents and is idempotent", () => {
    const original = '<!DOCTYPE html><html><body><img alt="one > two" src="/a" style="width:100%;max-width:220px"></body></html>';
    const once = constrainEmailImages(original);
    expect(constrainEmailImages(once)).toBe(once);
    expect(once).toContain('alt="one > two"');
    expect(once).toContain("</body></html>");
  });
});
