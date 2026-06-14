import { strict as assert } from "node:assert";
import { selectLinkedInCapabilities } from "../linkedin-provider-core";

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`[ok]   ${name}`);
  } catch (err) {
    failures++;
    console.error(`[FAIL] ${name}`);
    console.error(err);
  }
}

(async () => {
  await test("nothing connected → copy-assist only", () => {
    const c = selectLinkedInCapabilities({ directPublishEnabled: false, mcpConfigured: false });
    assert.equal(c.postBackend, "none");
    assert.equal(c.messageBackend, "none");
    assert.equal(c.canPost, false);
    assert.equal(c.canMessage, false);
  });

  await test("MCP connected → posting + messaging via MCP", () => {
    const c = selectLinkedInCapabilities({ directPublishEnabled: false, mcpConfigured: true });
    assert.equal(c.postBackend, "mcp");
    assert.equal(c.messageBackend, "mcp");
    assert.equal(c.canMessage, true);
  });

  await test("direct OAuth approved → posting via OAuth, messaging still none", () => {
    const c = selectLinkedInCapabilities({ directPublishEnabled: true, mcpConfigured: false });
    assert.equal(c.postBackend, "direct_oauth");
    assert.equal(c.canPost, true);
    assert.equal(c.messageBackend, "none"); // member OAuth can't message
    assert.equal(c.canMessage, false);
  });

  await test("both available → OAuth preferred for posting, MCP for messaging", () => {
    const c = selectLinkedInCapabilities({ directPublishEnabled: true, mcpConfigured: true });
    assert.equal(c.postBackend, "direct_oauth");
    assert.equal(c.messageBackend, "mcp");
    assert.equal(c.canPost, true);
    assert.equal(c.canMessage, true);
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll linkedin-provider-core tests passed");
})();
