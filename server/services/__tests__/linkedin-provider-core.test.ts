import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import { selectLinkedInCapabilities } from "../linkedin-provider-core";


describe("linkedin-provider-core", () => {
  it("nothing connected → copy-assist only", () => {
    const c = selectLinkedInCapabilities({ directPublishEnabled: false, mcpConfigured: false });
    assert.equal(c.postBackend, "none");
    assert.equal(c.messageBackend, "none");
    assert.equal(c.canPost, false);
    assert.equal(c.canMessage, false);
  });

  it("MCP connected → posting via MCP, messaging always none", () => {
    const c = selectLinkedInCapabilities({ directPublishEnabled: false, mcpConfigured: true });
    assert.equal(c.postBackend, "mcp");
    assert.equal(c.messageBackend, "none");
    assert.equal(c.canPost, true);
    assert.equal(c.canMessage, false);
  });

  it("direct OAuth approved → posting via OAuth, messaging still none", () => {
    const c = selectLinkedInCapabilities({ directPublishEnabled: true, mcpConfigured: false });
    assert.equal(c.postBackend, "direct_oauth");
    assert.equal(c.canPost, true);
    assert.equal(c.messageBackend, "none");
    assert.equal(c.canMessage, false);
  });

  it("both available → OAuth preferred for posting, messaging still none", () => {
    const c = selectLinkedInCapabilities({ directPublishEnabled: true, mcpConfigured: true });
    assert.equal(c.postBackend, "direct_oauth");
    assert.equal(c.messageBackend, "none");
    assert.equal(c.canPost, true);
    assert.equal(c.canMessage, false);
  });

});
