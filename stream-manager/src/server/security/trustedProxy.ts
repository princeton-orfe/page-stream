import type { Request } from 'express';

// Parse CIDR notation into network address and prefix length
function parseCIDR(cidr: string): { address: number[]; prefixLength: number } | null {
  const parts = cidr.split('/');
  const ip = parts[0];
  const prefixLength = parts[1] ? parseInt(parts[1], 10) : (ip.includes(':') ? 128 : 32);

  // Parse IP address
  const address = parseIP(ip);
  if (!address) return null;

  return { address, prefixLength };
}

// Parse IP address to array of bytes/segments
function parseIP(ip: string): number[] | null {
  // IPv4
  if (ip.includes('.')) {
    const parts = ip.split('.').map(p => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
      return null;
    }
    return parts;
  }

  // IPv6
  if (ip.includes(':')) {
    // Handle :: expansion
    let expanded = ip;
    if (ip.includes('::')) {
      const parts = ip.split('::');
      const left = parts[0] ? parts[0].split(':') : [];
      const right = parts[1] ? parts[1].split(':') : [];
      const missing = 8 - left.length - right.length;
      const middle = new Array(missing).fill('0');
      expanded = [...left, ...middle, ...right].join(':');
    }

    const parts = expanded.split(':').map(p => parseInt(p || '0', 16));
    if (parts.length !== 8 || parts.some(p => isNaN(p) || p < 0 || p > 0xffff)) {
      return null;
    }
    return parts;
  }

  return null;
}

// Check if an IP is within a CIDR range
function ipInCIDR(ip: string, cidr: string): boolean {
  const ipParts = parseIP(ip);
  const cidrParts = parseCIDR(cidr);

  if (!ipParts || !cidrParts) return false;

  // IPv4 and IPv6 have different bit widths per part
  const bitsPerPart = ipParts.length === 4 ? 8 : 16;

  const { address, prefixLength } = cidrParts;

  // Compare types (IPv4 vs IPv6)
  if (ipParts.length !== address.length) {
    // Handle IPv4-mapped IPv6 addresses (::ffff:a.b.c.d)
    if (ipParts.length === 4 && address.length === 8) {
      // Check if it's ::ffff:... pattern
      const isV4Mapped = address.slice(0, 5).every(p => p === 0) && address[5] === 0xffff;
      if (isV4Mapped) {
        // Compare last two IPv6 segments (32 bits) with IPv4
        const v4FromV6 = [
          (address[6] >> 8) & 0xff,
          address[6] & 0xff,
          (address[7] >> 8) & 0xff,
          address[7] & 0xff,
        ];
        // Adjust prefix length for the v4 portion
        const v4Prefix = Math.max(0, prefixLength - 96);
        return ipInCIDRSameFamily(ipParts, { address: v4FromV6, prefixLength: v4Prefix }, 8);
      }
    }
    return false;
  }

  return ipInCIDRSameFamily(ipParts, cidrParts, bitsPerPart);
}

function ipInCIDRSameFamily(
  ipParts: number[],
  cidr: { address: number[]; prefixLength: number },
  bitsPerPart: number
): boolean {
  const { address, prefixLength } = cidr;
  let bitsRemaining = prefixLength;

  for (let i = 0; i < ipParts.length && bitsRemaining > 0; i++) {
    const bitsToCheck = Math.min(bitsRemaining, bitsPerPart);
    const mask = ((1 << bitsToCheck) - 1) << (bitsPerPart - bitsToCheck);

    if ((ipParts[i] & mask) !== (address[i] & mask)) {
      return false;
    }

    bitsRemaining -= bitsPerPart;
  }

  return true;
}

// Check if IP is in trusted proxy list
export function isIPTrusted(ip: string, trustedProxies: string[]): boolean {
  for (const trusted of trustedProxies) {
    // Exact match
    if (ip === trusted) return true;

    // CIDR match
    if (trusted.includes('/')) {
      if (ipInCIDR(ip, trusted)) return true;
    }
  }

  return false;
}

// Get client IP from request, respecting trusted proxies
export function getClientIP(req: Request, trustedProxies: string[]): string {
  // Get the direct connection IP
  const remoteAddr = req.socket.remoteAddress || req.ip || '0.0.0.0';

  // Normalize IPv6-mapped IPv4 addresses
  const normalizedRemote = normalizeIP(remoteAddr);

  // If the direct connection is from a trusted proxy, use X-Forwarded-For
  if (isIPTrusted(normalizedRemote, trustedProxies)) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      // X-Forwarded-For is a comma-separated list, leftmost is the original client
      const ips = (typeof forwardedFor === 'string' ? forwardedFor : forwardedFor[0])
        .split(',')
        .map(ip => normalizeIP(ip.trim()));

      // Find the rightmost untrusted IP (client's real IP)
      // Walk from right to left, skipping trusted proxies
      for (let i = ips.length - 1; i >= 0; i--) {
        if (!isIPTrusted(ips[i], trustedProxies)) {
          return ips[i];
        }
      }

      // All IPs are trusted, use the leftmost
      if (ips.length > 0) {
        return ips[0];
      }
    }

    // Also check X-Real-IP
    const realIp = req.headers['x-real-ip'];
    if (realIp) {
      return normalizeIP(typeof realIp === 'string' ? realIp : realIp[0]);
    }
  }

  return normalizedRemote;
}

// Normalize IP address (handle IPv6-mapped IPv4)
function normalizeIP(ip: string): string {
  // Remove IPv6 prefix for IPv4-mapped addresses
  if (ip.startsWith('::ffff:')) {
    return ip.slice(7);
  }
  return ip;
}

// Check if request comes from a trusted proxy
export function isRequestFromTrustedProxy(req: Request, trustedProxies: string[]): boolean {
  const remoteAddr = req.socket.remoteAddress || req.ip || '0.0.0.0';
  const normalizedRemote = normalizeIP(remoteAddr);
  return isIPTrusted(normalizedRemote, trustedProxies);
}
