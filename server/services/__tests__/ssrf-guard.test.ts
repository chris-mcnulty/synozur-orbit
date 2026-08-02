import { describe, it, expect } from "vitest";
import { isPrivateAddress, assertScanUrlSafe } from "../ssrf-guard";

// ── isPrivateAddress unit tests ───────────────────────────────────────────────

describe("isPrivateAddress", () => {
  it("accepts public IPv4 addresses", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("1.1.1.1")).toBe(false);
    expect(isPrivateAddress("203.0.113.1")).toBe(false);
  });

  it("rejects loopback IPv4", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("127.255.255.255")).toBe(true);
  });

  it("rejects RFC 1918 IPv4 ranges", () => {
    expect(isPrivateAddress("10.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.255.255.255")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
  });

  it("does not reject 172.15.x or 172.32.x (outside RFC-1918 /12)", () => {
    expect(isPrivateAddress("172.15.255.255")).toBe(false);
    expect(isPrivateAddress("172.32.0.0")).toBe(false);
  });

  it("rejects link-local and EC2 metadata address", () => {
    expect(isPrivateAddress("169.254.0.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
  });

  it("rejects IPv6 loopback", () => {
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("::")).toBe(true);
  });

  it("rejects IPv6 link-local fe80::/10", () => {
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("fe89::1")).toBe(true);
  });

  it("rejects IPv6 unique local fc00::/7", () => {
    expect(isPrivateAddress("fc00::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
  });

  it("rejects IPv4-mapped IPv6 loopback", () => {
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:192.168.1.1")).toBe(true);
  });
});

// ── assertScanUrlSafe unit tests ──────────────────────────────────────────────
// DNS-resolving tests are not included here (they make real network calls);
// they are covered by integration tests in a separate suite.

describe("assertScanUrlSafe — static checks", () => {
  it("rejects non-URL strings", async () => {
    await expect(assertScanUrlSafe("not-a-url")).rejects.toThrow("valid URL");
  });

  it("rejects non-http(s) schemes", async () => {
    await expect(assertScanUrlSafe("ftp://example.com")).rejects.toThrow("HTTP and HTTPS");
    await expect(assertScanUrlSafe("file:///etc/passwd")).rejects.toThrow("HTTP and HTTPS");
    await expect(assertScanUrlSafe("javascript:alert(1)")).rejects.toThrow("HTTP and HTTPS");
  });

  it("rejects localhost by name", async () => {
    await expect(assertScanUrlSafe("http://localhost/path")).rejects.toThrow("localhost");
    await expect(assertScanUrlSafe("https://localhost:3000")).rejects.toThrow("localhost");
  });

  it("rejects bare loopback IP", async () => {
    await expect(assertScanUrlSafe("http://127.0.0.1/")).rejects.toThrow("private or reserved");
    await expect(assertScanUrlSafe("http://127.0.0.1:8080/admin")).rejects.toThrow("private or reserved");
  });

  it("rejects RFC 1918 private IPs", async () => {
    await expect(assertScanUrlSafe("http://10.0.0.1/")).rejects.toThrow("private or reserved");
    await expect(assertScanUrlSafe("http://192.168.1.1/")).rejects.toThrow("private or reserved");
    await expect(assertScanUrlSafe("http://172.16.0.1/")).rejects.toThrow("private or reserved");
  });

  it("rejects EC2 metadata endpoint", async () => {
    await expect(assertScanUrlSafe("http://169.254.169.254/latest/meta-data/")).rejects.toThrow("private or reserved");
  });

  it("rejects IPv6 loopback", async () => {
    await expect(assertScanUrlSafe("http://[::1]/")).rejects.toThrow("private or reserved");
  });
});
