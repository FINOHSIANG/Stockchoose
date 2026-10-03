import { describe, expect, it } from "bun:test";
import { isPrivateAddress, parseSafeOutboundUrl } from "./outboundSecurity";

describe("outbound URL security", () => {
  it("allows public HTTPS destinations", () => {
    expect(parseSafeOutboundUrl("https://8.8.8.8/data").hostname).toBe("8.8.8.8");
  });

  it("rejects insecure protocols and embedded credentials", () => {
    expect(() => parseSafeOutboundUrl("http://example.com/data")).toThrow("只允许 HTTPS");
    expect(() => parseSafeOutboundUrl("https://user:pass@example.com/data")).toThrow("userinfo");
    expect(() => parseSafeOutboundUrl("file:///etc/passwd")).toThrow("只允许 HTTPS");
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "fc00::1",
    "fe80::1"
  ])("rejects private or special address %s", (address) => {
    const host = address.includes(":") ? "[" + address + "]" : address;
    expect(() => parseSafeOutboundUrl("https://" + host + "/data")).toThrow(/本机|内网/);
    expect(isPrivateAddress(address)).toBe(true);
  });
});
