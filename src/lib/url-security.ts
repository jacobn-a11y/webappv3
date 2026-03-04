import dns from "node:dns/promises";
import net from "node:net";

export class UrlPolicyError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "UrlPolicyError";
    this.code = code;
  }
}

export interface OutboundUrlPolicyOptions {
  allowHttp?: boolean;
  allowHttps?: boolean;
  denyPrivateNetworks?: boolean;
  allowlistHosts?: string[];
}

export function parseHostAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/, "");
}

function hostnameMatchesAllowlist(hostname: string, allowlistHosts: string[]): boolean {
  const normalized = normalizeHostname(hostname);
  return allowlistHosts.some((entry) => {
    const candidate = normalizeHostname(entry);
    if (!candidate) return false;
    return normalized === candidate || normalized.endsWith(`.${candidate}`);
  });
}

function isPrivateIPv4(ip: string): boolean {
  const octets = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part))) return true;

  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.replace("::ffff:", "");
    return isPrivateIPv4(mapped);
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA fc00::/7
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9")) return true; // fe80::/10
  if (normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  return false;
}

function isPrivateIpAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true;
}

async function resolveHostIps(hostname: string): Promise<string[]> {
  const family = net.isIP(hostname);
  if (family) return [hostname];

  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export async function assertSafeOutboundUrl(
  rawUrl: string,
  options?: OutboundUrlPolicyOptions
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlPolicyError("invalid_url", "URL is invalid.");
  }

  const allowHttp = options?.allowHttp ?? true;
  const allowHttps = options?.allowHttps ?? true;
  const denyPrivateNetworks = options?.denyPrivateNetworks ?? true;
  const protocol = parsed.protocol.toLowerCase();
  const hostname = normalizeHostname(parsed.hostname);
  const allowlistHosts = options?.allowlistHosts ?? [];

  if (!allowHttp && protocol === "http:") {
    throw new UrlPolicyError("http_blocked", "HTTP URLs are not allowed.");
  }
  if (!allowHttps && protocol === "https:") {
    throw new UrlPolicyError("https_blocked", "HTTPS URLs are not allowed.");
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new UrlPolicyError("scheme_blocked", "Only HTTP(S) URLs are allowed.");
  }

  if (!hostname) {
    throw new UrlPolicyError("hostname_missing", "URL hostname is required.");
  }

  if (parsed.username || parsed.password) {
    throw new UrlPolicyError("userinfo_blocked", "URL userinfo is not allowed.");
  }

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new UrlPolicyError("localhost_blocked", "Localhost URLs are not allowed.");
  }

  if (allowlistHosts.length > 0 && !hostnameMatchesAllowlist(hostname, allowlistHosts)) {
    throw new UrlPolicyError("host_not_allowlisted", "URL hostname is not allowlisted.");
  }

  if (denyPrivateNetworks) {
    let addresses: string[];
    try {
      addresses = await resolveHostIps(hostname);
    } catch {
      throw new UrlPolicyError("dns_resolution_failed", "Failed to resolve URL hostname.");
    }
    if (addresses.length === 0) {
      throw new UrlPolicyError("dns_resolution_empty", "No address records found for URL hostname.");
    }
    for (const address of addresses) {
      if (isPrivateIpAddress(address)) {
        throw new UrlPolicyError(
          "private_network_blocked",
          "URL resolves to a private or reserved network address."
        );
      }
    }
  }

  return parsed;
}
