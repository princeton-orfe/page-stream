import { Capability, Role, User, RequestContext } from './types.js';

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

    if ((role.capabilities as string[]).includes('*')) {
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
