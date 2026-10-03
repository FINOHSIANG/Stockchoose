import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const ALLOW_INSECURE_UPSTREAMS = process.env.STOCKCHOOSE_ALLOW_INSECURE_UPSTREAMS === "1";
const ALLOW_LOCAL_UPSTREAMS = process.env.STOCKCHOOSE_ALLOW_LOCAL_UPSTREAMS === "1";

function ipv4ToNumber(value: string) {
  return value.split(".").reduce((result, part) => (result * 256) + Number(part), 0) >>> 0;
}

function isPrivateIpv4(value: string) {
  const number = ipv4ToNumber(value);
  const ranges: Array<[number, number]> = [
    [ipv4ToNumber("0.0.0.0"), ipv4ToNumber("0.255.255.255")],
    [ipv4ToNumber("10.0.0.0"), ipv4ToNumber("10.255.255.255")],
    [ipv4ToNumber("100.64.0.0"), ipv4ToNumber("100.127.255.255")],
    [ipv4ToNumber("127.0.0.0"), ipv4ToNumber("127.255.255.255")],
    [ipv4ToNumber("169.254.0.0"), ipv4ToNumber("169.254.255.255")],
    [ipv4ToNumber("172.16.0.0"), ipv4ToNumber("172.31.255.255")],
    [ipv4ToNumber("192.0.0.0"), ipv4ToNumber("192.0.0.255")],
    [ipv4ToNumber("192.168.0.0"), ipv4ToNumber("192.168.255.255")],
    [ipv4ToNumber("198.18.0.0"), ipv4ToNumber("198.19.255.255")],
    [ipv4ToNumber("224.0.0.0"), ipv4ToNumber("255.255.255.255")]
  ];
  return ranges.some(([start, end]) => number >= start && number <= end);
}

function isPrivateIpv6(value: string) {
  const normalized = value.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true;
  }
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}

export function isPrivateAddress(address: string) {
  const version = isIP(address);
  return version === 4 ? isPrivateIpv4(address) : version === 6 ? isPrivateIpv6(address) : false;
}

function hostIsLocal(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
}

function normalizedHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

export function parseSafeOutboundUrl(value: string, options: { allowLocal?: boolean } = {}) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("上游地址不是有效 URL");
  }
  const allowLocal = options.allowLocal ?? ALLOW_LOCAL_UPSTREAMS;
  const protocolAllowed = url.protocol === "https:" || (url.protocol === "http:" && ALLOW_INSECURE_UPSTREAMS);
  if (!protocolAllowed) {
    throw new Error("上游地址只允许 HTTPS；如确需 HTTP，请显式设置 STOCKCHOOSE_ALLOW_INSECURE_UPSTREAMS=1");
  }
  if (url.username || url.password) throw new Error("上游地址不允许携带 userinfo");
  if (!url.hostname || hostIsLocal(url.hostname)) {
    if (!allowLocal) throw new Error("上游地址禁止访问本机地址");
  }
  const host = normalizedHostname(url.hostname);
  const literalAddress = isIP(host) ? host : undefined;
  if (literalAddress && isPrivateAddress(literalAddress) && !allowLocal) {
    throw new Error("上游地址禁止访问内网、链路本地或 metadata 地址");
  }
  return url;
}

export async function assertSafeOutboundUrl(value: string | URL, options: { allowLocal?: boolean } = {}) {
  const url = parseSafeOutboundUrl(String(value), options);
  const host = normalizedHostname(url.hostname);
  if (!isIP(host) && !hostIsLocal(host)) {
    try {
      const records = await lookup(host, { all: true, verbatim: true });
      if (!records.length) throw new Error("上游域名没有解析结果");
      if (!(options.allowLocal ?? ALLOW_LOCAL_UPSTREAMS) && records.some((record) => isPrivateAddress(record.address))) {
        throw new Error("上游域名解析到了内网、链路本地或 metadata 地址");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("上游")) throw error;
      throw new Error("上游域名解析失败：" + (error instanceof Error ? error.message : String(error)));
    }
  }
  return url;
}
