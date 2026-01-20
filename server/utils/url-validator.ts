import { URL } from "url";
import * as dns from "dns";
import { promisify } from "util";

const dnsResolve4 = promisify(dns.resolve4);
const dnsResolve6 = promisify(dns.resolve6);

export interface UrlValidationResult {
  isValid: boolean;
  error?: string;
  normalizedUrl?: string;
}

const ALLOWED_PROTOCOLS = ["http:", "https:"];

const BLOCKED_HOSTNAMES = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "0",
  "0.0.0.0",
];

const PRIVATE_IP_RANGES = [
  { start: "10.0.0.0", end: "10.255.255.255" },
  { start: "172.16.0.0", end: "172.31.255.255" },
  { start: "192.168.0.0", end: "192.168.255.255" },
  { start: "169.254.0.0", end: "169.254.255.255" },
  { start: "100.64.0.0", end: "100.127.255.255" },
  { start: "198.18.0.0", end: "198.19.255.255" },
];

const LOOPBACK_RANGE = { start: "127.0.0.0", end: "127.255.255.255" };

function ipToNumber(ip: string): number {
  const parts = ip.split(".").map(Number);
  return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isPrivateIP(ip: string): boolean {
  if (ip.includes(":")) {
    return ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc00:") || ip.startsWith("fd00:");
  }

  const ipNum = ipToNumber(ip);

  const loopbackStart = ipToNumber(LOOPBACK_RANGE.start);
  const loopbackEnd = ipToNumber(LOOPBACK_RANGE.end);
  if (ipNum >= loopbackStart && ipNum <= loopbackEnd) {
    return true;
  }

  for (const range of PRIVATE_IP_RANGES) {
    const start = ipToNumber(range.start);
    const end = ipToNumber(range.end);
    if (ipNum >= start && ipNum <= end) {
      return true;
    }
  }

  return false;
}

function isIPAddress(hostname: string): boolean {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^(\[)?([0-9a-fA-F:]+)(\])?$/;
  return ipv4Regex.test(hostname) || ipv6Regex.test(hostname);
}

export function validateUrlFormat(urlString: string): UrlValidationResult {
  if (!urlString || typeof urlString !== "string") {
    return { isValid: false, error: "URL is required" };
  }

  const trimmedUrl = urlString.trim();
  if (!trimmedUrl) {
    return { isValid: false, error: "URL cannot be empty" };
  }

  let urlToValidate = trimmedUrl;
  if (!trimmedUrl.match(/^https?:\/\//i)) {
    urlToValidate = `https://${trimmedUrl}`;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlToValidate);
  } catch {
    return { isValid: false, error: "Invalid URL format" };
  }

  if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
    return { 
      isValid: false, 
      error: `Invalid protocol. Only HTTP and HTTPS are allowed` 
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return { 
      isValid: false, 
      error: "URLs pointing to localhost or local addresses are not allowed" 
    };
  }

  if (isIPAddress(hostname)) {
    const cleanIP = hostname.replace(/^\[|\]$/g, "");
    if (isPrivateIP(cleanIP)) {
      return { 
        isValid: false, 
        error: "URLs pointing to private or internal IP addresses are not allowed" 
      };
    }
  }

  if (hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".lan")) {
    return { 
      isValid: false, 
      error: "URLs pointing to internal network domains are not allowed" 
    };
  }

  if (hostname.includes("..") || hostname.startsWith(".") || hostname.endsWith(".")) {
    return { isValid: false, error: "Invalid domain format" };
  }

  const domainParts = hostname.split(".");
  if (domainParts.length < 2 && !isIPAddress(hostname)) {
    return { isValid: false, error: "URL must include a valid domain" };
  }

  const normalizedUrl = parsedUrl.href.replace(/\/+$/, "");

  return { isValid: true, normalizedUrl };
}

export async function validateUrlWithDnsCheck(urlString: string): Promise<UrlValidationResult> {
  const formatResult = validateUrlFormat(urlString);
  if (!formatResult.isValid) {
    return formatResult;
  }

  const parsedUrl = new URL(formatResult.normalizedUrl!);
  const hostname = parsedUrl.hostname;

  if (isIPAddress(hostname)) {
    return formatResult;
  }

  try {
    let resolvedIPs: string[] = [];
    
    try {
      const ipv4s = await dnsResolve4(hostname);
      resolvedIPs = resolvedIPs.concat(ipv4s);
    } catch {
    }

    try {
      const ipv6s = await dnsResolve6(hostname);
      resolvedIPs = resolvedIPs.concat(ipv6s);
    } catch {
    }

    if (resolvedIPs.length === 0) {
      return formatResult;
    }

    for (const ip of resolvedIPs) {
      if (isPrivateIP(ip)) {
        return { 
          isValid: false, 
          error: "URL resolves to a private or internal IP address (potential SSRF attempt)" 
        };
      }
    }

    return formatResult;
  } catch {
    return formatResult;
  }
}

export async function validateUrlSoft(urlString: string): Promise<UrlValidationResult> {
  const formatResult = validateUrlFormat(urlString);
  if (!formatResult.isValid) {
    return formatResult;
  }

  const parsedUrl = new URL(formatResult.normalizedUrl!);
  const hostname = parsedUrl.hostname;

  if (isIPAddress(hostname)) {
    const cleanIP = hostname.replace(/^\[|\]$/g, "");
    if (isPrivateIP(cleanIP)) {
      return { 
        isValid: false, 
        error: "URLs pointing to private or internal IP addresses are not allowed" 
      };
    }
    return formatResult;
  }

  try {
    let resolvedIPs: string[] = [];
    
    try {
      const ipv4s = await dnsResolve4(hostname);
      resolvedIPs = resolvedIPs.concat(ipv4s);
    } catch {
    }

    try {
      const ipv6s = await dnsResolve6(hostname);
      resolvedIPs = resolvedIPs.concat(ipv6s);
    } catch {
    }

    if (resolvedIPs.length === 0) {
      return formatResult;
    }

    for (const ip of resolvedIPs) {
      if (isPrivateIP(ip)) {
        return { 
          isValid: false, 
          error: "URL resolves to a private or internal IP address (potential SSRF attempt)" 
        };
      }
    }

    return formatResult;
  } catch {
    return formatResult;
  }
}

export function sanitizeUrl(urlString: string): string | null {
  const result = validateUrlFormat(urlString);
  return result.isValid ? result.normalizedUrl! : null;
}

export async function validateCompetitorUrl(urlString: string): Promise<UrlValidationResult> {
  return validateUrlSoft(urlString);
}

export async function validateBlogUrl(urlString: string): Promise<UrlValidationResult> {
  return validateUrlSoft(urlString);
}
