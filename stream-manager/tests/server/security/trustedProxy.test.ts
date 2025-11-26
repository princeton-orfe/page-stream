import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  isIPTrusted,
  getClientIP,
  isRequestFromTrustedProxy,
} from '../../../src/server/security/trustedProxy.js';

// Mock Express request
function mockRequest(options: {
  remoteAddress?: string;
  ip?: string;
  headers?: Record<string, string | string[]>;
}): Request {
  return {
    socket: { remoteAddress: options.remoteAddress || '127.0.0.1' },
    ip: options.ip || options.remoteAddress || '127.0.0.1',
    headers: options.headers || {},
  } as unknown as Request;
}

describe('Trusted Proxy Validation', () => {
  describe('isIPTrusted', () => {
    const defaultTrustedProxies = ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

    it('should trust exact IP matches', () => {
      expect(isIPTrusted('127.0.0.1', defaultTrustedProxies)).toBe(true);
      expect(isIPTrusted('::1', defaultTrustedProxies)).toBe(true);
    });

    it('should trust IPs within CIDR ranges', () => {
      // 10.0.0.0/8 - any IP starting with 10.x.x.x
      expect(isIPTrusted('10.0.0.1', defaultTrustedProxies)).toBe(true);
      expect(isIPTrusted('10.255.255.255', defaultTrustedProxies)).toBe(true);
      expect(isIPTrusted('10.1.2.3', defaultTrustedProxies)).toBe(true);

      // 172.16.0.0/12 - 172.16.x.x to 172.31.x.x
      expect(isIPTrusted('172.16.0.1', defaultTrustedProxies)).toBe(true);
      expect(isIPTrusted('172.31.255.255', defaultTrustedProxies)).toBe(true);

      // 192.168.0.0/16 - 192.168.x.x
      expect(isIPTrusted('192.168.0.1', defaultTrustedProxies)).toBe(true);
      expect(isIPTrusted('192.168.255.255', defaultTrustedProxies)).toBe(true);
    });

    it('should not trust IPs outside CIDR ranges', () => {
      expect(isIPTrusted('11.0.0.1', defaultTrustedProxies)).toBe(false);
      expect(isIPTrusted('172.15.0.1', defaultTrustedProxies)).toBe(false);
      expect(isIPTrusted('172.32.0.1', defaultTrustedProxies)).toBe(false);
      expect(isIPTrusted('192.169.0.1', defaultTrustedProxies)).toBe(false);
      expect(isIPTrusted('8.8.8.8', defaultTrustedProxies)).toBe(false);
    });

    it('should handle empty trusted proxies list', () => {
      expect(isIPTrusted('127.0.0.1', [])).toBe(false);
      expect(isIPTrusted('10.0.0.1', [])).toBe(false);
    });

    it('should handle custom trusted proxies', () => {
      const customProxies = ['203.0.113.0/24', '198.51.100.50'];

      expect(isIPTrusted('203.0.113.1', customProxies)).toBe(true);
      expect(isIPTrusted('203.0.113.255', customProxies)).toBe(true);
      expect(isIPTrusted('198.51.100.50', customProxies)).toBe(true);
      expect(isIPTrusted('198.51.100.51', customProxies)).toBe(false);
      expect(isIPTrusted('203.0.114.1', customProxies)).toBe(false);
    });

    it('should handle /32 CIDR (single IP)', () => {
      expect(isIPTrusted('192.0.2.1', ['192.0.2.1/32'])).toBe(true);
      expect(isIPTrusted('192.0.2.2', ['192.0.2.1/32'])).toBe(false);
    });

    it('should handle /0 CIDR (all IPs)', () => {
      expect(isIPTrusted('1.2.3.4', ['0.0.0.0/0'])).toBe(true);
      expect(isIPTrusted('255.255.255.255', ['0.0.0.0/0'])).toBe(true);
    });
  });

  describe('getClientIP', () => {
    const trustedProxies = ['127.0.0.1', '10.0.0.0/8'];

    it('should return direct IP when not from trusted proxy', () => {
      const req = mockRequest({
        remoteAddress: '203.0.113.50',
        headers: { 'x-forwarded-for': '198.51.100.1' },
      });

      expect(getClientIP(req, trustedProxies)).toBe('203.0.113.50');
    });

    it('should use X-Forwarded-For when from trusted proxy', () => {
      const req = mockRequest({
        remoteAddress: '127.0.0.1',
        headers: { 'x-forwarded-for': '203.0.113.50' },
      });

      expect(getClientIP(req, trustedProxies)).toBe('203.0.113.50');
    });

    it('should handle multiple IPs in X-Forwarded-For', () => {
      const req = mockRequest({
        remoteAddress: '10.0.0.1',
        headers: { 'x-forwarded-for': '203.0.113.50, 10.0.0.2, 10.0.0.1' },
      });

      // Should return the rightmost untrusted IP
      expect(getClientIP(req, trustedProxies)).toBe('203.0.113.50');
    });

    it('should use X-Real-IP as fallback', () => {
      const req = mockRequest({
        remoteAddress: '127.0.0.1',
        headers: { 'x-real-ip': '203.0.113.50' },
      });

      expect(getClientIP(req, trustedProxies)).toBe('203.0.113.50');
    });

    it('should normalize IPv6-mapped IPv4 addresses', () => {
      const req = mockRequest({
        remoteAddress: '::ffff:127.0.0.1',
        headers: { 'x-forwarded-for': '203.0.113.50' },
      });

      expect(getClientIP(req, trustedProxies)).toBe('203.0.113.50');
    });

    it('should return direct IP when no forwarding headers', () => {
      const req = mockRequest({
        remoteAddress: '10.0.0.1',
        headers: {},
      });

      expect(getClientIP(req, trustedProxies)).toBe('10.0.0.1');
    });

    it('should skip trusted proxies in X-Forwarded-For chain', () => {
      const req = mockRequest({
        remoteAddress: '10.0.0.1', // trusted
        headers: { 'x-forwarded-for': '203.0.113.50, 10.0.0.5, 10.0.0.3' },
      });

      // Skip 10.0.0.3 and 10.0.0.5 (trusted), return 203.0.113.50
      expect(getClientIP(req, trustedProxies)).toBe('203.0.113.50');
    });
  });

  describe('isRequestFromTrustedProxy', () => {
    const trustedProxies = ['127.0.0.1', '10.0.0.0/8'];

    it('should return true when request is from trusted proxy', () => {
      const req = mockRequest({ remoteAddress: '127.0.0.1' });
      expect(isRequestFromTrustedProxy(req, trustedProxies)).toBe(true);

      const req2 = mockRequest({ remoteAddress: '10.1.2.3' });
      expect(isRequestFromTrustedProxy(req2, trustedProxies)).toBe(true);
    });

    it('should return false when request is not from trusted proxy', () => {
      const req = mockRequest({ remoteAddress: '203.0.113.50' });
      expect(isRequestFromTrustedProxy(req, trustedProxies)).toBe(false);
    });

    it('should handle IPv6-mapped IPv4 addresses', () => {
      const req = mockRequest({ remoteAddress: '::ffff:127.0.0.1' });
      expect(isRequestFromTrustedProxy(req, trustedProxies)).toBe(true);

      const req2 = mockRequest({ remoteAddress: '::ffff:203.0.113.50' });
      expect(isRequestFromTrustedProxy(req2, trustedProxies)).toBe(false);
    });
  });
});
