import type { Request, Response, NextFunction } from 'express';
import { logSecurityEvent } from './index.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory rate limit storage
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  const keys = Array.from(rateLimitStore.keys());
  for (const key of keys) {
    const entry = rateLimitStore.get(key);
    if (entry && entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

export interface RateLimitConfig {
  // Window size in milliseconds
  windowMs: number;
  // Maximum requests per window
  maxRequests: number;
  // Key generator function (defaults to user ID or IP)
  keyGenerator?: (req: Request) => string;
  // Whether to log rate limit events
  logEvents?: boolean;
  // Custom message
  message?: string;
}

// Default key generator: use user ID if authenticated, otherwise IP
function defaultKeyGenerator(req: Request): string {
  if (req.ctx?.user?.authSource === 'header') {
    return `user:${req.ctx.user.id}`;
  }
  return `ip:${req.clientIP || req.ip || '0.0.0.0'}`;
}

// Check if a request should be rate limited
export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetAt: number; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    // New window
    const resetAt = now + config.windowMs;
    rateLimitStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt };
  }

  if (entry.count >= config.maxRequests) {
    // Rate limited
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, resetAt: entry.resetAt, retryAfter };
  }

  // Increment counter
  entry.count++;
  return { allowed: true, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt };
}

// Create rate limit middleware
export function createRateLimitMiddleware(config: RateLimitConfig) {
  const keyGenerator = config.keyGenerator || defaultKeyGenerator;
  const logEvents = config.logEvents !== false;
  const message = config.message || 'Too many requests, please try again later';

  return function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const key = keyGenerator(req);
    const result = checkRateLimit(key, config);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', config.maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

    if (!result.allowed) {
      res.setHeader('Retry-After', result.retryAfter || 1);

      if (logEvents) {
        logSecurityEvent('rate_limit:exceeded', {
          userId: req.ctx?.user?.id,
          username: req.ctx?.user?.username,
          ipAddress: req.clientIP || req.ip || '0.0.0.0',
          userAgent: req.headers['user-agent'],
          requestPath: req.path,
          requestMethod: req.method,
          details: {
            key,
            limit: config.maxRequests,
            windowMs: config.windowMs,
          },
        });
      }

      res.status(429).json({
        error: 'Too Many Requests',
        message,
        retryAfter: result.retryAfter,
      });
      return;
    }

    next();
  };
}

// Preset configurations
export const rateLimitPresets = {
  // Strict: 60 requests per minute (for sensitive operations)
  strict: {
    windowMs: 60 * 1000,
    maxRequests: 60,
  },
  // Standard: 120 requests per minute
  standard: {
    windowMs: 60 * 1000,
    maxRequests: 120,
  },
  // Relaxed: 300 requests per minute (for read operations)
  relaxed: {
    windowMs: 60 * 1000,
    maxRequests: 300,
  },
  // Burst: 30 requests per 10 seconds (for quick bursts)
  burst: {
    windowMs: 10 * 1000,
    maxRequests: 30,
  },
  // Login: 10 attempts per 15 minutes (for auth endpoints)
  login: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 10,
  },
};

// Create a rate limiter with a specific preset
export function createPresetRateLimiter(
  preset: keyof typeof rateLimitPresets,
  overrides?: Partial<RateLimitConfig>
) {
  return createRateLimitMiddleware({
    ...rateLimitPresets[preset],
    ...overrides,
  });
}

// Global rate limit by IP (for all requests)
export function createGlobalRateLimiter(config?: Partial<RateLimitConfig>) {
  return createRateLimitMiddleware({
    windowMs: 60 * 1000,
    maxRequests: 600, // 10 requests per second average
    keyGenerator: (req) => `global:${req.clientIP || req.ip || '0.0.0.0'}`,
    ...config,
  });
}

// Per-user rate limit (for authenticated users)
export function createUserRateLimiter(config?: Partial<RateLimitConfig>) {
  return createRateLimitMiddleware({
    windowMs: 60 * 1000,
    maxRequests: 120,
    keyGenerator: (req) => {
      if (req.ctx?.user?.authSource === 'header') {
        return `user:${req.ctx.user.id}`;
      }
      // Fall back to IP for anonymous users
      return `anon:${req.clientIP || req.ip || '0.0.0.0'}`;
    },
    ...config,
  });
}

// Control action rate limit (for start/stop/restart operations)
export function createControlActionRateLimiter(resourceType: string) {
  return function controlRateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    // Use resource-specific key
    const resourceId = req.params.id;
    const key = `control:${resourceType}:${resourceId}`;

    const result = checkRateLimit(key, {
      windowMs: 5000, // 5 second window
      maxRequests: 1, // One action per 5 seconds per resource
    });

    if (!result.allowed) {
      res.status(429).json({
        error: 'Rate limited',
        message: `Please wait ${result.retryAfter} seconds before retrying`,
        retryAfter: result.retryAfter,
      });
      return;
    }

    next();
  };
}

// Export for testing
export function clearRateLimitStore() {
  rateLimitStore.clear();
}

export function getRateLimitStoreSize(): number {
  return rateLimitStore.size;
}
