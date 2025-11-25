import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { initDatabase, getDatabase, closeDatabase } from '../../../src/server/db/index.js';
import {
  createRoleStore,
  recordUserSeen,
  assignUserRole,
  removeUserRole,
  listUsers
} from '../../../src/server/db/users.js';
import { logAuditEvent, queryAuditLog } from '../../../src/server/db/audit.js';
import { DEFAULT_AUTH_CONFIG } from '../../../src/server/auth/extractors.js';

const TEST_DB_DIR = join(process.cwd(), 'tests', '.tmp');
const TEST_DB_PATH = join(TEST_DB_DIR, 'test.db');

describe('Database', () => {
  beforeEach(() => {
    // Ensure test directory exists
    if (!existsSync(TEST_DB_DIR)) {
      mkdirSync(TEST_DB_DIR, { recursive: true });
    }
    // Clean up any existing test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    if (existsSync(TEST_DB_PATH + '-wal')) {
      unlinkSync(TEST_DB_PATH + '-wal');
    }
    if (existsSync(TEST_DB_PATH + '-shm')) {
      unlinkSync(TEST_DB_PATH + '-shm');
    }
  });

  afterEach(() => {
    closeDatabase();
    // Clean up test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    if (existsSync(TEST_DB_PATH + '-wal')) {
      unlinkSync(TEST_DB_PATH + '-wal');
    }
    if (existsSync(TEST_DB_PATH + '-shm')) {
      unlinkSync(TEST_DB_PATH + '-shm');
    }
  });

  describe('initDatabase', () => {
    it('should create database file', () => {
      initDatabase(TEST_DB_PATH);
      expect(existsSync(TEST_DB_PATH)).toBe(true);
    });

    it('should run migrations and create tables', () => {
      initDatabase(TEST_DB_PATH);
      const db = getDatabase();

      // Check tables exist
      const tables = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
      `).all() as { name: string }[];

      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('roles');
      expect(tableNames).toContain('user_roles');
      expect(tableNames).toContain('users');
      expect(tableNames).toContain('audit_log');
      expect(tableNames).toContain('migrations');
    });

    it('should insert built-in roles', () => {
      initDatabase(TEST_DB_PATH);
      const db = getDatabase();

      const roles = db.prepare('SELECT id FROM roles WHERE built_in = 1').all() as { id: string }[];
      const roleIds = roles.map(r => r.id);

      expect(roleIds).toContain('viewer');
      expect(roleIds).toContain('operator');
      expect(roleIds).toContain('editor');
      expect(roleIds).toContain('admin');
    });

    it('should be idempotent (run migrations only once)', () => {
      initDatabase(TEST_DB_PATH);
      closeDatabase();

      // Reinitialize should not throw
      initDatabase(TEST_DB_PATH);
      const db = getDatabase();

      // Should still have exactly 4 built-in roles
      const roles = db.prepare('SELECT COUNT(*) as count FROM roles WHERE built_in = 1').get() as { count: number };
      expect(roles.count).toBe(4);
    });
  });

  describe('RoleStore', () => {
    beforeEach(() => {
      initDatabase(TEST_DB_PATH);
    });

    it('should return all roles via getRoles', async () => {
      const store = createRoleStore();
      const roles = await store.getRoles();

      expect(roles.length).toBeGreaterThanOrEqual(4);
      expect(roles.find(r => r.id === 'admin')).toBeDefined();
      expect(roles.find(r => r.id === 'admin')?.capabilities).toContain('*');
    });

    it('should return empty array for user with no roles', async () => {
      const store = createRoleStore();
      const roles = await store.getUserRoles('unknown-user');
      expect(roles).toEqual([]);
    });

    it('should return user roles after assignment', async () => {
      const store = createRoleStore();

      assignUserRole('jdoe', 'viewer', 'system');
      assignUserRole('jdoe', 'operator', 'system');

      const roles = await store.getUserRoles('jdoe');
      expect(roles).toContain('viewer');
      expect(roles).toContain('operator');
    });

    it('should map groups to roles via config', () => {
      const store = createRoleStore();
      const config = {
        ...DEFAULT_AUTH_CONFIG,
        roleMapping: {
          ...DEFAULT_AUTH_CONFIG.roleMapping,
          groupRoles: {
            'admins': ['admin'],
            'operators': ['operator'],
            'devs': ['editor', 'operator']
          }
        }
      };

      const roles = store.mapGroupsToRoles(['admins', 'devs'], config);

      expect(roles).toContain('admin');
      expect(roles).toContain('editor');
      expect(roles).toContain('operator');
      // Should deduplicate
      expect(roles.filter(r => r === 'operator').length).toBe(1);
    });

    it('should return empty array for unmapped groups', () => {
      const store = createRoleStore();
      const roles = store.mapGroupsToRoles(['unknown-group'], DEFAULT_AUTH_CONFIG);
      expect(roles).toEqual([]);
    });
  });

  describe('User Management', () => {
    beforeEach(() => {
      initDatabase(TEST_DB_PATH);
    });

    it('should record user on first visit', () => {
      recordUserSeen('jdoe', 'John Doe', 'jdoe@example.com');

      const users = listUsers();
      expect(users.length).toBe(1);
      expect(users[0].id).toBe('jdoe');
      expect(users[0].username).toBe('John Doe');
      expect(users[0].email).toBe('jdoe@example.com');
    });

    it('should update username on subsequent visits', () => {
      recordUserSeen('jdoe', 'John Doe', 'jdoe@example.com');
      recordUserSeen('jdoe', 'John D.', 'jdoe@example.com');

      const users = listUsers();
      expect(users.length).toBe(1);
      expect(users[0].username).toBe('John D.');
    });

    it('should preserve email if not provided on update', () => {
      recordUserSeen('jdoe', 'John Doe', 'jdoe@example.com');
      recordUserSeen('jdoe', 'John D.');  // No email

      const users = listUsers();
      expect(users[0].email).toBe('jdoe@example.com');
    });

    it('should assign and remove roles', () => {
      recordUserSeen('jdoe', 'John Doe');

      assignUserRole('jdoe', 'viewer', 'admin');
      assignUserRole('jdoe', 'operator', 'admin');

      let users = listUsers();
      expect(users[0].roles).toContain('viewer');
      expect(users[0].roles).toContain('operator');

      removeUserRole('jdoe', 'operator');

      users = listUsers();
      expect(users[0].roles).toContain('viewer');
      expect(users[0].roles).not.toContain('operator');
    });

    it('should list users ordered by last seen', () => {
      recordUserSeen('user1', 'User 1');
      recordUserSeen('user2', 'User 2');
      recordUserSeen('user1', 'User 1');  // Update last seen

      const users = listUsers();
      expect(users[0].id).toBe('user1');  // Most recent
      expect(users[1].id).toBe('user2');
    });
  });

  describe('Audit Logging', () => {
    beforeEach(() => {
      initDatabase(TEST_DB_PATH);
    });

    const testUser = {
      id: 'jdoe',
      username: 'John Doe',
      roles: ['admin'],
      authSource: 'header' as const
    };

    it('should log audit events', () => {
      logAuditEvent(testUser, 'streams:start', {
        resourceType: 'stream',
        resourceId: 'stream-1'
      });

      const { entries, total } = queryAuditLog({});
      expect(total).toBe(1);
      expect(entries[0].action).toBe('streams:start');
      expect(entries[0].userId).toBe('jdoe');
      expect(entries[0].resourceType).toBe('stream');
      expect(entries[0].resourceId).toBe('stream-1');
      expect(entries[0].result).toBe('success');
    });

    it('should log failure events with error', () => {
      logAuditEvent(testUser, 'streams:start', {
        resourceType: 'stream',
        resourceId: 'stream-1',
        result: 'failure',
        error: 'Container not found'
      });

      const { entries } = queryAuditLog({});
      expect(entries[0].result).toBe('failure');
      expect(entries[0].error).toBe('Container not found');
    });

    it('should log details as JSON', () => {
      logAuditEvent(testUser, 'users:update_roles', {
        resourceType: 'user',
        resourceId: 'other-user',
        details: { added: ['admin'], removed: ['viewer'] }
      });

      const { entries } = queryAuditLog({});
      expect(entries[0].details).toEqual({ added: ['admin'], removed: ['viewer'] });
    });

    it('should filter by userId', () => {
      logAuditEvent(testUser, 'action1', {});
      logAuditEvent({ ...testUser, id: 'other' }, 'action2', {});

      const { entries, total } = queryAuditLog({ userId: 'jdoe' });
      expect(total).toBe(1);
      expect(entries[0].action).toBe('action1');
    });

    it('should filter by action', () => {
      logAuditEvent(testUser, 'streams:start', {});
      logAuditEvent(testUser, 'streams:stop', {});

      const { entries, total } = queryAuditLog({ action: 'streams:start' });
      expect(total).toBe(1);
      expect(entries[0].action).toBe('streams:start');
    });

    it('should filter by resourceType', () => {
      logAuditEvent(testUser, 'action1', { resourceType: 'stream' });
      logAuditEvent(testUser, 'action2', { resourceType: 'user' });

      const { entries, total } = queryAuditLog({ resourceType: 'stream' });
      expect(total).toBe(1);
      expect(entries[0].action).toBe('action1');
    });

    it('should paginate results', () => {
      for (let i = 0; i < 5; i++) {
        logAuditEvent(testUser, `action${i}`, {});
      }

      const page1 = queryAuditLog({ limit: 2, offset: 0 });
      expect(page1.total).toBe(5);
      expect(page1.entries.length).toBe(2);

      const page2 = queryAuditLog({ limit: 2, offset: 2 });
      expect(page2.entries.length).toBe(2);

      const page3 = queryAuditLog({ limit: 2, offset: 4 });
      expect(page3.entries.length).toBe(1);
    });
  });
});
