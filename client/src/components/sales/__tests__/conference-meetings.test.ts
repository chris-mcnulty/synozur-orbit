import { describe, expect, it } from "vitest";
import { parseExternal, wallTimeToIso } from "../conference-meetings";

describe("conference meeting external contact preview", () => {
  it("keeps quoted commas and line breaks, and recognizes Wiza export aliases", () => {
    const [contact, businessEmailContact] = parseExternal(
      'Name,Work Email,Current Company,Title,LinkedIn Profile URL\r\n"Ada, Lin","ada@example.com","Northstar,\nInc.","VP, Partnerships","https://www.linkedin.com/in/ada-lin"\r\nRin,business@example.com,,,https://www.linkedin.com/in/rin-profile\r\n',
    );

    expect(contact).toMatchObject({
      name: "Ada, Lin",
      email: "ada@example.com",
      companyName: "Northstar,\nInc.",
      title: "VP, Partnerships",
      linkedinUrl: "https://www.linkedin.com/in/ada-lin",
      valid: true,
      issue: "",
    });
    expect(businessEmailContact).toMatchObject({ email: "business@example.com", valid: true });
  });

  it("requires an email or a valid LinkedIn person profile URL", () => {
    const [missing, validProfile, invalidProfile] = parseExternal(
      "Name,Email,LinkedIn Profile URL\nRae,,\nSam,,https://www.linkedin.com/in/sam-profile\nPat,,https://www.linkedin.com/company/example\n",
    );

    expect(missing.valid).toBe(false);
    expect(missing.issue).toContain("email or a LinkedIn profile URL");
    expect(validProfile.valid).toBe(true);
    expect(invalidProfile.valid).toBe(false);
    expect(invalidProfile.issue).toContain("valid LinkedIn person profile URL");
  });

  it("keeps malformed records in preview as invalid instead of dropping them", () => {
    const [malformed] = parseExternal('Name,Email,LinkedIn Profile URL\n"Unclosed name,rae@example.com,\n');
    expect(malformed.valid).toBe(false);
    expect(malformed.issue).toContain("not closed");
  });

  it("rejects nonexistent wall-clock meeting times during a DST transition", () => {
    expect(() => wallTimeToIso("2025-03-09T02:30", "America/New_York")).toThrow(/does not exist.*daylight-saving/i);
    expect(wallTimeToIso("2025-03-09T03:30", "America/New_York")).toMatch(/-04:00$/);
  });
});
