import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_ROLES,
  ALL_CAPABILITIES,
  resolveCapabilities,
  createRequestContext
} from '../../../src/server/auth/rbac.js';
import { User, Capability } from '../../../src/server/auth/types.js';

describe('RBAC', () => {
  describe('BUILT_IN_ROLES', () => {
    it('should define viewer, operator, editor, and admin roles', () => {
      const roleIds = BUILT_IN_ROLES.map(r => r.id);
      expect(roleIds).toContain('viewer');
      expect(roleIds).toContain('operator');
      expect(roleIds).toContain('editor');
      expect(roleIds).toContain('admin');
    });

    it('should mark all built-in roles as builtIn', () => {
      BUILT_IN_ROLES.forEach(role => {
        expect(role.builtIn).toBe(true);
      });
    });

    it('should have admin role with wildcard capability', () => {
      const admin = BUILT_IN_ROLES.find(r => r.id === 'admin');
      expect(admin?.capabilities).toContain('*');
    });
  });

  describe('resolveCapabilities', () => {
    it('should return empty set for unknown role', () => {
      const caps = resolveCapabilities(['unknown-role'], BUILT_IN_ROLES);
      expect(caps.size).toBe(0);
    });

    it('should return viewer capabilities for viewer role', () => {
      const caps = resolveCapabilities(['viewer'], BUILT_IN_ROLES);

      expect(caps.has('streams:list')).toBe(true);
      expect(caps.has('streams:read')).toBe(true);
      expect(caps.has('streams:logs')).toBe(true);
      expect(caps.has('streams:start')).toBe(false);
      expect(caps.has('streams:create')).toBe(false);
    });

    it('should return operator capabilities including control actions', () => {
      const caps = resolveCapabilities(['operator'], BUILT_IN_ROLES);

      expect(caps.has('streams:list')).toBe(true);
      expect(caps.has('streams:start')).toBe(true);
      expect(caps.has('streams:stop')).toBe(true);
      expect(caps.has('streams:refresh')).toBe(true);
      expect(caps.has('streams:create')).toBe(false);
    });

    it('should return all capabilities for admin role (wildcard expansion)', () => {
      const caps = resolveCapabilities(['admin'], BUILT_IN_ROLES);

      ALL_CAPABILITIES.forEach(cap => {
        expect(caps.has(cap)).toBe(true);
      });
      expect(caps.size).toBe(ALL_CAPABILITIES.length);
    });

    it('should combine capabilities from multiple roles', () => {
      const caps = resolveCapabilities(['viewer', 'operator'], BUILT_IN_ROLES);

      // Should have both viewer and operator capabilities
      expect(caps.has('streams:list')).toBe(true);
      expect(caps.has('streams:start')).toBe(true);
      expect(caps.has('streams:stop')).toBe(true);
    });

    it('should handle empty roles array', () => {
      const caps = resolveCapabilities([], BUILT_IN_ROLES);
      expect(caps.size).toBe(0);
    });

    it('should deduplicate capabilities when multiple roles share them', () => {
      const caps = resolveCapabilities(['viewer', 'operator'], BUILT_IN_ROLES);

      // streams:list is in both roles, but should only appear once
      const capArray = Array.from(caps);
      const streamsListCount = capArray.filter(c => c === 'streams:list').length;
      expect(streamsListCount).toBe(1);
    });
  });

  describe('createRequestContext', () => {
    const createTestUser = (roles: string[]): User => ({
      id: 'test-user',
      username: 'Test User',
      roles,
      authSource: 'anonymous'
    });

    it('should create context with resolved capabilities', () => {
      const user = createTestUser(['viewer']);
      const ctx = createRequestContext(user, BUILT_IN_ROLES);

      expect(ctx.user).toBe(user);
      expect(ctx.capabilities.size).toBeGreaterThan(0);
    });

    it('should provide hasCapability function that checks single capability', () => {
      const user = createTestUser(['viewer']);
      const ctx = createRequestContext(user, BUILT_IN_ROLES);

      expect(ctx.hasCapability('streams:list')).toBe(true);
      expect(ctx.hasCapability('streams:start')).toBe(false);
    });

    it('should provide hasAnyCapability function that checks any of multiple', () => {
      const user = createTestUser(['viewer']);
      const ctx = createRequestContext(user, BUILT_IN_ROLES);

      // Viewer has streams:list but not streams:start
      expect(ctx.hasAnyCapability('streams:list', 'streams:start')).toBe(true);
      expect(ctx.hasAnyCapability('streams:start', 'streams:create')).toBe(false);
    });

    it('should provide hasAllCapabilities function that checks all', () => {
      const user = createTestUser(['viewer']);
      const ctx = createRequestContext(user, BUILT_IN_ROLES);

      expect(ctx.hasAllCapabilities('streams:list', 'streams:read')).toBe(true);
      expect(ctx.hasAllCapabilities('streams:list', 'streams:start')).toBe(false);
    });

    it('should grant all capabilities for admin role', () => {
      const user = createTestUser(['admin']);
      const ctx = createRequestContext(user, BUILT_IN_ROLES);

      expect(ctx.hasCapability('users:manage')).toBe(true);
      expect(ctx.hasCapability('system:config')).toBe(true);
      expect(ctx.hasAllCapabilities('users:manage', 'system:config', 'streams:create')).toBe(true);
    });
  });
});
