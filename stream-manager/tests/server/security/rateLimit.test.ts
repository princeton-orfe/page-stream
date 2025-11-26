import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  checkRateLimit,
  createRateLimitMiddleware,
  createUserRateLimiter,
  createControlActionRateLimiter,
  clearRateLimitStore,
  rateLimitPresets,
} from '../../../src/server/security/rateLimit.js';

// Mock the security logging to avoid database dependencies
vi.mock('../../../src/server/security/index.js', () => ({
  logSecurityEvent: vi.fn(),
}));

// Mock Express request/response
function mockRequest(options: {
  clientIP?: string;
  ip?: string;
  path?: string;
  method?: string;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  ctx?: {
    user?: {
      id: string;
      username: string;
      authSource: string;
      roles: string[];
    };
  };
}): Request {
  return {
    clientIP: options.clientIP || '127.0.0.1',
    ip: options.ip || options.clientIP || '127.0.0.1',
    path: options.path || '/api/test',
    method: options.method || 'GET',
    params: options.params || {},
    headers: options.headers || {},
    ctx: options.ctx,
  } as unknown as Request;
}

function mockResponse(): Response & { statusCode?: number; headers: Record<string, string | number> } {
  const res: Partial<Response> & { statusCode?: number; headers: Record<string, string | number> } = {
    statusCode: undefined,
    headers: {},
    status: vi.fn(function (this: typeof res, code: number) {
      this.statusCode = code;
      return this as Response;
    }),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(function (this: typeof res, name: string, value: string | number) {
      this.headers[name] = value;
      return this as Response;
    }),
  };
  return res as Response & { statusCode?: number; headers: Record<string, string | number> };
}

function mockNext(): NextFunction {
  return vi.fn() as NextFunction;
}

describe('Rate Limiting', () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  describe('checkRateLimit', () => {
    it('should allow first request', () => {
      const result = checkRateLimit('test-key', {
        windowMs: 60000,
        maxRequests: 10,
      });

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
    });

    it('should decrement remaining count on each request', () => {
      const config = { windowMs: 60000, maxRequests: 5 };

      const r1 = checkRateLimit('key1', config);
      expect(r1.remaining).toBe(4);

      const r2 = checkRateLimit('key1', config);
      expect(r2.remaining).toBe(3);

      const r3 = checkRateLimit('key1', config);
      expect(r3.remaining).toBe(2);
    });

    it('should deny when limit exceeded', () => {
      const config = { windowMs: 60000, maxRequests: 2 };

      checkRateLimit('key2', config);
      checkRateLimit('key2', config);
      const r3 = checkRateLimit('key2', config);

      expect(r3.allowed).toBe(false);
      expect(r3.remaining).toBe(0);
      expect(r3.retryAfter).toBeDefined();
    });

    it('should track different keys separately', () => {
      const config = { windowMs: 60000, maxRequests: 1 };

      const r1 = checkRateLimit('keyA', config);
      expect(r1.allowed).toBe(true);

      const r2 = checkRateLimit('keyB', config);
      expect(r2.allowed).toBe(true);

      const r3 = checkRateLimit('keyA', config);
      expect(r3.allowed).toBe(false);
    });
  });

  describe('createRateLimitMiddleware', () => {
    it('should set rate limit headers', () => {
      const middleware = createRateLimitMiddleware({
        windowMs: 60000,
        maxRequests: 100,
        logEvents: false,
      });

      const req = mockRequest({});
      const res = mockResponse();
      const next = mockNext();

      middleware(req, res, next);

      expect(res.headers['X-RateLimit-Limit']).toBe(100);
      expect(res.headers['X-RateLimit-Remaining']).toBe(99);
      expect(res.headers['X-RateLimit-Reset']).toBeDefined();
      expect(next).toHaveBeenCalled();
    });

    it('should return 429 when rate limited', () => {
      const middleware = createRateLimitMiddleware({
        windowMs: 60000,
        maxRequests: 1,
        logEvents: false,
      });

      const req = mockRequest({});
      const res = mockResponse();
      const next = mockNext();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();

      // Second request
      const res2 = mockResponse();
      const next2 = mockNext();
      middleware(req, res2, next2);

      expect(res2.statusCode).toBe(429);
      expect(res2.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Too Many Requests',
      }));
      expect(next2).not.toHaveBeenCalled();
    });

    it('should use custom key generator', () => {
      const middleware = createRateLimitMiddleware({
        windowMs: 60000,
        maxRequests: 1,
        keyGenerator: (req) => `custom:${req.path}`,
        logEvents: false,
      });

      const req1 = mockRequest({ path: '/api/endpoint1' });
      const res1 = mockResponse();
      const next1 = mockNext();
      middleware(req1, res1, next1);
      expect(next1).toHaveBeenCalled();

      // Different path should have separate limit
      const req2 = mockRequest({ path: '/api/endpoint2' });
      const res2 = mockResponse();
      const next2 = mockNext();
      middleware(req2, res2, next2);
      expect(next2).toHaveBeenCalled();

      // Same path should be limited
      const req3 = mockRequest({ path: '/api/endpoint1' });
      const res3 = mockResponse();
      const next3 = mockNext();
      middleware(req3, res3, next3);
      expect(res3.statusCode).toBe(429);
    });
  });

  describe('createUserRateLimiter', () => {
    it('should key by user ID for authenticated users', () => {
      const middleware = createUserRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
        logEvents: false,
      });

      const req1 = mockRequest({
        ctx: { user: { id: 'user1', username: 'User One', authSource: 'header', roles: [] } },
      });
      const res1 = mockResponse();
      const next1 = mockNext();
      middleware(req1, res1, next1);
      expect(next1).toHaveBeenCalled();

      // Different user should have separate limit
      const req2 = mockRequest({
        ctx: { user: { id: 'user2', username: 'User Two', authSource: 'header', roles: [] } },
      });
      const res2 = mockResponse();
      const next2 = mockNext();
      middleware(req2, res2, next2);
      expect(next2).toHaveBeenCalled();

      // Same user should be limited
      const req3 = mockRequest({
        ctx: { user: { id: 'user1', username: 'User One', authSource: 'header', roles: [] } },
      });
      const res3 = mockResponse();
      const next3 = mockNext();
      middleware(req3, res3, next3);
      expect(res3.statusCode).toBe(429);
    });

    it('should key by IP for anonymous users', () => {
      const middleware = createUserRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
        logEvents: false,
      });

      const req1 = mockRequest({
        clientIP: '192.168.1.1',
        ctx: { user: { id: 'anonymous', username: 'Anonymous', authSource: 'anonymous', roles: [] } },
      });
      const res1 = mockResponse();
      const next1 = mockNext();
      middleware(req1, res1, next1);
      expect(next1).toHaveBeenCalled();

      // Different IP should have separate limit
      const req2 = mockRequest({
        clientIP: '192.168.1.2',
        ctx: { user: { id: 'anonymous', username: 'Anonymous', authSource: 'anonymous', roles: [] } },
      });
      const res2 = mockResponse();
      const next2 = mockNext();
      middleware(req2, res2, next2);
      expect(next2).toHaveBeenCalled();

      // Same IP should be limited
      const req3 = mockRequest({
        clientIP: '192.168.1.1',
        ctx: { user: { id: 'anonymous', username: 'Anonymous', authSource: 'anonymous', roles: [] } },
      });
      const res3 = mockResponse();
      const next3 = mockNext();
      middleware(req3, res3, next3);
      expect(res3.statusCode).toBe(429);
    });
  });

  describe('createControlActionRateLimiter', () => {
    it('should limit by resource ID', () => {
      const middleware = createControlActionRateLimiter('stream');

      const req1 = mockRequest({ params: { id: 'stream-123' } });
      const res1 = mockResponse();
      const next1 = mockNext();
      middleware(req1, res1, next1);
      expect(next1).toHaveBeenCalled();

      // Different resource should have separate limit
      const req2 = mockRequest({ params: { id: 'stream-456' } });
      const res2 = mockResponse();
      const next2 = mockNext();
      middleware(req2, res2, next2);
      expect(next2).toHaveBeenCalled();

      // Same resource should be limited
      const req3 = mockRequest({ params: { id: 'stream-123' } });
      const res3 = mockResponse();
      const next3 = mockNext();
      middleware(req3, res3, next3);
      expect(res3.statusCode).toBe(429);
    });
  });

  describe('rateLimitPresets', () => {
    it('should have expected preset configurations', () => {
      expect(rateLimitPresets.strict).toEqual({
        windowMs: 60000,
        maxRequests: 60,
      });

      expect(rateLimitPresets.standard).toEqual({
        windowMs: 60000,
        maxRequests: 120,
      });

      expect(rateLimitPresets.relaxed).toEqual({
        windowMs: 60000,
        maxRequests: 300,
      });

      expect(rateLimitPresets.login).toEqual({
        windowMs: 900000, // 15 minutes
        maxRequests: 10,
      });
    });
  });
});
