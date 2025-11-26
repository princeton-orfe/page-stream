import type { Request, Response, NextFunction } from 'express';
import { AuthConfig, RequestContext, User, Role, Capability } from './types.js';
import { extractUserFromRequest, createAnonymousUser } from './extractors.js';
import { createRequestContext, BUILT_IN_ROLES } from './rbac.js';
import { logSecurityEvent } from '../security/index.js';
import { getClientIP, isRequestFromTrustedProxy } from '../security/trustedProxy.js';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      ctx: RequestContext;
      clientIP: string;
    }
  }
}

// Role storage interface (implemented by db module)
export interface RoleStore {
  getRoles(): Promise<Role[]>;
  getUserRoles(userId: string): Promise<string[]>;
  mapGroupsToRoles(groups: string[], config: AuthConfig): string[];
}

// Create auth middleware factory
export function createAuthMiddleware(
  config: AuthConfig,
  roleStore: RoleStore
) {
  // Check if security logging is enabled (defaults to true when auth is enabled)
  const securityLoggingEnabled = process.env.SECURITY_LOGGING !== 'false';

  return async function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      // Get client IP (respecting trusted proxies)
      const clientIP = getClientIP(req, config.trustedProxies);
      req.clientIP = clientIP;

      let user: User;
      const allRoles = await roleStore.getRoles();

      if (config.mode === 'none') {
        // Auth disabled: everyone is admin
        user = createAnonymousUser(['admin']);
      } else {
        // Check if request is from a trusted proxy when auth headers are present
        const hasAuthHeaders = !!extractUserFromRequest(req, config);

        if (hasAuthHeaders && !isRequestFromTrustedProxy(req, config.trustedProxies)) {
          // Auth headers present but not from trusted proxy - security violation
          if (securityLoggingEnabled) {
            logSecurityEvent('trusted_proxy:violation', {
              ipAddress: clientIP,
              userAgent: req.headers['user-agent'],
              requestPath: req.path,
              requestMethod: req.method,
              details: {
                remoteAddress: req.socket.remoteAddress,
                headersPresent: Object.keys(req.headers).filter(h =>
                  h.toLowerCase().includes('forward') ||
                  h.toLowerCase().includes('user') ||
                  h.toLowerCase().includes('principal')
                ),
              },
            });
          }

          res.status(403).json({
            error: 'Forbidden',
            message: 'Request not from trusted proxy',
          });
          return;
        }

        // Try to extract user from headers
        const extractedUser = extractUserFromRequest(req, config);

        if (extractedUser) {
          // Resolve roles from groups and/or database
          const groupRoles = roleStore.mapGroupsToRoles(
            extractedUser.groups || [],
            config
          );
          const dbRoles = await roleStore.getUserRoles(extractedUser.id);

          // Combine roles (group mappings + explicit DB assignments)
          const allUserRoles = [...new Set([...groupRoles, ...dbRoles])];

          // If no roles resolved, use default
          if (allUserRoles.length === 0) {
            allUserRoles.push(config.roleMapping.defaultRole);
          }

          user = {
            ...extractedUser,
            roles: allUserRoles
          };

          // Log successful auth
          if (securityLoggingEnabled) {
            logSecurityEvent('auth:success', {
              userId: user.id,
              username: user.username,
              ipAddress: clientIP,
              userAgent: req.headers['user-agent'],
              requestPath: req.path,
              requestMethod: req.method,
              details: { roles: allUserRoles },
            });
          }
        } else if (config.roleMapping.anonymousRole) {
          // No user in headers but anonymous access allowed
          user = createAnonymousUser([config.roleMapping.anonymousRole]);

          if (securityLoggingEnabled) {
            logSecurityEvent('auth:anonymous', {
              ipAddress: clientIP,
              userAgent: req.headers['user-agent'],
              requestPath: req.path,
              requestMethod: req.method,
            });
          }
        } else {
          // No user and anonymous not allowed
          if (securityLoggingEnabled) {
            logSecurityEvent('auth:failure', {
              ipAddress: clientIP,
              userAgent: req.headers['user-agent'],
              requestPath: req.path,
              requestMethod: req.method,
              details: { reason: 'no_identity' },
            });
          }

          res.status(401).json({
            error: 'Authentication required',
            message: 'No user identity found in request headers'
          });
          return;
        }
      }

      // Create request context with resolved capabilities
      req.ctx = createRequestContext(user, allRoles);

      next();
    } catch (error) {
      next(error);
    }
  };
}

// Capability requirement middleware factory
export function requireCapability(...requiredCaps: Capability[]) {
  const securityLoggingEnabled = process.env.SECURITY_LOGGING !== 'false';

  return function capabilityMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    if (!req.ctx) {
      res.status(500).json({ error: 'Auth context not initialized' });
      return;
    }

    const missing = requiredCaps.filter(cap => !req.ctx.hasCapability(cap));

    if (missing.length > 0) {
      if (securityLoggingEnabled) {
        logSecurityEvent('permission:denied', {
          userId: req.ctx.user.id,
          username: req.ctx.user.username,
          ipAddress: req.clientIP || req.ip || '0.0.0.0',
          userAgent: req.headers['user-agent'],
          requestPath: req.path,
          requestMethod: req.method,
          details: {
            required: requiredCaps,
            missing,
            userRoles: req.ctx.user.roles,
          },
        });
      }

      res.status(403).json({
        error: 'Forbidden',
        message: `Missing required capabilities: ${missing.join(', ')}`,
        required: requiredCaps,
        missing
      });
      return;
    }

    next();
  };
}

// Convenience middleware for common patterns
export function requireAnyCapability(...caps: Capability[]) {
  const securityLoggingEnabled = process.env.SECURITY_LOGGING !== 'false';

  return function(req: Request, res: Response, next: NextFunction) {
    if (!req.ctx) {
      res.status(500).json({ error: 'Auth context not initialized' });
      return;
    }

    if (!req.ctx.hasAnyCapability(...caps)) {
      if (securityLoggingEnabled) {
        logSecurityEvent('permission:denied', {
          userId: req.ctx.user.id,
          username: req.ctx.user.username,
          ipAddress: req.clientIP || req.ip || '0.0.0.0',
          userAgent: req.headers['user-agent'],
          requestPath: req.path,
          requestMethod: req.method,
          details: {
            requiredAny: caps,
            userRoles: req.ctx.user.roles,
          },
        });
      }

      res.status(403).json({
        error: 'Forbidden',
        message: `Requires at least one of: ${caps.join(', ')}`,
        required: caps
      });
      return;
    }

    next();
  };
}
