import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLinkedInAuthor } from "../linkedin-author-identity";

vi.mock("../platform-credentials-service", () => ({
  getPlatformCredentials: async () => ({ clientId: "test-id", clientSecret: "test-secret" }),
  isLinkedInDirectPublishEnabled: () => true,
}));
vi.mock("../linkedin-provider", () => ({ isLinkedInMcpConfigured: () => false }));
vi.mock("../linkedin-mcp-client", () => ({ callLinkedInTool: vi.fn(), extractText: vi.fn() }));
vi.mock("../../utils/encryption", () => ({ decryptSecret: () => "test-token" }));
vi.mock("../sharepoint-graph-client.js", () => ({ GraphClient: class {} }));

import { getPublisher } from "../social-publishers";

afterEach(() => vi.restoreAllMocks());

const account: any = {
  id: "personal-account", platform: "linkedin", authorMode: "person",
  authorUrn: null, accountId: "urn:li:person:verified-member",
  encryptedAccessToken: "encrypted-test-token",
  tokenExpiresAt: new Date(Date.now() + 3_600_000),
};
const post: any = { content: "Approved personal post", hashtags: [], postFormat: "text" };

describe("LinkedIn personal author identity", () => {
  it("uses a verified member URN only for an explicitly personal destination", () => {
    expect(resolveLinkedInAuthor(account)).toBe(account.accountId);
    expect(resolveLinkedInAuthor({ ...account, authorMode: "organization" })).toBeNull();
    expect(resolveLinkedInAuthor({ ...account, authorMode: null })).toBeNull();
    for (const accountId of ["bare-id", "urn:li:organization:123", "https://linkedin.com/in/member", ""]) {
      expect(resolveLinkedInAuthor({ ...account, accountId })).toBeNull();
    }
  });

  it("never replaces a selected page or a selected personal identity", () => {
    expect(resolveLinkedInAuthor({ ...account, authorUrn: "urn:li:organization:page" }))
      .toBe("urn:li:organization:page");
    expect(resolveLinkedInAuthor({ ...account, authorUrn: "urn:li:person:selected" }))
      .toBe("urn:li:person:selected");
  });

  it("publishes a legacy personal connection as the verified member, without mutating it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", {
      status: 201, headers: { "x-restli-id": "urn:li:share:test" },
    }));
    const result = await getPublisher("linkedin")!.publish({ account, post } as any);
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).author).toBe(account.accountId);
    expect(account.authorUrn).toBeNull();
  });

  it("fails before network access rather than posting as a person for a missing company-page author", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await getPublisher("linkedin")!.publish({
      account: { ...account, authorMode: "organization" }, post,
    } as any);
    expect(result.errorCode).toBe("missing_author");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([false, true])("saves a selectable personal author during OAuth (company page present=%s)", async hasPage => {
    const publisher: any = getPublisher("linkedin")!;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      access_token: "test-token", scope: "w_member_social", expires_in: 3600,
    }), { status: 200 }));
    vi.spyOn(publisher, "fetchAdminOrganizationAccess").mockResolvedValue({
      memberUrn: account.accountId,
      organizations: hasPage ? [{ mode: "organization", urn: "urn:li:organization:page", name: "Page" }] : [],
    });
    const result = await publisher.exchangeOAuthCode("test-code", "https://example.com/callback", {
      tenantDomain: "tenant.example",
    });
    expect(result.availableAuthors).toContainEqual({
      mode: "person", urn: account.accountId, name: "LinkedIn personal profile",
    });
    expect(result.authorUrn).toBe(hasPage ? "urn:li:organization:page" : account.accountId);
    expect(result.authorMode).toBe(hasPage ? "organization" : "person");
  });
});
