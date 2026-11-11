import { afterEach, describe, expect, it, vi } from "vitest";
import { revealApolloPersonById } from "../apollo-discovery-provider";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("Apollo paid reveal request", () => {
  it("requests the exact reviewed ID once without phones, personal emails or waterfall", async () => {
    vi.stubEnv("APOLLO_API_KEY", "test-key");
    const fetch = vi.fn().mockResolvedValue(Response.json({ person: {
      id: "person", first_name: "Alice", last_name: "Chen", title: "Director",
      organization: { name: "Acme", primary_domain: "acme.com" }, email: "ALICE@ACME.COM",
    } }));
    vi.stubGlobal("fetch", fetch);
    const result = await revealApolloPersonById("person");
    expect(result).toMatchObject({ name: "Alice Chen", email: "alice@acme.com", companyDomain: "acme.com", source: "apollo" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      id: "person", reveal_personal_emails: false, reveal_phone_number: false, run_waterfall_email: false, run_waterfall_phone: false,
    });
  });
  it("rejects an unrelated identity and never creates a name from a hidden surname", async () => {
    vi.stubEnv("APOLLO_API_KEY", "test-key");
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ person: { id: "other", name: "Alice Chen" } }))
      .mockResolvedValueOnce(Response.json({ person: { id: "person", first_name: "Alice", last_name_obfuscated: "C***n" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await revealApolloPersonById("person")).toBeNull();
    expect(await revealApolloPersonById("person")).toBeNull();
  });
  it("never retries a provider error", async () => {
    vi.stubEnv("APOLLO_API_KEY", "test-key");
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    await expect(revealApolloPersonById("person")).rejects.toThrow(/HTTP 429/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
