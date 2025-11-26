import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initDatabase, closeDatabase, getDatabase } from '../../../src/server/db/index.js';
import {
  logSecurityEvent,
  querySecurityEvents,
  getSecuritySummary,
  getFailedAuthAttemptsForIp,
  getElevatedPrivilegeUsers,
} from '../../../src/server/security/index.js';

describe('Security Events', () => {
  beforeAll(() => {
    initDatabase(':memory:');
  });

  afterAll(() => {
    closeDatabase();
  });

  beforeEach(() => {
    // Clear security events table before each test
    const db = getDatabase();
    db.exec('DELETE FROM security_events');
  });

  describe('logSecurityEvent', () => {
    it('should log a security event with all fields', () => {
      logSecurityEvent('auth:success', {
        userId: 'user123',
        username: 'testuser',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        requestPath: '/api/streams',
        requestMethod: 'GET',
        details: { roles: ['admin'] },
        severity: 'info',
      });

      const result = querySecurityEvents({ limit: 1 });
      expect(result.events).toHaveLength(1);

      const event = result.events[0];
      expect(event.eventType).toBe('auth:success');
      expect(event.userId).toBe('user123');
      expect(event.username).toBe('testuser');
      expect(event.ipAddress).toBe('192.168.1.1');
      expect(event.userAgent).toBe('Mozilla/5.0');
      expect(event.requestPath).toBe('/api/streams');
      expect(event.requestMethod).toBe('GET');
      expect(event.details).toEqual({ roles: ['admin'] });
      expect(event.severity).toBe('info');
    });

    it('should use default severity based on event type', () => {
      logSecurityEvent('auth:failure', {
        ipAddress: '192.168.1.1',
        requestPath: '/api/auth',
        requestMethod: 'POST',
      });

      const result = querySecurityEvents({ limit: 1 });
      expect(result.events[0].severity).toBe('warning');
    });

    it('should use critical severity for proxy violations', () => {
      logSecurityEvent('trusted_proxy:violation', {
        ipAddress: '203.0.113.50',
        requestPath: '/api/streams',
        requestMethod: 'GET',
      });

      const result = querySecurityEvents({ limit: 1 });
      expect(result.events[0].severity).toBe('critical');
    });

    it('should allow null userId and username', () => {
      logSecurityEvent('auth:anonymous', {
        ipAddress: '192.168.1.1',
        requestPath: '/api/health',
        requestMethod: 'GET',
      });

      const result = querySecurityEvents({ limit: 1 });
      expect(result.events[0].userId).toBeUndefined();
      expect(result.events[0].username).toBeUndefined();
    });
  });

  describe('querySecurityEvents', () => {
    beforeEach(() => {
      // Add test events
      logSecurityEvent('auth:success', {
        userId: 'user1',
        username: 'User One',
        ipAddress: '192.168.1.1',
        requestPath: '/api/streams',
        requestMethod: 'GET',
      });
      logSecurityEvent('auth:failure', {
        ipAddress: '192.168.1.2',
        requestPath: '/api/auth',
        requestMethod: 'POST',
      });
      logSecurityEvent('permission:denied', {
        userId: 'user1',
        username: 'User One',
        ipAddress: '192.168.1.1',
        requestPath: '/api/admin',
        requestMethod: 'GET',
      });
    });

    it('should return all events', () => {
      const result = querySecurityEvents({});
      expect(result.events).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('should filter by event type', () => {
      const result = querySecurityEvents({ eventType: 'auth:failure' });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].eventType).toBe('auth:failure');
    });

    it('should filter by user ID', () => {
      const result = querySecurityEvents({ userId: 'user1' });
      expect(result.events).toHaveLength(2);
      expect(result.events.every(e => e.userId === 'user1')).toBe(true);
    });

    it('should filter by IP address', () => {
      const result = querySecurityEvents({ ipAddress: '192.168.1.2' });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].ipAddress).toBe('192.168.1.2');
    });

    it('should filter by severity', () => {
      const result = querySecurityEvents({ severity: 'warning' });
      expect(result.events).toHaveLength(2);
      expect(result.events.every(e => e.severity === 'warning')).toBe(true);
    });

    it('should support pagination', () => {
      const page1 = querySecurityEvents({ limit: 2, offset: 0 });
      expect(page1.events).toHaveLength(2);
      expect(page1.total).toBe(3);

      const page2 = querySecurityEvents({ limit: 2, offset: 2 });
      expect(page2.events).toHaveLength(1);
    });
  });

  describe('getSecuritySummary', () => {
    beforeEach(() => {
      logSecurityEvent('auth:success', {
        userId: 'user1',
        username: 'User One',
        ipAddress: '192.168.1.1',
        requestPath: '/api/streams',
        requestMethod: 'GET',
      });
      logSecurityEvent('auth:success', {
        userId: 'user2',
        username: 'User Two',
        ipAddress: '192.168.1.2',
        requestPath: '/api/streams',
        requestMethod: 'GET',
      });
      logSecurityEvent('auth:failure', {
        ipAddress: '192.168.1.100',
        requestPath: '/api/auth',
        requestMethod: 'POST',
      });
      logSecurityEvent('permission:denied', {
        userId: 'user1',
        username: 'User One',
        ipAddress: '192.168.1.1',
        requestPath: '/api/admin',
        requestMethod: 'GET',
      });
    });

    it('should return event counts by type', () => {
      const summary = getSecuritySummary();

      expect(summary.byType['auth:success']).toBe(2);
      expect(summary.byType['auth:failure']).toBe(1);
      expect(summary.byType['permission:denied']).toBe(1);
    });

    it('should return event counts by severity', () => {
      const summary = getSecuritySummary();

      expect(summary.bySeverity['info']).toBe(2);
      expect(summary.bySeverity['warning']).toBe(2);
    });

    it('should return total event count', () => {
      const summary = getSecuritySummary();
      expect(summary.totalEvents).toBe(4);
    });

    it('should return top offending IPs', () => {
      // Add more failures from one IP
      logSecurityEvent('auth:failure', {
        ipAddress: '192.168.1.100',
        requestPath: '/api/auth',
        requestMethod: 'POST',
      });
      logSecurityEvent('auth:failure', {
        ipAddress: '192.168.1.100',
        requestPath: '/api/auth',
        requestMethod: 'POST',
      });

      const summary = getSecuritySummary();

      expect(summary.topOffendingIps).toHaveLength(2);
      expect(summary.topOffendingIps[0].ip).toBe('192.168.1.100');
      expect(summary.topOffendingIps[0].count).toBe(3);
    });
  });

  describe('getFailedAuthAttemptsForIp', () => {
    it('should count failed auth attempts for an IP', () => {
      logSecurityEvent('auth:failure', {
        ipAddress: '192.168.1.100',
        requestPath: '/api/auth',
        requestMethod: 'POST',
      });
      logSecurityEvent('auth:failure', {
        ipAddress: '192.168.1.100',
        requestPath: '/api/auth',
        requestMethod: 'POST',
      });
      logSecurityEvent('auth:success', {
        userId: 'user1',
        username: 'User One',
        ipAddress: '192.168.1.100',
        requestPath: '/api/auth',
        requestMethod: 'POST',
      });

      // Use a very large window to ensure timestamps are included
      const count = getFailedAuthAttemptsForIp('192.168.1.100', 60); // 60 minutes
      expect(count).toBe(2);
    });

    it('should return 0 for IP with no failures', () => {
      const count = getFailedAuthAttemptsForIp('192.168.1.200', 60);
      expect(count).toBe(0);
    });
  });

  describe('getElevatedPrivilegeUsers', () => {
    beforeEach(() => {
      // Set up test users with roles
      const db = getDatabase();

      // Insert test users
      db.prepare(`
        INSERT OR REPLACE INTO users (id, username, email, first_seen, last_seen)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `).run('admin1', 'Admin User', 'admin@example.com');

      db.prepare(`
        INSERT OR REPLACE INTO users (id, username, email, first_seen, last_seen)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `).run('editor1', 'Editor User', 'editor@example.com');

      db.prepare(`
        INSERT OR REPLACE INTO users (id, username, email, first_seen, last_seen)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `).run('viewer1', 'Viewer User', 'viewer@example.com');

      // Assign roles
      db.prepare(`
        INSERT OR REPLACE INTO user_roles (user_id, role_id, assigned_by)
        VALUES (?, ?, ?)
      `).run('admin1', 'admin', 'system');

      db.prepare(`
        INSERT OR REPLACE INTO user_roles (user_id, role_id, assigned_by)
        VALUES (?, ?, ?)
      `).run('editor1', 'editor', 'system');

      // viewer1 has no elevated role - not in user_roles
    });

    it('should return users with elevated privileges', () => {
      const users = getElevatedPrivilegeUsers();

      expect(users).toHaveLength(2);

      const adminUser = users.find(u => u.userId === 'admin1');
      expect(adminUser).toBeDefined();
      expect(adminUser?.roles).toContain('admin');

      const editorUser = users.find(u => u.userId === 'editor1');
      expect(editorUser).toBeDefined();
      expect(editorUser?.roles).toContain('editor');

      // Viewer should not be included
      const viewerUser = users.find(u => u.userId === 'viewer1');
      expect(viewerUser).toBeUndefined();
    });
  });
});
