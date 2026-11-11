import { describe, expect, it } from "vitest";
import { APOLLO_PREVIEW_TTL_MS } from "@shared/apollo-reveal";
import { signApolloPreviews, verifyApolloPreviews, apolloRevealClaimKey } from "../apollo-reveal-core";

const scope = { tenantDomain: "tenant.example", campaignId: "campaign", userId: "operator" };
const preview = { id: "person-1", displayName: "Alice C***n", title: "Alliance Lead", companyName: "Acme", companyDomain: "acme.com" };
const now = 1_800_000_000_000;
const secret = "test-signing-key";
const signed = () => signApolloPreviews([preview], scope, "Acme", secret, now)[0];
describe("Apollo reveal preview authorization", () => {
  it("round-trips only the signed search fields and expires in 30 minutes", () => {
    const p = signed();
    expect(new Date(p.expiresAt).getTime()).toBe(now + APOLLO_PREVIEW_TTL_MS);
    expect(verifyApolloPreviews([p.token], scope, secret, now)[0]).toMatchObject({ ...scope, company: "Acme", preview });
    expect(apolloRevealClaimKey(p.token)).toBe(apolloRevealClaimKey(p.token));
  });
  it.each([
    { ...scope, tenantDomain: "other.example" },
    { ...scope, campaignId: "other" },
    { ...scope, userId: "other" },
  ])("rejects cross-tenant, campaign and user replay", otherScope => {
    expect(() => verifyApolloPreviews([signed().token], otherScope, secret, now)).toThrow(/does not belong/);
  });
  it("rejects edits to the company, person and paid request authorization", () => {
    const [body, signature] = signed().token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    payload.preview.id = "another-person";
    payload.company = "Another Company";
    const tampered = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
    expect(() => verifyApolloPreviews([tampered], scope, secret, now)).toThrow(/modified/);
    expect(() => verifyApolloPreviews([signed().token], scope, "wrong-secret", now)).toThrow(/modified/);
  });
  it("rejects alternate signature encodings so a replay cannot get a new claim key", () => {
    expect(() => verifyApolloPreviews([`${signed().token}=`], scope, secret, now)).toThrow(/modified/);
  });
  it("rejects expired tokens, missing configuration and oversized/duplicate selections", () => {
    expect(() => verifyApolloPreviews([signed().token], scope, secret, now + APOLLO_PREVIEW_TTL_MS)).toThrow(/expired/);
    expect(() => verifyApolloPreviews([signed().token], scope, "")).toThrow(/unavailable/);
    expect(() => verifyApolloPreviews([], scope, secret, now)).toThrow(/between/);
    expect(() => verifyApolloPreviews(Array(11).fill(signed().token), scope, secret, now)).toThrow(/between/);
    expect(() => verifyApolloPreviews([signed().token, signed().token], scope, secret, now)).toThrow(/only once/);
  });
});
