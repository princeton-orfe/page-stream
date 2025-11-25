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
