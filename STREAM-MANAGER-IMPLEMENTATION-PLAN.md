# Stream Manager GUI - Implementation Plan

Do not push to origin during this work.

## Overview

This document provides detailed agent instructions for building a web-based control plane for the page-stream system. The implementation follows four progressive phases, each building on the previous and delivering incremental value.

**Target Architecture**: Node.js backend + React frontend, containerized as a sidecar service.

**Core Principle**: Each phase must be fully functional and tested before proceeding to the next. Do not skip ahead or implement partial features across phases.

**Auth Philosophy**: RBAC foundations are built from Phase 1, but authentication is disabled by default. The system is designed to accept user identity from upstream proxies (oauth2-proxy, Azure EasyAuth, nginx auth_request) via HTTP headers, with graceful fallback to anonymous access when no auth proxy is present.

---

## Authentication & Authorization Architecture

### Design Principles

1. **Auth-Ready from Day One**: All API endpoints and UI components are built with authorization checks from Phase 1, even when auth is disabled.
2. **Zero-Config Default**: Without configuration, the system runs in "open mode" with full access for all users.
3. **Proxy-Based Identity**: User identity comes from trusted HTTP headers set by upstream auth proxies, not from the application itself.
4. **Capability-Based RBAC**: Permissions are defined as granular capabilities, grouped into roles, assigned to users.
5. **Audit Everything**: All actions are logged with user identity (or "anonymous") from the start.

### Supported Auth Patterns

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Deployment Options                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Option A: No Auth (Default)                                            │
│  ┌──────────┐      ┌──────────────────┐                                 │
│  │  Browser │─────▶│  Stream Manager  │  AUTH_MODE=none                 │
│  └──────────┘      │  (port 3001)     │  All users = admin              │
│                    └──────────────────┘                                 │
│                                                                          │
│  Option B: oauth2-proxy                                                 │
│  ┌──────────┐      ┌──────────────┐      ┌──────────────────┐          │
│  │  Browser │─────▶│ oauth2-proxy │─────▶│  Stream Manager  │          │
│  └──────────┘      │ (port 4180)  │      │  (port 3001)     │          │
│                    └──────────────┘      └──────────────────┘          │
│                    Sets headers:          Reads headers:                │
│                    X-Forwarded-User       X-Forwarded-User              │
│                    X-Forwarded-Email      X-Forwarded-Email             │
│                    X-Forwarded-Groups     X-Forwarded-Groups            │
│                                                                          │
│  Option C: Azure EasyAuth / App Service Auth                            │
│  ┌──────────┐      ┌──────────────┐      ┌──────────────────┐          │
│  │  Browser │─────▶│ Azure Front  │─────▶│  Stream Manager  │          │
│  └──────────┘      │ Door/AppGW   │      │  (port 3001)     │          │
│                    └──────────────┘      └──────────────────┘          │
│                    Sets headers:          Reads headers:                │
│                    X-MS-CLIENT-PRINCIPAL  X-MS-CLIENT-PRINCIPAL         │
│                    X-MS-CLIENT-PRINCIPAL- X-MS-CLIENT-PRINCIPAL-NAME    │
│                    NAME                                                  │
│                                                                          │
│  Option D: Generic Reverse Proxy (nginx, traefik)                       │
│  ┌──────────┐      ┌──────────────┐      ┌──────────────────┐          │
│  │  Browser │─────▶│ nginx +      │─────▶│  Stream Manager  │          │
│  └──────────┘      │ auth_request │      │  (port 3001)     │          │
│                    └──────────────┘      └──────────────────┘          │
│                    Sets headers:          Reads headers:                │
│                    X-Remote-User          X-Remote-User                 │
│                    X-Remote-Groups        X-Remote-Groups               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### RBAC Model

```typescript
// Granular capabilities (permissions)
type Capability =
  // Read capabilities
  | 'streams:list'           // View stream list
  | 'streams:read'           // View stream details
  | 'streams:logs'           // View stream logs
  | 'streams:health'         // View health metrics
  // Control capabilities
  | 'streams:start'          // Start streams
  | 'streams:stop'           // Stop streams
  | 'streams:refresh'        // Refresh page
  | 'streams:restart'        // Restart streams
  // Management capabilities
  | 'streams:create'         // Create new streams
  | 'streams:update'         // Modify stream config
  | 'streams:delete'         // Delete streams
  // Compositor capabilities
  | 'compositors:list'
  | 'compositors:read'
  | 'compositors:create'
  | 'compositors:update'
  | 'compositors:delete'
  | 'compositors:control'
  // Group capabilities
  | 'groups:list'
  | 'groups:read'
  | 'groups:create'
  | 'groups:update'
  | 'groups:delete'
  | 'groups:control'
  // Schedule capabilities
  | 'schedules:list'
  | 'schedules:read'
  | 'schedules:create'
  | 'schedules:update'
  | 'schedules:delete'
  // Alert capabilities
  | 'alerts:list'
  | 'alerts:read'
  | 'alerts:create'
  | 'alerts:update'
  | 'alerts:delete'
  // Template capabilities
  | 'templates:list'
  | 'templates:read'
  | 'templates:create'
  | 'templates:delete'
  // Admin capabilities
  | 'audit:read'             // View audit logs
  | 'users:list'             // View user list
  | 'users:manage'           // Manage user roles
  | 'system:config'          // Modify system settings

// Pre-defined roles (can be customized)
interface Role {
  id: string;
  name: string;
  description: string;
  capabilities: Capability[];
  builtIn: boolean;          // true = cannot be deleted
}

// Default roles
const BUILT_IN_ROLES: Role[] = [
  {
    id: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to dashboard and logs',
    capabilities: [
      'streams:list', 'streams:read', 'streams:logs', 'streams:health',
      'compositors:list', 'compositors:read',
      'groups:list', 'groups:read',
      'schedules:list', 'schedules:read',
      'alerts:list', 'alerts:read',
      'templates:list', 'templates:read'
    ],
    builtIn: true
  },
  {
    id: 'operator',
    name: 'Operator',
    description: 'Can start, stop, and refresh streams',
    capabilities: [
      // All viewer capabilities
      'streams:list', 'streams:read', 'streams:logs', 'streams:health',
      'compositors:list', 'compositors:read',
      'groups:list', 'groups:read',
      'schedules:list', 'schedules:read',
      'alerts:list', 'alerts:read',
      'templates:list', 'templates:read',
      // Plus control capabilities
      'streams:start', 'streams:stop', 'streams:refresh', 'streams:restart',
      'compositors:control',
      'groups:control'
    ],
    builtIn: true
  },
  {
    id: 'editor',
    name: 'Editor',
    description: 'Can create and modify streams',
    capabilities: [
      // All operator capabilities
      'streams:list', 'streams:read', 'streams:logs', 'streams:health',
      'streams:start', 'streams:stop', 'streams:refresh', 'streams:restart',
      'compositors:list', 'compositors:read', 'compositors:control',
      'groups:list', 'groups:read', 'groups:control',
      'schedules:list', 'schedules:read',
      'alerts:list', 'alerts:read',
      'templates:list', 'templates:read',
      // Plus management capabilities
      'streams:create', 'streams:update', 'streams:delete',
      'compositors:create', 'compositors:update', 'compositors:delete',
      'groups:create', 'groups:update', 'groups:delete',
      'schedules:create', 'schedules:update', 'schedules:delete',
      'alerts:create', 'alerts:update', 'alerts:delete',
      'templates:create', 'templates:delete'
    ],
    builtIn: true
  },
  {
    id: 'admin',
    name: 'Administrator',
    description: 'Full system access',
    capabilities: ['*'],  // Special: all capabilities
    builtIn: true
  }
];
```

---

## Phase 1: Read-Only Dashboard (with RBAC Foundation)

### Objective
Create a functional dashboard that displays real-time status of all page-stream containers. Establish the complete auth/RBAC infrastructure even though it defaults to open access.

### Prerequisites
- Ensure Docker is running and page-stream containers can be started via existing docker-compose
- Node.js 18+ available in development environment

### Directory Structure
```
stream-manager/
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml          # Extends main compose, adds manager service
├── src/
│   ├── server/
│   │   ├── index.ts            # Express server entry
│   │   ├── docker.ts           # Docker API client wrapper
│   │   ├── health-parser.ts    # Parse [health] JSON from logs
│   │   ├── auth/
│   │   │   ├── index.ts        # Auth module entry, exports middleware
│   │   │   ├── types.ts        # User, Role, Capability types
│   │   │   ├── extractors.ts   # Header extraction for each auth mode
│   │   │   ├── rbac.ts         # Role/capability checking logic
│   │   │   ├── middleware.ts   # Express middleware for auth
│   │   │   └── context.ts      # Request context with user info
│   │   ├── routes/
│   │   │   ├── streams.ts      # GET /api/streams, /api/streams/:id
│   │   │   └── auth.ts         # GET /api/auth/me, /api/auth/capabilities
│   │   ├── db/
│   │   │   ├── index.ts        # Database initialization
│   │   │   ├── migrations.ts   # Schema migrations
│   │   │   └── users.ts        # User-role mappings storage
│   │   └── websocket.ts        # WebSocket server for real-time updates
│   └── client/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── Dashboard.tsx
│       │   ├── StreamCard.tsx
│       │   ├── StreamDetail.tsx
│       │   ├── HealthIndicator.tsx
│       │   ├── LogViewer.tsx
│       │   └── UserMenu.tsx       # Shows current user, role
│       ├── hooks/
│       │   ├── useStreams.ts
│       │   ├── useWebSocket.ts
│       │   └── useAuth.ts         # Current user and capabilities
│       ├── contexts/
│       │   └── AuthContext.tsx    # Auth state provider
│       └── types.ts
└── tests/
    ├── server/
    │   ├── docker.test.ts
    │   ├── health-parser.test.ts
    │   └── auth/
    │       ├── extractors.test.ts
    │       ├── rbac.test.ts
    │       └── middleware.test.ts
    └── client/
        └── components.test.tsx
```

### Step 1.1: Initialize Project

**Instructions:**
1. Create `stream-manager/` directory at project root
2. Initialize package.json with the following dependencies:
   - **Backend**: express, dockerode, ws, cors, helmet, better-sqlite3
   - **Frontend**: react, react-dom, @tanstack/react-query
   - **Build**: typescript, vite, esbuild, tsx
   - **Test**: vitest, @testing-library/react, supertest
3. Configure TypeScript with strict mode enabled
4. Configure Vite for React frontend build
5. Create `.gitignore` excluding node_modules, dist, .env

**Validation:**
- `npm install` completes without errors
- `npm run typecheck` passes with no source files (empty project compiles)

### Step 1.2: Auth Types and RBAC Core

**Instructions:**
1. Create `src/server/auth/types.ts` with core types:

```typescript
// All possible capabilities in the system
export type Capability =
  | 'streams:list' | 'streams:read' | 'streams:logs' | 'streams:health'
  | 'streams:start' | 'streams:stop' | 'streams:refresh' | 'streams:restart'
  | 'streams:create' | 'streams:update' | 'streams:delete'
  | 'compositors:list' | 'compositors:read' | 'compositors:create'
  | 'compositors:update' | 'compositors:delete' | 'compositors:control'
  | 'groups:list' | 'groups:read' | 'groups:create'
  | 'groups:update' | 'groups:delete' | 'groups:control'
  | 'schedules:list' | 'schedules:read' | 'schedules:create'
  | 'schedules:update' | 'schedules:delete'
  | 'alerts:list' | 'alerts:read' | 'alerts:create'
  | 'alerts:update' | 'alerts:delete'
  | 'templates:list' | 'templates:read' | 'templates:create' | 'templates:delete'
  | 'audit:read' | 'users:list' | 'users:manage' | 'system:config';

export interface Role {
  id: string;
  name: string;
  description: string;
  capabilities: Capability[] | ['*'];  // '*' means all capabilities
  builtIn: boolean;
}

export interface User {
  // Identity (from auth proxy headers)
  id: string;              // Unique identifier (username or sub claim)
  username: string;        // Display name
  email?: string;
  groups?: string[];       // Group memberships from IdP

  // Authorization (from local DB or header mapping)
  roles: string[];         // Role IDs assigned to user

  // Metadata
  authSource: 'header' | 'anonymous';
  lastSeen?: string;
}

export interface AuthConfig {
  mode: 'none' | 'proxy';

  // Header names to extract user info (when mode='proxy')
  headers: {
    userId: string;        // Default: 'x-forwarded-user'
    email: string;         // Default: 'x-forwarded-email'
    groups: string;        // Default: 'x-forwarded-groups'
    name: string;          // Default: 'x-forwarded-preferred-username'
  };

  // How to determine roles when auth is enabled
  roleMapping: {
    // Map IdP groups to roles
    groupRoles: Record<string, string[]>;  // e.g., { 'admins': ['admin'], 'operators': ['operator'] }
    // Default role for authenticated users not in any mapped group
    defaultRole: string;   // Default: 'viewer'
    // Role for unauthenticated requests (when allowed)
    anonymousRole: string | null;  // null = deny, 'viewer' = allow read-only
  };

  // Trust settings
  trustedProxies: string[];  // IP ranges to trust for headers
}

// Request context available to all handlers
export interface RequestContext {
  user: User;
  capabilities: Set<Capability>;
  hasCapability: (cap: Capability) => boolean;
  hasAnyCapability: (...caps: Capability[]) => boolean;
  hasAllCapabilities: (...caps: Capability[]) => boolean;
}
```

2. Create `src/server/auth/rbac.ts`:

```typescript
import { Capability, Role, User, RequestContext } from './types';

// Built-in roles definition
export const BUILT_IN_ROLES: Role[] = [
  {
    id: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to dashboard and logs',
    capabilities: [
      'streams:list', 'streams:read', 'streams:logs', 'streams:health',
      'compositors:list', 'compositors:read',
      'groups:list', 'groups:read',
      'schedules:list', 'schedules:read',
      'alerts:list', 'alerts:read',
      'templates:list', 'templates:read'
    ],
    builtIn: true
  },
  {
    id: 'operator',
    name: 'Operator',
    description: 'Can control streams (start/stop/refresh)',
    capabilities: [
      'streams:list', 'streams:read', 'streams:logs', 'streams:health',
      'streams:start', 'streams:stop', 'streams:refresh', 'streams:restart',
      'compositors:list', 'compositors:read', 'compositors:control',
      'groups:list', 'groups:read', 'groups:control',
      'schedules:list', 'schedules:read',
      'alerts:list', 'alerts:read',
      'templates:list', 'templates:read'
    ],
    builtIn: true
  },
  {
    id: 'editor',
    name: 'Editor',
    description: 'Can create and modify streams',
    capabilities: [
      'streams:list', 'streams:read', 'streams:logs', 'streams:health',
      'streams:start', 'streams:stop', 'streams:refresh', 'streams:restart',
      'streams:create', 'streams:update', 'streams:delete',
      'compositors:list', 'compositors:read', 'compositors:control',
      'compositors:create', 'compositors:update', 'compositors:delete',
      'groups:list', 'groups:read', 'groups:control',
      'groups:create', 'groups:update', 'groups:delete',
      'schedules:list', 'schedules:read',
      'schedules:create', 'schedules:update', 'schedules:delete',
      'alerts:list', 'alerts:read',
      'alerts:create', 'alerts:update', 'alerts:delete',
      'templates:list', 'templates:read',
      'templates:create', 'templates:delete'
    ],
    builtIn: true
  },
  {
    id: 'admin',
    name: 'Administrator',
    description: 'Full system access',
    capabilities: ['*'],
    builtIn: true
  }
];

// All capabilities for wildcard expansion
export const ALL_CAPABILITIES: Capability[] = [
  'streams:list', 'streams:read', 'streams:logs', 'streams:health',
  'streams:start', 'streams:stop', 'streams:refresh', 'streams:restart',
  'streams:create', 'streams:update', 'streams:delete',
  'compositors:list', 'compositors:read', 'compositors:create',
  'compositors:update', 'compositors:delete', 'compositors:control',
  'groups:list', 'groups:read', 'groups:create',
  'groups:update', 'groups:delete', 'groups:control',
  'schedules:list', 'schedules:read', 'schedules:create',
  'schedules:update', 'schedules:delete',
  'alerts:list', 'alerts:read', 'alerts:create',
  'alerts:update', 'alerts:delete',
  'templates:list', 'templates:read', 'templates:create', 'templates:delete',
  'audit:read', 'users:list', 'users:manage', 'system:config'
];

// Resolve capabilities for a user based on their roles
export function resolveCapabilities(
  userRoles: string[],
  allRoles: Role[]
): Set<Capability> {
  const capabilities = new Set<Capability>();

  for (const roleId of userRoles) {
    const role = allRoles.find(r => r.id === roleId);
    if (!role) continue;

    if (role.capabilities.includes('*' as any)) {
      // Admin role: add all capabilities
      ALL_CAPABILITIES.forEach(cap => capabilities.add(cap));
    } else {
      (role.capabilities as Capability[]).forEach(cap => capabilities.add(cap));
    }
  }

  return capabilities;
}

// Create request context from user
export function createRequestContext(
  user: User,
  allRoles: Role[]
): RequestContext {
  const capabilities = resolveCapabilities(user.roles, allRoles);

  return {
    user,
    capabilities,
    hasCapability: (cap: Capability) => capabilities.has(cap),
    hasAnyCapability: (...caps: Capability[]) => caps.some(cap => capabilities.has(cap)),
    hasAllCapabilities: (...caps: Capability[]) => caps.every(cap => capabilities.has(cap))
  };
}
```

**Validation:**
- Write unit tests for `resolveCapabilities` with various role combinations
- Test wildcard expansion for admin role
- Test capability checking functions

### Step 1.3: Auth Header Extractors

**Instructions:**
1. Create `src/server/auth/extractors.ts`:

```typescript
import { Request } from 'express';
import { User, AuthConfig } from './types';

// Default configuration
export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  mode: 'none',
  headers: {
    userId: 'x-forwarded-user',
    email: 'x-forwarded-email',
    groups: 'x-forwarded-groups',
    name: 'x-forwarded-preferred-username'
  },
  roleMapping: {
    groupRoles: {},
    defaultRole: 'viewer',
    anonymousRole: null
  },
  trustedProxies: ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']
};

// Anonymous user (used when auth is disabled or no headers present)
export function createAnonymousUser(roles: string[]): User {
  return {
    id: 'anonymous',
    username: 'Anonymous',
    roles,
    authSource: 'anonymous'
  };
}

// Extract user from oauth2-proxy headers
export function extractOAuth2ProxyUser(req: Request, config: AuthConfig): User | null {
  const userId = req.headers[config.headers.userId] as string;
  if (!userId) return null;

  const email = req.headers[config.headers.email] as string;
  const name = req.headers[config.headers.name] as string;
  const groupsHeader = req.headers[config.headers.groups] as string;
  const groups = groupsHeader ? groupsHeader.split(',').map(g => g.trim()) : [];

  return {
    id: userId,
    username: name || userId,
    email,
    groups,
    roles: [],  // Will be resolved by middleware
    authSource: 'header'
  };
}

// Extract user from Azure EasyAuth headers
export function extractAzureEasyAuthUser(req: Request): User | null {
  // Azure passes a base64-encoded JSON in X-MS-CLIENT-PRINCIPAL
  const principalHeader = req.headers['x-ms-client-principal'] as string;
  const nameHeader = req.headers['x-ms-client-principal-name'] as string;

  if (!principalHeader && !nameHeader) return null;

  let userId = nameHeader || 'unknown';
  let email: string | undefined;
  let groups: string[] = [];

  if (principalHeader) {
    try {
      const decoded = JSON.parse(Buffer.from(principalHeader, 'base64').toString('utf8'));
      userId = decoded.userId || decoded.userDetails || nameHeader || 'unknown';

      // Extract claims
      const claims = decoded.claims || [];
      const emailClaim = claims.find((c: any) =>
        c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress' ||
        c.typ === 'email'
      );
      if (emailClaim) email = emailClaim.val;

      // Extract groups
      const groupClaims = claims.filter((c: any) =>
        c.typ === 'groups' ||
        c.typ === 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups'
      );
      groups = groupClaims.map((c: any) => c.val);
    } catch (e) {
      // Fall back to just the name header
    }
  }

  return {
    id: userId,
    username: nameHeader || userId,
    email,
    groups,
    roles: [],
    authSource: 'header'
  };
}

// Extract user from generic reverse proxy headers
export function extractGenericProxyUser(req: Request, config: AuthConfig): User | null {
  // Try common header patterns
  const userId =
    req.headers['x-remote-user'] as string ||
    req.headers['remote-user'] as string ||
    req.headers[config.headers.userId] as string;

  if (!userId) return null;

  const email = req.headers['x-remote-email'] as string;
  const groupsHeader = req.headers['x-remote-groups'] as string;
  const groups = groupsHeader ? groupsHeader.split(',').map(g => g.trim()) : [];

  return {
    id: userId,
    username: userId,
    email,
    groups,
    roles: [],
    authSource: 'header'
  };
}

// Main extraction function - tries all extractors
export function extractUserFromRequest(req: Request, config: AuthConfig): User | null {
  // Try Azure EasyAuth first (most specific headers)
  let user = extractAzureEasyAuthUser(req);
  if (user) return user;

  // Try oauth2-proxy style
  user = extractOAuth2ProxyUser(req, config);
  if (user) return user;

  // Try generic proxy
  user = extractGenericProxyUser(req, config);
  if (user) return user;

  return null;
}
```

**Validation:**
- Write tests for each extractor with mock headers
- Test Azure EasyAuth base64 decoding
- Test oauth2-proxy header parsing
- Test fallback behavior

### Step 1.4: Auth Middleware

**Instructions:**
1. Create `src/server/auth/middleware.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import { AuthConfig, RequestContext, User, Role, Capability } from './types';
import { extractUserFromRequest, createAnonymousUser, DEFAULT_AUTH_CONFIG } from './extractors';
import { resolveCapabilities, createRequestContext, BUILT_IN_ROLES } from './rbac';

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
export const requireAnyCapability = (...caps: Capability[]) => {
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
};
```

2. Create `src/server/auth/index.ts` as module entry:

```typescript
export * from './types';
export * from './rbac';
export * from './extractors';
export * from './middleware';
```

**Validation:**
- Test middleware with auth mode 'none' (should create admin user)
- Test middleware with auth mode 'proxy' and valid headers
- Test middleware with auth mode 'proxy' and missing headers
- Test capability requirement middleware
- Test role-to-capability resolution

### Step 1.5: Database and User Store

**Instructions:**
1. Create `src/server/db/index.ts`:

```typescript
import Database from 'better-sqlite3';
import { Role, AuthConfig } from '../auth/types';
import { BUILT_IN_ROLES } from '../auth/rbac';

let db: Database.Database;

export function initDatabase(dbPath: string): Database.Database {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Run migrations
  runMigrations(db);

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function runMigrations(db: Database.Database) {
  // Create migrations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const applied = db.prepare('SELECT name FROM migrations').all().map((r: any) => r.name);

  // Migration: roles table
  if (!applied.includes('001_roles')) {
    db.exec(`
      CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        capabilities TEXT NOT NULL,  -- JSON array
        built_in INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert built-in roles
    const insert = db.prepare(`
      INSERT INTO roles (id, name, description, capabilities, built_in)
      VALUES (?, ?, ?, ?, 1)
    `);

    for (const role of BUILT_IN_ROLES) {
      insert.run(role.id, role.name, role.description, JSON.stringify(role.capabilities));
    }

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('001_roles');
  }

  // Migration: user_roles table
  if (!applied.includes('002_user_roles')) {
    db.exec(`
      CREATE TABLE user_roles (
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        assigned_by TEXT,
        assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, role_id),
        FOREIGN KEY (role_id) REFERENCES roles(id)
      );
      CREATE INDEX idx_user_roles_user ON user_roles(user_id);
    `);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('002_user_roles');
  }

  // Migration: users table (for tracking seen users)
  if (!applied.includes('003_users')) {
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        email TEXT,
        first_seen TEXT DEFAULT CURRENT_TIMESTAMP,
        last_seen TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('003_users');
  }

  // Migration: audit_log table
  if (!applied.includes('004_audit_log')) {
    db.exec(`
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        details TEXT,  -- JSON
        result TEXT,   -- 'success' | 'failure'
        error TEXT
      );
      CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX idx_audit_user ON audit_log(user_id);
      CREATE INDEX idx_audit_action ON audit_log(action);
    `);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('004_audit_log');
  }
}
```

2. Create `src/server/db/users.ts`:

```typescript
import { getDatabase } from './index';
import { Role, AuthConfig, Capability } from '../auth/types';
import { RoleStore } from '../auth/middleware';

export function createRoleStore(): RoleStore {
  return {
    async getRoles(): Promise<Role[]> {
      const db = getDatabase();
      const rows = db.prepare('SELECT * FROM roles').all() as any[];

      return rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        capabilities: JSON.parse(row.capabilities),
        builtIn: row.built_in === 1
      }));
    },

    async getUserRoles(userId: string): Promise<string[]> {
      const db = getDatabase();
      const rows = db.prepare(
        'SELECT role_id FROM user_roles WHERE user_id = ?'
      ).all(userId) as any[];

      return rows.map(row => row.role_id);
    },

    mapGroupsToRoles(groups: string[], config: AuthConfig): string[] {
      const roles: string[] = [];

      for (const group of groups) {
        const mappedRoles = config.roleMapping.groupRoles[group];
        if (mappedRoles) {
          roles.push(...mappedRoles);
        }
      }

      return [...new Set(roles)];
    }
  };
}

// Record that a user was seen (for tracking/admin)
export function recordUserSeen(userId: string, username: string, email?: string) {
  const db = getDatabase();

  db.prepare(`
    INSERT INTO users (id, username, email, last_seen)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      email = COALESCE(excluded.email, users.email),
      last_seen = CURRENT_TIMESTAMP
  `).run(userId, username, email);
}

// Assign role to user
export function assignUserRole(userId: string, roleId: string, assignedBy: string) {
  const db = getDatabase();

  db.prepare(`
    INSERT OR REPLACE INTO user_roles (user_id, role_id, assigned_by, assigned_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run(userId, roleId, assignedBy);
}

// Remove role from user
export function removeUserRole(userId: string, roleId: string) {
  const db = getDatabase();
  db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(userId, roleId);
}

// List all known users with their roles
export function listUsers() {
  const db = getDatabase();

  const users = db.prepare(`
    SELECT
      u.id,
      u.username,
      u.email,
      u.first_seen,
      u.last_seen,
      GROUP_CONCAT(ur.role_id) as roles
    FROM users u
    LEFT JOIN user_roles ur ON u.id = ur.user_id
    GROUP BY u.id
    ORDER BY u.last_seen DESC
  `).all() as any[];

  return users.map(u => ({
    ...u,
    roles: u.roles ? u.roles.split(',') : []
  }));
}
```

3. Create `src/server/db/audit.ts`:

```typescript
import { getDatabase } from './index';
import { User } from '../auth/types';

export interface AuditEntry {
  id: number;
  timestamp: string;
  userId: string;
  username: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, any>;
  result: 'success' | 'failure';
  error?: string;
}

export function logAuditEvent(
  user: User,
  action: string,
  options: {
    resourceType?: string;
    resourceId?: string;
    details?: Record<string, any>;
    result?: 'success' | 'failure';
    error?: string;
  } = {}
) {
  const db = getDatabase();

  db.prepare(`
    INSERT INTO audit_log (user_id, username, action, resource_type, resource_id, details, result, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    user.username,
    action,
    options.resourceType || null,
    options.resourceId || null,
    options.details ? JSON.stringify(options.details) : null,
    options.result || 'success',
    options.error || null
  );
}

export function queryAuditLog(options: {
  limit?: number;
  offset?: number;
  userId?: string;
  action?: string;
  resourceType?: string;
  since?: string;
}): { entries: AuditEntry[]; total: number } {
  const db = getDatabase();

  let where = '1=1';
  const params: any[] = [];

  if (options.userId) {
    where += ' AND user_id = ?';
    params.push(options.userId);
  }
  if (options.action) {
    where += ' AND action = ?';
    params.push(options.action);
  }
  if (options.resourceType) {
    where += ' AND resource_type = ?';
    params.push(options.resourceType);
  }
  if (options.since) {
    where += ' AND timestamp >= ?';
    params.push(options.since);
  }

  const total = (db.prepare(`SELECT COUNT(*) as count FROM audit_log WHERE ${where}`).get(...params) as any).count;

  const limit = options.limit || 100;
  const offset = options.offset || 0;

  const rows = db.prepare(`
    SELECT * FROM audit_log
    WHERE ${where}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

  return {
    entries: rows.map(row => ({
      ...row,
      details: row.details ? JSON.parse(row.details) : undefined
    })),
    total
  };
}
```

**Validation:**
- Test database initialization creates tables
- Test role CRUD operations
- Test user role assignment
- Test audit logging
- Test migrations are idempotent

### Step 1.6: Docker API Client

**Instructions:**
1. Create `src/server/docker.ts` using `dockerode` library
2. Implement the following functions:

```typescript
interface StreamContainer {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'restarting' | 'exited';
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  created: string;
  image: string;
  labels: Record<string, string>;
  ports: Array<{ container: number; host?: number; protocol: string }>;
}

// List all page-stream containers (filter by image or label)
async function listStreamContainers(): Promise<StreamContainer[]>

// Get detailed info for single container
async function getContainer(id: string): Promise<StreamContainer | null>

// Stream logs from container (returns async iterator)
async function* streamLogs(id: string, since?: number): AsyncGenerator<string>

// Get recent logs (last N lines)
async function getRecentLogs(id: string, lines?: number): Promise<string[]>
```

3. Filter containers by:
   - Image name containing `page-stream` OR
   - Label `com.page-stream.managed=true`
4. Handle Docker socket connection errors gracefully
5. Implement connection retry with exponential backoff

**Validation:**
- Write unit tests in `tests/server/docker.test.ts`
- Tests should use Docker socket if available, skip gracefully if not
- Test listing containers returns expected structure
- Test log streaming produces lines

### Step 1.7: Health Log Parser

**Instructions:**
1. Create `src/server/health-parser.ts`
2. Parse `[health]` prefixed JSON lines from container logs:

```typescript
interface HealthStatus {
  timestamp: string;
  uptimeSec: number;
  ingest: string;
  protocol: 'SRT' | 'RTMP' | 'FILE' | 'UNKNOWN';
  restartAttempt: number;
  lastFfmpegExitCode: number | null;
  retrying: boolean;
  infobarDismissTried: boolean;
}

// Parse a single log line, return null if not a health line
function parseHealthLine(line: string): HealthStatus | null

// Extract all health entries from log lines
function extractHealthHistory(lines: string[]): HealthStatus[]

// Get most recent health status
function getLatestHealth(lines: string[]): HealthStatus | null
```

3. Handle malformed JSON gracefully (log warning, return null)
4. Support both formats: `[health] {...}` and raw JSON lines

**Validation:**
- Write unit tests with sample log lines from actual page-stream output
- Test parsing valid health JSON
- Test handling malformed lines
- Test extracting history from mixed log content

### Step 1.8: REST API Routes

**Instructions:**
1. Create `src/server/routes/streams.ts` with Express router
2. Implement endpoints with capability checks:

```typescript
import { Router } from 'express';
import { requireCapability } from '../auth';
import { logAuditEvent } from '../db/audit';

const router = Router();

// GET /api/streams - List all streams
router.get('/',
  requireCapability('streams:list'),
  async (req, res) => {
    // Log read access (optional, can be noisy)
    // logAuditEvent(req.ctx.user, 'streams:list', { resourceType: 'stream' });

    const streams = await listStreamContainers();
    res.json({ streams, timestamp: new Date().toISOString() });
  }
);

// GET /api/streams/:id - Get stream details
router.get('/:id',
  requireCapability('streams:read'),
  async (req, res) => {
    const stream = await getContainer(req.params.id);
    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }

    const logs = await getRecentLogs(req.params.id, 100);
    const health = getLatestHealth(logs);

    res.json({ stream, health, recentLogs: logs });
  }
);

// GET /api/streams/:id/logs
router.get('/:id/logs',
  requireCapability('streams:logs'),
  async (req, res) => {
    const lines = parseInt(req.query.lines as string) || 100;
    const logs = await getRecentLogs(req.params.id, lines);
    res.json({ logs, hasMore: logs.length === lines });
  }
);

// GET /api/streams/:id/health/history
router.get('/:id/health/history',
  requireCapability('streams:health'),
  async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const logs = await getRecentLogs(req.params.id, 500);
    const history = extractHealthHistory(logs).slice(0, limit);
    res.json({ history, latest: history[0] || null });
  }
);

export default router;
```

3. Create `src/server/routes/auth.ts`:

```typescript
import { Router } from 'express';
import { requireCapability } from '../auth';
import { listUsers, assignUserRole, removeUserRole } from '../db/users';
import { logAuditEvent } from '../db/audit';

const router = Router();

// GET /api/auth/me - Get current user info
router.get('/me', (req, res) => {
  res.json({
    user: {
      id: req.ctx.user.id,
      username: req.ctx.user.username,
      email: req.ctx.user.email,
      roles: req.ctx.user.roles,
      authSource: req.ctx.user.authSource
    },
    capabilities: Array.from(req.ctx.capabilities)
  });
});

// GET /api/auth/capabilities - List all capabilities (for UI)
router.get('/capabilities', (req, res) => {
  res.json({
    capabilities: Array.from(req.ctx.capabilities),
    // Helper booleans for common checks
    canControl: req.ctx.hasAnyCapability('streams:start', 'streams:stop'),
    canManage: req.ctx.hasAnyCapability('streams:create', 'streams:update', 'streams:delete'),
    canAdmin: req.ctx.hasCapability('users:manage')
  });
});

// GET /api/auth/users - List all users (admin only)
router.get('/users',
  requireCapability('users:list'),
  async (req, res) => {
    const users = listUsers();
    res.json({ users });
  }
);

// PUT /api/auth/users/:id/roles - Update user roles (admin only)
router.put('/users/:id/roles',
  requireCapability('users:manage'),
  async (req, res) => {
    const { roles } = req.body;
    const targetUserId = req.params.id;

    // Get current roles for comparison
    const currentUsers = listUsers();
    const targetUser = currentUsers.find(u => u.id === targetUserId);

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Calculate changes
    const toAdd = roles.filter((r: string) => !targetUser.roles.includes(r));
    const toRemove = targetUser.roles.filter((r: string) => !roles.includes(r));

    // Apply changes
    for (const roleId of toAdd) {
      assignUserRole(targetUserId, roleId, req.ctx.user.id);
    }
    for (const roleId of toRemove) {
      removeUserRole(targetUserId, roleId);
    }

    // Audit log
    logAuditEvent(req.ctx.user, 'users:update_roles', {
      resourceType: 'user',
      resourceId: targetUserId,
      details: { added: toAdd, removed: toRemove, newRoles: roles }
    });

    res.json({ success: true, roles });
  }
);

export default router;
```

4. Add error handling middleware with consistent error response format
5. Add request logging middleware

**Validation:**
- Write integration tests using supertest
- Test each endpoint with mock Docker client
- Test capability enforcement (403 when missing)
- Test error responses (404, 500)
- Verify response structure matches TypeScript types

### Step 1.9: WebSocket Server

**Instructions:**
1. Create `src/server/websocket.ts` using `ws` library
2. Implement real-time updates with auth context:

```typescript
import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { AuthConfig, RequestContext } from './auth/types';
import { extractUserFromRequest, createAnonymousUser } from './auth/extractors';
import { createRequestContext, BUILT_IN_ROLES } from './auth/rbac';
import { createRoleStore } from './db/users';

// Message types from server to client
type ServerMessage =
  | { type: 'auth'; data: { user: { id: string; username: string }; capabilities: string[] } }
  | { type: 'streams:list'; data: StreamContainer[] }
  | { type: 'stream:health'; id: string; data: HealthStatus }
  | { type: 'stream:log'; id: string; data: string }
  | { type: 'stream:status'; id: string; data: { status: string; health: string } }
  | { type: 'error'; message: string; code?: string }

// Message types from client to server
type ClientMessage =
  | { type: 'subscribe:logs'; id: string }
  | { type: 'unsubscribe:logs'; id: string }
  | { type: 'subscribe:health'; id: string }
  | { type: 'unsubscribe:health'; id: string }

interface AuthenticatedSocket extends WebSocket {
  ctx: RequestContext;
  subscriptions: Set<string>;
}

export function createWebSocketServer(
  server: http.Server,
  authConfig: AuthConfig
) {
  const wss = new WebSocketServer({ server });
  const roleStore = createRoleStore();

  wss.on('connection', async (ws: AuthenticatedSocket, req: IncomingMessage) => {
    // Authenticate WebSocket connection using same header logic
    let ctx: RequestContext;

    if (authConfig.mode === 'none') {
      const user = createAnonymousUser(['admin']);
      ctx = createRequestContext(user, BUILT_IN_ROLES);
    } else {
      // Create fake Express request for header extraction
      const fakeReq = { headers: req.headers } as any;
      const user = extractUserFromRequest(fakeReq, authConfig);

      if (!user && !authConfig.roleMapping.anonymousRole) {
        ws.close(4401, 'Authentication required');
        return;
      }

      const finalUser = user || createAnonymousUser([authConfig.roleMapping.anonymousRole!]);

      // Resolve roles
      const groupRoles = roleStore.mapGroupsToRoles(finalUser.groups || [], authConfig);
      const dbRoles = await roleStore.getUserRoles(finalUser.id);
      finalUser.roles = [...new Set([...groupRoles, ...dbRoles])];

      if (finalUser.roles.length === 0) {
        finalUser.roles = [authConfig.roleMapping.defaultRole];
      }

      const allRoles = await roleStore.getRoles();
      ctx = createRequestContext(finalUser, allRoles);
    }

    ws.ctx = ctx;
    ws.subscriptions = new Set();

    // Send auth info on connect
    ws.send(JSON.stringify({
      type: 'auth',
      data: {
        user: { id: ctx.user.id, username: ctx.user.username },
        capabilities: Array.from(ctx.capabilities)
      }
    }));

    // Handle messages
    ws.on('message', (data) => {
      try {
        const msg: ClientMessage = JSON.parse(data.toString());
        handleClientMessage(ws, msg);
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    // Cleanup on disconnect
    ws.on('close', () => {
      ws.subscriptions.clear();
    });
  });

  return wss;
}

function handleClientMessage(ws: AuthenticatedSocket, msg: ClientMessage) {
  switch (msg.type) {
    case 'subscribe:logs':
      if (!ws.ctx.hasCapability('streams:logs')) {
        ws.send(JSON.stringify({ type: 'error', message: 'Permission denied', code: 'FORBIDDEN' }));
        return;
      }
      ws.subscriptions.add(`logs:${msg.id}`);
      break;

    case 'unsubscribe:logs':
      ws.subscriptions.delete(`logs:${msg.id}`);
      break;

    case 'subscribe:health':
      if (!ws.ctx.hasCapability('streams:health')) {
        ws.send(JSON.stringify({ type: 'error', message: 'Permission denied', code: 'FORBIDDEN' }));
        return;
      }
      ws.subscriptions.add(`health:${msg.id}`);
      break;

    case 'unsubscribe:health':
      ws.subscriptions.delete(`health:${msg.id}`);
      break;
  }
}
```

3. Poll Docker API every 5 seconds for container status changes
4. Stream logs in real-time for subscribed containers (respect capabilities)
5. Parse and broadcast health updates as they appear in logs
6. Handle client disconnect gracefully (cleanup subscriptions)
7. Implement heartbeat/ping-pong for connection health

**Validation:**
- Test WebSocket connection establishment
- Test auth context propagation to WebSocket
- Test subscription/unsubscription with capability checks
- Test message broadcast to multiple clients
- Test reconnection handling

### Step 1.10: Express Server Entry

**Instructions:**
1. Create `src/server/index.ts` as main entry point
2. Configure:
   - CORS (allow frontend origin)
   - Helmet security headers
   - JSON body parser
   - Static file serving (for production frontend build)
   - Auth middleware (before API routes)
   - API routes under `/api`
   - WebSocket upgrade handling

```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { initDatabase } from './db';
import { createAuthMiddleware, DEFAULT_AUTH_CONFIG, AuthConfig } from './auth';
import { createRoleStore, recordUserSeen } from './db/users';
import { createWebSocketServer } from './websocket';
import streamsRouter from './routes/streams';
import authRouter from './routes/auth';

// Load config from environment
function loadAuthConfig(): AuthConfig {
  const mode = (process.env.AUTH_MODE || 'none') as 'none' | 'proxy';

  return {
    ...DEFAULT_AUTH_CONFIG,
    mode,
    headers: {
      userId: process.env.AUTH_HEADER_USER || DEFAULT_AUTH_CONFIG.headers.userId,
      email: process.env.AUTH_HEADER_EMAIL || DEFAULT_AUTH_CONFIG.headers.email,
      groups: process.env.AUTH_HEADER_GROUPS || DEFAULT_AUTH_CONFIG.headers.groups,
      name: process.env.AUTH_HEADER_NAME || DEFAULT_AUTH_CONFIG.headers.name,
    },
    roleMapping: {
      groupRoles: process.env.AUTH_GROUP_ROLES
        ? JSON.parse(process.env.AUTH_GROUP_ROLES)
        : DEFAULT_AUTH_CONFIG.roleMapping.groupRoles,
      defaultRole: process.env.AUTH_DEFAULT_ROLE || DEFAULT_AUTH_CONFIG.roleMapping.defaultRole,
      anonymousRole: process.env.AUTH_ANONYMOUS_ROLE || DEFAULT_AUTH_CONFIG.roleMapping.anonymousRole,
    }
  };
}

async function main() {
  // Initialize database
  const dbPath = process.env.DATABASE_PATH || './data/stream-manager.db';
  initDatabase(dbPath);

  // Load auth config
  const authConfig = loadAuthConfig();
  const roleStore = createRoleStore();

  // Create Express app
  const app = express();
  const server = createServer(app);

  // Middleware
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' }));
  app.use(express.json());

  // Auth middleware - runs on all routes
  app.use(createAuthMiddleware(authConfig, roleStore));

  // Record user visits (for admin visibility)
  app.use((req, res, next) => {
    if (req.ctx.user.authSource === 'header') {
      recordUserSeen(req.ctx.user.id, req.ctx.user.username, req.ctx.user.email);
    }
    next();
  });

  // Health check (no auth required - for load balancers)
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', authMode: authConfig.mode });
  });

  // API routes
  app.use('/api/auth', authRouter);
  app.use('/api/streams', streamsRouter);

  // Static files (frontend)
  app.use(express.static('dist/client'));
  app.get('*', (req, res) => {
    res.sendFile('index.html', { root: 'dist/client' });
  });

  // WebSocket
  createWebSocketServer(server, authConfig);

  // Start server
  const port = parseInt(process.env.PORT || '3001');
  server.listen(port, () => {
    console.log(`Stream Manager running on port ${port}`);
    console.log(`Auth mode: ${authConfig.mode}`);
  });
}

main().catch(console.error);
```

3. Environment variables:
   - `PORT` (default: 3001)
   - `DOCKER_SOCKET` (default: /var/run/docker.sock)
   - `DATABASE_PATH` (default: ./data/stream-manager.db)
   - `CORS_ORIGIN` (default: http://localhost:3000)
   - `LOG_LEVEL` (default: info)
   - `AUTH_MODE` (default: 'none', options: 'none', 'proxy')
   - `AUTH_HEADER_USER` (default: 'x-forwarded-user')
   - `AUTH_HEADER_EMAIL` (default: 'x-forwarded-email')
   - `AUTH_HEADER_GROUPS` (default: 'x-forwarded-groups')
   - `AUTH_HEADER_NAME` (default: 'x-forwarded-preferred-username')
   - `AUTH_GROUP_ROLES` (JSON mapping, e.g., `{"admins":["admin"],"operators":["operator"]}`)
   - `AUTH_DEFAULT_ROLE` (default: 'viewer')
   - `AUTH_ANONYMOUS_ROLE` (default: null, set to 'viewer' to allow anonymous read)

4. Graceful shutdown handling (close WebSocket connections, Docker client, database)

**Validation:**
- Server starts without errors
- Health check endpoint at `GET /api/health` returns `{ status: 'ok', authMode: '...' }`
- `/api/auth/me` returns admin user when AUTH_MODE=none
- WebSocket connection succeeds at `ws://localhost:3001`

### Step 1.11: React Frontend - Auth Context

**Instructions:**
1. Create `src/client/contexts/AuthContext.tsx`:

```typescript
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Capability } from '../types';

interface User {
  id: string;
  username: string;
  email?: string;
  roles: string[];
  authSource: 'header' | 'anonymous';
}

interface AuthState {
  user: User | null;
  capabilities: Set<Capability>;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  hasCapability: (cap: Capability) => boolean;
  hasAnyCapability: (...caps: Capability[]) => boolean;
  canControl: boolean;
  canManage: boolean;
  canAdmin: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    capabilities: new Set(),
    loading: true,
    error: null
  });

  const fetchAuth = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) throw new Error('Failed to fetch auth info');

      const data = await res.json();
      setState({
        user: data.user,
        capabilities: new Set(data.capabilities),
        loading: false,
        error: null
      });
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: (e as Error).message }));
    }
  };

  useEffect(() => {
    fetchAuth();
  }, []);

  const value: AuthContextValue = {
    ...state,
    hasCapability: (cap) => state.capabilities.has(cap),
    hasAnyCapability: (...caps) => caps.some(cap => state.capabilities.has(cap)),
    canControl: state.capabilities.has('streams:start') || state.capabilities.has('streams:stop'),
    canManage: state.capabilities.has('streams:create') || state.capabilities.has('streams:update'),
    canAdmin: state.capabilities.has('users:manage'),
    refresh: fetchAuth
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

2. Create `src/client/hooks/useAuth.ts` (re-export for convenience):

```typescript
export { useAuth } from '../contexts/AuthContext';
```

3. Create `src/client/components/UserMenu.tsx`:

```typescript
import { useAuth } from '../hooks/useAuth';

export function UserMenu() {
  const { user, capabilities, canAdmin, loading } = useAuth();

  if (loading) return <div className="user-menu loading">...</div>;
  if (!user) return null;

  return (
    <div className="user-menu">
      <span className="username">{user.username}</span>
      <span className="role-badge">{user.roles[0]}</span>
      {user.authSource === 'anonymous' && (
        <span className="anon-badge" title="No authentication configured">
          (Open Mode)
        </span>
      )}
    </div>
  );
}
```

4. Create `src/client/components/CapabilityGate.tsx`:

```typescript
import { useAuth } from '../hooks/useAuth';
import { Capability } from '../types';

interface Props {
  require: Capability | Capability[];
  mode?: 'all' | 'any';
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function CapabilityGate({ require, mode = 'all', fallback = null, children }: Props) {
  const { hasCapability, hasAnyCapability } = useAuth();

  const caps = Array.isArray(require) ? require : [require];
  const hasAccess = mode === 'any'
    ? hasAnyCapability(...caps)
    : caps.every(hasCapability);

  return hasAccess ? <>{children}</> : <>{fallback}</>;
}
```

**Validation:**
- AuthContext provides user and capabilities
- useAuth hook returns expected values
- CapabilityGate hides/shows content based on capabilities

### Step 1.12: React Frontend - Components

**Instructions:**
1. Create `src/client/components/HealthIndicator.tsx`:
   - Display colored dot: green (healthy), yellow (starting/retrying), red (unhealthy/exited)
   - Tooltip with last health timestamp and details
   - Pulse animation for active streams

2. Create `src/client/components/StreamCard.tsx`:
   - Display: container name, status, health indicator, uptime
   - Show ingest URL (truncated with tooltip)
   - Show resolution if available from labels
   - Click to navigate to detail view
   - **Use CapabilityGate** to conditionally show action buttons (Phase 2 prep)

3. Create `src/client/components/LogViewer.tsx`:
   - Virtualized scrolling for performance (use react-window or similar)
   - Auto-scroll to bottom (toggleable)
   - Highlight `[health]` lines in distinct color
   - Highlight errors/warnings
   - Search/filter functionality

4. Create `src/client/components/StreamDetail.tsx`:
   - Full container information
   - Health history chart (simple line chart of uptime, restart count over time)
   - Embedded log viewer
   - Link to noVNC if port 6080 exposed
   - **Placeholder areas** for control buttons (gated by capability)

5. Create `src/client/components/Dashboard.tsx`:
   - Grid of StreamCards
   - Summary stats: total streams, healthy count, unhealthy count
   - Last updated timestamp
   - Auto-refresh indicator
   - UserMenu in header

6. Create `src/client/App.tsx`:
   - AuthProvider wrapping everything
   - React Query provider
   - WebSocket provider/context
   - Simple routing (dashboard vs detail view)
   - Basic layout with header showing UserMenu

**Validation:**
- Components render without errors
- Write snapshot tests for components
- Test with mock data
- Verify capability gates work in UI

### Step 1.13: Frontend Build and Styling

**Instructions:**
1. Configure Vite build outputting to `dist/client`
2. Add basic CSS (use CSS modules or Tailwind):
   - Dark theme (matches terminal aesthetic)
   - Responsive grid layout
   - Status color coding consistent throughout
   - User menu styling
   - Capability-hidden elements should not leave gaps
3. Create `src/client/index.html` with mounting point
4. Configure server to serve static files from `dist/client` in production

**Validation:**
- `npm run build` produces client bundle
- Server serves frontend at root path
- No console errors in browser

### Step 1.14: Docker Integration

**Instructions:**
1. Create `stream-manager/Dockerfile`:
   - Multi-stage build (build frontend, then production image)
   - Base: node:18-alpine
   - Copy dist and node_modules (production only)
   - Expose port 3001
   - Health check endpoint
   - Create data directory for SQLite

2. Create `stream-manager/docker-compose.yml`:
   - Extends from parent `docker-compose.stable.yml`
   - Adds `stream-manager` service
   - Mounts Docker socket (read-only for Phase 1)
   - Mounts data volume for SQLite persistence
   - Network configuration to reach other containers
   - Port mapping: 3001:3001
   - Environment variables for auth configuration

```yaml
  stream-manager:
    build:
      context: ./stream-manager
      dockerfile: Dockerfile
    container_name: stream-manager
    ports:
      - "3001:3001"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./stream-manager/data:/data
      - ./demo:/app/demo:ro
      - ./out:/out
    environment:
      - PORT=3001
      - DOCKER_SOCKET=/var/run/docker.sock
      - DATABASE_PATH=/data/stream-manager.db
      - LOG_LEVEL=info
      # Auth config (defaults to open mode)
      - AUTH_MODE=${AUTH_MODE:-none}
      - AUTH_HEADER_USER=${AUTH_HEADER_USER:-x-forwarded-user}
      - AUTH_HEADER_EMAIL=${AUTH_HEADER_EMAIL:-x-forwarded-email}
      - AUTH_HEADER_GROUPS=${AUTH_HEADER_GROUPS:-x-forwarded-groups}
      - AUTH_GROUP_ROLES=${AUTH_GROUP_ROLES:-}
      - AUTH_DEFAULT_ROLE=${AUTH_DEFAULT_ROLE:-viewer}
      - AUTH_ANONYMOUS_ROLE=${AUTH_ANONYMOUS_ROLE:-}
    labels:
      - "com.page-stream.manager=true"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

3. Add labels to existing page-stream services for identification:
   ```yaml
   labels:
     com.page-stream.managed: "true"
     com.page-stream.type: "standard"  # or "compositor-source"
   ```

**Validation:**
- `docker build` succeeds
- `docker-compose up stream-manager` starts service
- Dashboard shows existing page-stream containers
- Logs stream in real-time
- `/api/auth/me` returns admin user (AUTH_MODE=none default)

### Step 1.15: Testing and Documentation

**Instructions:**
1. Ensure all unit tests pass: `npm test`
2. Add integration tests:
   - Auth middleware with various header combinations
   - Capability enforcement on protected routes
   - WebSocket auth context
   - Role resolution from groups
3. Add test for oauth2-proxy header simulation
4. Add test for Azure EasyAuth header simulation
5. Create `stream-manager/README.md` with:
   - Quick start instructions
   - Environment variable reference (especially auth config)
   - Auth proxy integration guide (oauth2-proxy, Azure)
   - API endpoint documentation
   - Screenshot of dashboard

**Deliverables for Phase 1:**
- [ ] RBAC types and capability definitions
- [ ] Auth middleware supporting proxy headers
- [ ] Role-to-capability resolution
- [ ] User/role database storage
- [ ] Audit logging infrastructure
- [ ] Dashboard displays all page-stream containers
- [ ] Real-time status updates via WebSocket (with auth)
- [ ] Health status parsed and displayed
- [ ] Log viewing with search/filter
- [ ] UserMenu showing current user/role
- [ ] CapabilityGate component for conditional UI
- [ ] Containerized and runnable via docker-compose
- [ ] All tests passing
- [ ] README with auth configuration guide

---

## Phase 2: Control Actions

### Objective
Add ability to start, stop, and refresh existing streams. Enforce RBAC on control operations.

### Prerequisites
- Phase 1 complete and all tests passing
- Docker socket must be mounted read-write (not read-only)

### Step 2.1: Docker Control Functions

**Instructions:**
1. Extend `src/server/docker.ts` with control functions:

```typescript
// Start a stopped container
async function startContainer(id: string): Promise<void>

// Stop a running container (sends SIGTERM, waits for graceful shutdown)
async function stopContainer(id: string, timeout?: number): Promise<void>

// Restart a container
async function restartContainer(id: string): Promise<void>

// Execute command in container (for FIFO refresh)
async function execInContainer(id: string, cmd: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>

// Send signal to main process in container
async function signalContainer(id: string, signal: string): Promise<void>
```

2. Implement refresh via two methods:
   - Primary: Write to `/tmp/page_refresh_fifo` via exec
   - Fallback: Send SIGHUP signal
3. Add timeout handling for stop operations (default 30s)
4. Log all control actions for audit trail

**Validation:**
- Test start/stop with a test container
- Test exec command execution
- Test signal delivery
- Verify graceful shutdown completes

### Step 2.2: Control API Routes with RBAC

**Instructions:**
1. Add new routes to `src/server/routes/streams.ts` with capability requirements:

```typescript
// POST /api/streams/:id/start
router.post('/:id/start',
  requireCapability('streams:start'),
  async (req, res) => {
    const stream = await getContainer(req.params.id);
    if (!stream) return res.status(404).json({ error: 'Stream not found' });
    if (stream.status === 'running') return res.status(400).json({ error: 'Already running' });

    await startContainer(req.params.id);

    // Audit log
    logAuditEvent(req.ctx.user, 'stream:start', {
      resourceType: 'stream',
      resourceId: req.params.id,
      details: { streamName: stream.name }
    });

    res.json({ success: true, message: 'Container started' });
  }
);

// POST /api/streams/:id/stop
router.post('/:id/stop',
  requireCapability('streams:stop'),
  async (req, res) => {
    const { timeout } = req.body;
    const stream = await getContainer(req.params.id);
    if (!stream) return res.status(404).json({ error: 'Stream not found' });
    if (stream.status !== 'running') return res.status(400).json({ error: 'Not running' });

    await stopContainer(req.params.id, timeout);

    logAuditEvent(req.ctx.user, 'stream:stop', {
      resourceType: 'stream',
      resourceId: req.params.id,
      details: { streamName: stream.name, timeout }
    });

    res.json({ success: true, message: 'Container stopped' });
  }
);

// POST /api/streams/:id/restart
router.post('/:id/restart',
  requireCapability('streams:restart'),
  async (req, res) => {
    // ... similar pattern with audit logging
  }
);

// POST /api/streams/:id/refresh
router.post('/:id/refresh',
  requireCapability('streams:refresh'),
  async (req, res) => {
    // ... similar pattern with audit logging
  }
);
```

2. Add request validation middleware
3. Add rate limiting (max 1 control action per container per 5 seconds)
4. Broadcast status change via WebSocket after each action

**Validation:**
- Test each endpoint with running/stopped containers
- Test error cases (wrong state, not found)
- Test capability enforcement (operator can control, viewer cannot)
- Test rate limiting
- Verify audit log entries created
- Verify WebSocket broadcasts status changes

### Step 2.3: Frontend Control Buttons with Capability Gates

**Instructions:**
1. Update `src/client/components/StreamCard.tsx`:
   - Add Start/Stop toggle button **inside CapabilityGate**
   - Add Refresh button (only visible when running) **inside CapabilityGate**
   - Show loading state during actions
   - Disable buttons during pending actions

```typescript
<CapabilityGate require={['streams:start', 'streams:stop']} mode="any">
  <button
    onClick={handleToggle}
    disabled={isLoading}
  >
    {stream.status === 'running' ? 'Stop' : 'Start'}
  </button>
</CapabilityGate>

<CapabilityGate require="streams:refresh">
  {stream.status === 'running' && (
    <button onClick={handleRefresh} disabled={isLoading}>
      Refresh
    </button>
  )}
</CapabilityGate>
```

2. Update `src/client/components/StreamDetail.tsx`:
   - Add control button bar with capability gates
   - Add restart button
   - Show action history from audit log (if user has audit:read)
   - Confirmation dialog for stop action

3. Create `src/client/hooks/useStreamControl.ts`:
   - Mutation hooks for each action using React Query
   - Optimistic updates for UI responsiveness
   - Error handling with toast notifications
   - Check capabilities before showing buttons

4. Add toast notification system for action feedback

**Validation:**
- Buttons only appear for users with required capabilities
- Buttons trigger correct API calls
- UI updates optimistically then confirms
- Error states displayed appropriately
- Confirm dialog prevents accidental stops
- Audit log shows who performed actions

### Step 2.4: Bulk Actions with RBAC

**Instructions:**
1. Add bulk action API endpoints:

```typescript
// POST /api/streams/bulk/start
router.post('/bulk/start',
  requireCapability('streams:start'),
  async (req, res) => {
    const { ids } = req.body;
    const results = await Promise.allSettled(
      ids.map(async (id: string) => {
        await startContainer(id);
        logAuditEvent(req.ctx.user, 'stream:start', {
          resourceType: 'stream',
          resourceId: id,
          details: { bulk: true }
        });
        return { id, success: true };
      })
    );
    // Format results...
  }
);
```

2. Execute actions in parallel with concurrency limit (max 3 simultaneous)
3. Return partial success (some succeed, some fail)
4. Create single audit entry for bulk operation with details

5. Update Dashboard component:
   - Add checkbox selection to StreamCards (gated by control capability)
   - Add bulk action toolbar when items selected
   - Show progress during bulk operations

**Validation:**
- Bulk start/stop works with multiple containers
- Partial failures handled gracefully
- UI shows per-container result status
- Single audit entry captures all affected streams

### Step 2.5: Audit Log Viewer

**Instructions:**
1. Create `src/server/routes/audit.ts`:

```typescript
router.get('/',
  requireCapability('audit:read'),
  async (req, res) => {
    const { limit, offset, userId, action, resourceType, since } = req.query;
    const result = queryAuditLog({
      limit: parseInt(limit as string) || 100,
      offset: parseInt(offset as string) || 0,
      userId: userId as string,
      action: action as string,
      resourceType: resourceType as string,
      since: since as string
    });
    res.json(result);
  }
);
```

2. Create `src/client/pages/AuditLog.tsx`:
   - Table with filters (user, action, resource)
   - Pagination
   - Date range picker
   - Export to CSV
   - **Only accessible with audit:read capability**

3. Add audit log link to navigation (gated)

**Validation:**
- Audit log shows all actions with user info
- Filters work correctly
- Pagination works
- Only admins can view (capability gated)

### Step 2.6: Testing Phase 2

**Instructions:**
1. Add integration tests for control flow:
   - Start stopped container → verify running
   - Stop running container → verify stopped
   - Refresh running container → verify page reloaded
2. Add RBAC tests:
   - Viewer cannot start/stop (403)
   - Operator can start/stop (200)
   - Admin can do everything
3. Add E2E test using Playwright or Cypress:
   - Login simulation (set headers)
   - Load dashboard as viewer → no control buttons
   - Load dashboard as operator → control buttons visible
   - Perform stop action → verify audit log
4. Update README with control action documentation

**Deliverables for Phase 2:**
- [ ] Start/Stop/Restart containers via UI (capability gated)
- [ ] Page refresh via FIFO or signal (capability gated)
- [ ] Bulk actions for multiple containers
- [ ] All actions create audit log entries with user info
- [ ] Audit log viewer (admin only)
- [ ] Rate limiting prevents abuse
- [ ] E2E tests with RBAC scenarios
- [ ] All tests passing
- [ ] Updated documentation

---

## Phase 3: CRUD Operations

### Objective
Enable creating, editing, and deleting stream configurations through the GUI. Enforce RBAC on management operations.

### Prerequisites
- Phase 2 complete and all tests passing
- Understanding of page-stream CLI arguments and Docker container creation

### Step 3.1: Stream Configuration Schema

**Instructions:**
1. Create `src/server/config/schema.ts` defining stream configuration:

```typescript
interface StreamConfig {
  // Identity
  id: string;                    // UUID, generated on create
  name: string;                  // Human-readable name (becomes container name)
  type: 'standard' | 'compositor-source' | 'compositor';
  enabled: boolean;              // Whether to auto-start

  // Content
  url: string;                   // Page URL or file path
  injectCss?: string;            // Path to CSS file
  injectJs?: string;             // Path to JS file

  // Display
  width: number;                 // Default: 1920
  height: number;                // Default: 1080
  fps: number;                   // Default: 30
  cropInfobar: number;           // Default: 0

  // Encoding
  preset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium';
  videoBitrate: string;          // e.g., '2500k'
  audioBitrate: string;          // e.g., '128k'
  format: 'mpegts' | 'flv';

  // Output
  ingest: string;                // SRT or RTMP URL

  // Behavior
  autoRefreshSeconds: number;    // 0 = disabled
  reconnectAttempts: number;     // 0 = infinite
  reconnectInitialDelayMs: number;
  reconnectMaxDelayMs: number;
  healthIntervalSeconds: number;

  // Advanced
  extraFfmpegArgs?: string[];
  inputFfmpegFlags?: string;
  display?: string;              // X11 display, auto-assigned if not specified

  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;             // User ID who created
  updatedBy?: string;            // User ID who last updated
}
```

2. Create JSON Schema for validation
3. Create Zod schema for runtime validation
4. Define sensible defaults for all optional fields

**Validation:**
- Schema compiles without errors
- Defaults produce valid configuration
- Validation catches invalid values (negative dimensions, invalid presets, etc.)

### Step 3.2: Configuration Storage

**Instructions:**
1. Create `src/server/config/storage.ts`:
   - Store configurations in SQLite database
   - Table schema matching StreamConfig interface
   - CRUD operations with proper transactions
   - **Track createdBy and updatedBy from request context**

```typescript
async function createStream(
  config: Omit<StreamConfig, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>,
  user: User
): Promise<StreamConfig>

async function updateStream(
  id: string,
  updates: Partial<StreamConfig>,
  user: User
): Promise<StreamConfig>
```

2. Add migration system for schema changes
3. Seed database with configurations matching existing docker-compose services
4. Add import/export functionality (JSON format)

**Validation:**
- CRUD operations work correctly
- createdBy/updatedBy populated from user context
- Concurrent access handled safely
- Import/export round-trips correctly

### Step 3.3: Container Generation

**Instructions:**
1. Create `src/server/docker-generator.ts`:
   - Convert StreamConfig to Docker container configuration

```typescript
function generateContainerConfig(stream: StreamConfig): ContainerCreateOptions
```

2. Map all StreamConfig fields to:
   - CLI arguments (--ingest, --url, --width, etc.)
   - Environment variables (DISPLAY, INPUT_FFMPEG_FLAGS, etc.)
   - Volume mounts (demo pages, output directory, inject files)
   - Labels for identification and metadata storage

3. Handle display assignment:
   - Track used displays in database
   - Auto-assign next available display (:99, :100, etc.)
   - Release display when stream deleted

4. Handle network assignment:
   - Standard streams: default network
   - Compositor sources: compositor_net bridge

**Validation:**
- Generated config produces valid container
- All CLI arguments correctly formatted
- Environment variables properly escaped
- Volume paths validated

### Step 3.4: CRUD API Routes with RBAC

**Instructions:**
1. Add routes to `src/server/routes/streams.ts`:

```typescript
// POST /api/streams - Create new stream
router.post('/',
  requireCapability('streams:create'),
  async (req, res) => {
    const config = validateStreamConfig(req.body);
    const stream = await createStreamConfig(config, req.ctx.user);

    logAuditEvent(req.ctx.user, 'stream:create', {
      resourceType: 'stream',
      resourceId: stream.id,
      details: { name: stream.name, ingest: stream.ingest }
    });

    // Optionally start container
    let containerId: string | undefined;
    if (stream.enabled) {
      containerId = await createAndStartContainer(stream);
    }

    res.status(201).json({ stream, containerId });
  }
);

// PUT /api/streams/:id - Update stream
router.put('/:id',
  requireCapability('streams:update'),
  async (req, res) => {
    const updates = validatePartialStreamConfig(req.body);
    const stream = await updateStreamConfig(req.params.id, updates, req.ctx.user);

    logAuditEvent(req.ctx.user, 'stream:update', {
      resourceType: 'stream',
      resourceId: stream.id,
      details: { changes: Object.keys(updates) }
    });

    res.json({ stream, restarted: false });
  }
);

// DELETE /api/streams/:id
router.delete('/:id',
  requireCapability('streams:delete'),
  async (req, res) => {
    const stream = await getStreamConfig(req.params.id);
    if (!stream) return res.status(404).json({ error: 'Not found' });

    // Stop container if running
    const container = await getContainer(stream.name);
    if (container?.status === 'running') {
      await stopContainer(container.id);
    }

    await deleteStreamConfig(req.params.id);

    logAuditEvent(req.ctx.user, 'stream:delete', {
      resourceType: 'stream',
      resourceId: req.params.id,
      details: { name: stream.name }
    });

    res.json({ success: true });
  }
);
```

2. Add validation middleware using Zod schemas
3. Handle conflicts (duplicate names, display collisions)
4. Broadcast changes via WebSocket

**Validation:**
- Create stream produces running container (capability gated)
- Update stream modifies container (capability gated)
- Delete stream removes container and database entry (capability gated)
- Audit log tracks who created/modified/deleted
- Import/export work correctly

### Step 3.5: Frontend - Stream Form with Capability Gates

**Instructions:**
1. Create `src/client/components/StreamForm.tsx`:
   - Tabbed form: Basic, Encoding, Behavior, Advanced
   - **Disable form submission if user lacks streams:create/streams:update**
   - Show read-only mode for users without edit capability

2. Create `src/client/pages/CreateStream.tsx`:
   - **Wrap entire page in CapabilityGate require="streams:create"**
   - StreamForm with empty defaults
   - "Create" and "Create & Start" buttons
   - Success redirects to stream detail

3. Create `src/client/pages/EditStream.tsx`:
   - **Wrap edit controls in CapabilityGate require="streams:update"**
   - **Wrap delete button in CapabilityGate require="streams:delete"**
   - StreamForm pre-populated with existing config
   - Show "created by" and "last updated by" metadata

4. Update navigation:
   - "New Stream" button gated by streams:create
   - Edit button gated by streams:update

**Validation:**
- Create form only accessible with streams:create
- Edit form shows read-only without streams:update
- Delete button only visible with streams:delete
- Audit log shows who performed each action

### Step 3.6: Templates System

**Instructions:**
1. Create template configuration with ownership:

```typescript
interface StreamTemplate {
  id: string;
  name: string;
  description: string;
  category: 'standard' | 'compositor' | 'custom';
  config: Partial<StreamConfig>;
  builtIn: boolean;
  createdBy?: string;  // User who created (for custom templates)
}
```

2. Create built-in templates (builtIn: true, no createdBy)
3. Allow users with templates:create to create custom templates

**Validation:**
- Built-in templates available to all
- Custom templates tracked with creator
- Only template creator or admin can delete custom templates

### Step 3.7: Testing Phase 3

**Instructions:**
1. Add RBAC integration tests:
   - Viewer cannot create/update/delete (403)
   - Editor can create/update/delete (200)
   - Audit log shows correct user for each action
2. Add E2E tests:
   - Create stream as editor → success
   - Try create as viewer → rejected
   - Verify audit trail
3. Test ownership tracking in audit and metadata

**Deliverables for Phase 3:**
- [ ] Create new streams via GUI form (capability gated)
- [ ] Edit existing stream configurations (capability gated)
- [ ] Delete streams with cleanup (capability gated)
- [ ] createdBy/updatedBy tracked on all resources
- [ ] Duplicate streams for quick creation
- [ ] Template system with presets
- [ ] Import/export configurations
- [ ] Display number management
- [ ] All RBAC scenarios tested
- [ ] Updated documentation

---

## Phase 4: Advanced Features

### Objective
Add compositor orchestration, multi-stream coordination, scheduling, alerts, and production-ready features including user management UI.

### Prerequisites
- Phase 3 complete and all tests passing
- Understanding of compositor architecture from COMPOSITOR-ARCHITECTURE.md

### Step 4.1: Compositor Management

**Instructions:**
1. Create `src/server/compositor.ts` with ownership tracking
2. Use capabilities: `compositors:*`
3. Track createdBy/updatedBy for compositors
4. Audit all compositor operations

**Validation:**
- Compositor CRUD respects capabilities
- Audit log tracks compositor operations

### Step 4.2: Stream Groups and Dependencies

**Instructions:**
1. Create grouping system with ownership:

```typescript
interface StreamGroup {
  id: string;
  name: string;
  description?: string;
  streamIds: string[];
  startOrder: 'parallel' | 'sequential';
  stopOrder: 'parallel' | 'sequential' | 'reverse';
  createdBy: string;
  updatedBy?: string;
}
```

2. Use capabilities: `groups:*`
3. `groups:control` required for start/stop operations

### Step 4.3: Scheduling System

**Instructions:**
1. Create scheduler with ownership:

```typescript
interface Schedule {
  id: string;
  name: string;
  targetType: 'stream' | 'group' | 'compositor';
  targetId: string;
  action: 'start' | 'stop' | 'refresh';
  cron: string;
  timezone: string;
  enabled: boolean;
  createdBy: string;
  lastRun?: string;
  nextRun?: string;
}
```

2. Use capabilities: `schedules:*`
3. Scheduled actions execute as system user but log original schedule creator

### Step 4.4: Monitoring and Alerts

**Instructions:**
1. Create alerting system:
   - Use capabilities: `alerts:*`
   - Track who created each alert rule
2. Alert notifications include context about triggered condition

### Step 4.5: User Management UI

**Instructions:**
1. Create `src/client/pages/UserManagement.tsx`:
   - **Gate entire page with users:list capability**
   - List all seen users with their roles
   - Show last seen timestamp
   - Role assignment interface (gate with users:manage)

2. Create `src/client/components/RoleEditor.tsx`:
   - Multi-select for role assignment
   - Show capability preview for selected roles
   - **Gate editing with users:manage capability**

3. Create `src/client/pages/RoleManagement.tsx`:
   - List all roles (built-in and custom)
   - View capabilities for each role
   - Create custom roles (gate with users:manage)
   - Cannot delete built-in roles

4. Add admin navigation section:
   - Users link (gate with users:list)
   - Roles link (gate with users:list)
   - Audit Log link (gate with audit:read)
   - System Config link (gate with system:config)

**Validation:**
- Only admins see user management
- Role changes take effect on next request
- Audit log tracks role assignments

### Step 4.6: Metrics Export

**Instructions:**
1. Add Prometheus metrics endpoint (no auth - for scrapers):
   - But add option to require API key: `METRICS_API_KEY`
2. Include user activity metrics:
   - `stream_manager_active_users` (users with activity in last hour)
   - `stream_manager_api_requests_by_user{user="..."}` (optional, can be noisy)

### Step 4.7: Production Hardening

**Instructions:**
1. Security hardening:
   - Validate trusted proxy IPs before accepting auth headers
   - Log security events (failed auth, permission denied)
   - Rate limit by user ID when auth enabled
2. Add security audit endpoint (admin only):
   - Recent failed requests
   - Users with elevated privileges
   - Unusual activity patterns

### Step 4.8: Auth Proxy Integration Examples

**Instructions:**
1. Create `docs/auth-oauth2-proxy.md`:
   - docker-compose example with oauth2-proxy
   - Header mapping configuration
   - Group-to-role mapping examples

2. Create `docs/auth-azure-easyauth.md`:
   - Azure App Service configuration
   - Azure Front Door setup
   - Group claim extraction

3. Create `docs/auth-nginx.md`:
   - nginx auth_request configuration
   - Header forwarding setup

**Deliverables for Phase 4:**
- [ ] Compositor orchestration with coordinated lifecycle
- [ ] Stream groups with ordered startup/shutdown
- [ ] Scheduling system with cron support
- [ ] Alert rules and notifications
- [ ] User management UI (admin only)
- [ ] Role management UI (admin only)
- [ ] Custom role creation
- [ ] Prometheus metrics export
- [ ] Grafana dashboard template
- [ ] Production hardening complete
- [ ] Auth proxy integration documentation
- [ ] Comprehensive documentation
- [ ] All tests passing including RBAC scenarios

---

## Appendix A: Environment Variables

```bash
# Server
PORT=3001
LOG_LEVEL=info

# Docker
DOCKER_SOCKET=/var/run/docker.sock

# Database
DATABASE_PATH=/data/stream-manager.db

# CORS
CORS_ORIGIN=http://localhost:3000

# Authentication
AUTH_MODE=none                    # 'none' (open) or 'proxy' (trust headers)

# Header names (when AUTH_MODE=proxy)
AUTH_HEADER_USER=x-forwarded-user
AUTH_HEADER_EMAIL=x-forwarded-email
AUTH_HEADER_GROUPS=x-forwarded-groups
AUTH_HEADER_NAME=x-forwarded-preferred-username

# Role mapping (when AUTH_MODE=proxy)
AUTH_GROUP_ROLES={"admins":["admin"],"stream-operators":["operator"],"stream-editors":["editor"]}
AUTH_DEFAULT_ROLE=viewer          # Role for authenticated users not in mapped groups
AUTH_ANONYMOUS_ROLE=              # Empty = deny anonymous, 'viewer' = allow read-only

# Trusted proxies (CIDR notation, comma-separated)
AUTH_TRUSTED_PROXIES=127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16

# Metrics
METRICS_ENABLED=true
METRICS_API_KEY=                  # Optional: require API key for /metrics

# Alerting (Phase 4)
WEBHOOK_URL=https://...
SMTP_HOST=...
SMTP_PORT=587
```

---

## Appendix B: API Reference Summary

### Authentication
```
GET    /api/auth/me               Get current user and capabilities
GET    /api/auth/capabilities     Get capability flags for UI
GET    /api/auth/users            List all users (users:list)
PUT    /api/auth/users/:id/roles  Update user roles (users:manage)
GET    /api/auth/roles            List all roles (users:list)
POST   /api/auth/roles            Create custom role (users:manage)
DELETE /api/auth/roles/:id        Delete custom role (users:manage)
```

### Streams
```
GET    /api/streams              List all streams (streams:list)
POST   /api/streams              Create stream (streams:create)
GET    /api/streams/:id          Get stream details (streams:read)
PUT    /api/streams/:id          Update stream (streams:update)
DELETE /api/streams/:id          Delete stream (streams:delete)
POST   /api/streams/:id/start    Start stream (streams:start)
POST   /api/streams/:id/stop     Stop stream (streams:stop)
POST   /api/streams/:id/restart  Restart stream (streams:restart)
POST   /api/streams/:id/refresh  Refresh page (streams:refresh)
GET    /api/streams/:id/logs     Get logs (streams:logs)
```

### Audit
```
GET    /api/audit                Query audit log (audit:read)
```

### System
```
GET    /api/health               Health check (no auth)
GET    /metrics                  Prometheus metrics (optional API key)
```

---

## Appendix C: Docker Compose with Auth Proxy

### Example: oauth2-proxy

```yaml
services:
  oauth2-proxy:
    image: quay.io/oauth2-proxy/oauth2-proxy:v7.5.1
    ports:
      - "4180:4180"
    environment:
      - OAUTH2_PROXY_PROVIDER=oidc
      - OAUTH2_PROXY_OIDC_ISSUER_URL=https://your-idp.example.com
      - OAUTH2_PROXY_CLIENT_ID=stream-manager
      - OAUTH2_PROXY_CLIENT_SECRET=${OAUTH_CLIENT_SECRET}
      - OAUTH2_PROXY_COOKIE_SECRET=${COOKIE_SECRET}
      - OAUTH2_PROXY_UPSTREAMS=http://stream-manager:3001
      - OAUTH2_PROXY_HTTP_ADDRESS=0.0.0.0:4180
      - OAUTH2_PROXY_EMAIL_DOMAINS=*
      - OAUTH2_PROXY_PASS_USER_HEADERS=true
      - OAUTH2_PROXY_SET_XAUTHREQUEST=true
    depends_on:
      - stream-manager

  stream-manager:
    build: ./stream-manager
    environment:
      - AUTH_MODE=proxy
      - AUTH_HEADER_USER=x-forwarded-user
      - AUTH_HEADER_EMAIL=x-forwarded-email
      - AUTH_HEADER_GROUPS=x-forwarded-groups
      - AUTH_GROUP_ROLES={"admins":["admin"],"operators":["operator"]}
      - AUTH_DEFAULT_ROLE=viewer
    # No port exposure - only accessible via oauth2-proxy
```

---

## Success Criteria

### Phase 1 Complete When:
- RBAC infrastructure fully implemented
- Auth middleware supports proxy headers
- Dashboard shows all page-stream containers
- User identity displayed in UI
- Capability-based UI gating works
- All unit/integration tests pass

### Phase 2 Complete When:
- Control actions enforce capabilities
- Audit log tracks user actions
- Viewers cannot control, operators can
- E2E RBAC tests pass

### Phase 3 Complete When:
- CRUD operations enforce capabilities
- createdBy/updatedBy tracked
- Editors can manage, viewers cannot
- Audit trail complete

### Phase 4 Complete When:
- User management UI functional
- Role assignment works
- Custom roles supported
- Auth proxy documentation complete
- Production deployment documented

**When all phase deliverables are marked complete:**

  1. Run final verification of all phases.
  2. If verification passes for all phases, just add one idea to a list of FUTURE_PLANS.md and exit.
