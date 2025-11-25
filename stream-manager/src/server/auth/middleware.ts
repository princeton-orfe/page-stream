import type { Request, Response, NextFunction } from 'express';
import { AuthConfig, RequestContext, User, Role, Capability } from './types.js';
import { extractUserFromRequest, createAnonymousUser } from './extractors.js';
import { createRequestContext, BUILT_IN_ROLES } from './rbac.js';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      ctx: RequestContext;
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
  return async function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      let user: User;
      const allRoles = await roleStore.getRoles();

      if (config.mode === 'none') {
        // Auth disabled: everyone is admin
        user = createAnonymousUser(['admin']);
      } else {
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
        } else if (config.roleMapping.anonymousRole) {
          // No user in headers but anonymous access allowed
          user = createAnonymousUser([config.roleMapping.anonymousRole]);
        } else {
          // No user and anonymous not allowed
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
  return function(req: Request, res: Response, next: NextFunction) {
    if (!req.ctx) {
      res.status(500).json({ error: 'Auth context not initialized' });
      return;
    }

    if (!req.ctx.hasAnyCapability(...caps)) {
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
