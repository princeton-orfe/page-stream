import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Application, Request } from 'express';
import request from 'supertest';
import authRouter from '../../../src/server/routes/auth.js';
import type { RequestContext, Capability, User } from '../../../src/server/auth/types.js';

// Mock the db/users module
vi.mock('../../../src/server/db/users.js', () => ({
  listUsers: vi.fn(),
  assignUserRole: vi.fn(),
  removeUserRole: vi.fn(),
  getRoles: vi.fn()
}));

// Mock the db/audit module
vi.mock('../../../src/server/db/audit.js', () => ({
  logAuditEvent: vi.fn()
}));

import * as usersDb from '../../../src/server/db/users.js';
import * as auditDb from '../../../src/server/db/audit.js';

// Helper to create mock request context
function createMockContext(capabilities: Capability[], userOverrides: Partial<User> = {}): RequestContext {
  const capSet = new Set(capabilities);
  const user: User = {
    id: 'test-user',
    username: 'Test User',
    email: 'test@example.com',
    roles: ['viewer'],
    authSource: 'header',
    ...userOverrides
  };
  return {
    user,
    capabilities: capSet,
    hasCapability: (cap) => capSet.has(cap),
    hasAnyCapability: (...caps) => caps.some(c => capSet.has(c)),
    hasAllCapabilities: (...caps) => caps.every(c => capSet.has(c))
  };
}

// Middleware to inject test context
function injectContext(ctx: RequestContext) {
  return (req: Request, _res: express.Response, next: express.NextFunction) => {
    req.ctx = ctx;
    next();
  };
}

describe('Auth Routes', () => {
  let app: Application;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('GET /api/auth/me', () => {
    it('should return current user info', async () => {
      const ctx = createMockContext(
        ['streams:list', 'streams:read'],
        { id: 'jdoe', username: 'John Doe', email: 'jdoe@example.com', roles: ['viewer'] }
      );

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/auth', authRouter);

      const response = await request(app).get('/api/auth/me');

      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe('jdoe');
      expect(response.body.user.username).toBe('John Doe');
      expect(response.body.user.email).toBe('jdoe@example.com');
      expect(response.body.user.roles).toContain('viewer');
      expect(response.body.user.authSource).toBe('header');
      expect(response.body.capabilities).toContain('streams:list');
      expect(response.body.capabilities).toContain('streams:read');
    });

    it('should return anonymous user info when auth is disabled', async () => {
      const ctx = createMockContext(
        ['streams:list', 'users:manage'],
        { id: 'anonymous', username: 'Anonymous', authSource: 'anonymous', roles: ['admin'] }
      );

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/auth', authRouter);

      const response = await request(app).get('/api/auth/me');

      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe('anonymous');
      expect(response.body.user.authSource).toBe('anonymous');
    });
  });

  describe('GET /api/auth/capabilities', () => {
    it('should return capabilities with helper booleans', async () => {
      const ctx = createMockContext(['streams:list', 'streams:read', 'streams:start', 'streams:stop']);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/auth', authRouter);

      const response = await request(app).get('/api/auth/capabilities');

      expect(response.status).toBe(200);
      expect(response.body.capabilities).toHaveLength(4);
      expect(response.body.canControl).toBe(true);
      expect(response.body.canManage).toBe(false);
      expect(response.body.canAdmin).toBe(false);
    });

    it('should show canManage true for editors', async () => {
      const ctx = createMockContext([
        'streams:list', 'streams:read', 'streams:create', 'streams:update', 'streams:delete'
      ]);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/auth', authRouter);

      const response = await request(app).get('/api/auth/capabilities');

      expect(response.body.canManage).toBe(true);
    });

    it('should show canAdmin true for admins', async () => {
      const ctx = createMockContext(['users:manage', 'users:list']);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/auth', authRouter);

      const response = await request(app).get('/api/auth/capabilities');

      expect(response.body.canAdmin).toBe(true);
    });
  });

  describe('GET /api/auth/users', () => {
    it('should return user list with users:list capability', async () => {
      const ctx = createMockContext(['users:list']);
      vi.mocked(usersDb.listUsers).mockReturnValue([
        { id: 'user1', username: 'User 1', email: 'user1@example.com', firstSeen: '2024-01-01', lastSeen: '2024-01-02', roles: ['viewer'] },
        { id: 'user2', username: 'User 2', email: 'user2@example.com', firstSeen: '2024-01-01', lastSeen: '2024-01-02', roles: ['admin'] }
      ]);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/auth', authRouter);

      const response = await request(app).get('/api/auth/users');

      expect(response.status).toBe(200);
      expect(response.body.users).toHaveLength(2);
      expect(response.body.users[0].id).toBe('user1');
      expect(usersDb.listUsers).toHaveBeenCalled();
    });

    it('should return 403 without users:list capability', async () => {
      const ctx = createMockContext(['streams:list']); // No users:list

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/auth', authRouter);

      const response = await request(app).get('/api/auth/users');

      expect(response.status).toBe(403);
      expect(response.body.missing).toContain('users:list');
    });
  });

  describe('GET /api/auth/roles', () => {
    it('should return roles list with users:list capability', async () => {
      const ctx = createMockContext(['users:list']);
      vi.mocked(usersDb.getRoles).mockReturnValue([
        { id: 'viewer', name: 'Viewer', description: 'Read-only access', capabilities: ['streams:list', 'streams:read'], builtIn: true },
        { id: 'admin', name: 'Administrator', description: 'Full access', capabilities: ['*'], builtIn: true }
      ]);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/auth', authRouter);

      const response = await request(app).get('/api/auth/roles');

      expect(response.status).toBe(200);
      expect(response.body.roles).toHaveLength(2);
      expect(response.body.roles[0].id).toBe('viewer');
      expect(response.body.roles[1].id).toBe('admin');
      expect(usersDb.getRoles).toHaveBeenCalled();
    });

    it('should return 403 without users:list capability', async () => {
      const ctx = createMockContext(['streams:list']); // No users:list

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/auth', authRouter);

      const response = await request(app).get('/api/auth/roles');

      expect(response.status).toBe(403);
      expect(response.body.missing).toContain('users:list');
    });
  });

  describe('PUT /api/auth/users/:id/roles', () => {
    it('should update user roles with users:manage capability', async () => {
      const ctx = createMockContext(['users:manage'], { id: 'admin-user' });
      vi.mocked(usersDb.listUsers).mockReturnValue([
        { id: 'target-user', username: 'Target', email: null, firstSeen: '2024-01-01', lastSeen: '2024-01-02', roles: ['viewer'] }
      ]);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/auth', authRouter);

      const response = await request(app)
        .put('/api/auth/users/target-user/roles')
        .send({ roles: ['operator', 'editor'] });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.roles).toEqual(['operator', 'editor']);

      // Should add new roles
      expect(usersDb.assignUserRole).toHaveBeenCalledWith('target-user', 'operator', 'admin-user');
      expect(usersDb.assignUserRole).toHaveBeenCalledWith('target-user', 'editor', 'admin-user');

      // Should remove old roles
      expect(usersDb.removeUserRole).toHaveBeenCalledWith('target-user', 'viewer');

      // Should log audit event
      expect(auditDb.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'admin-user' }),
        'users:update_roles',
        expect.objectContaining({
          resourceType: 'user',
          resourceId: 'target-user',
          details: expect.objectContaining({
            added: expect.arrayContaining(['operator', 'editor']),
            removed: ['viewer']
          })
        })
      );
    });

    it('should return 404 for non-existent user', async () => {
      const ctx = createMockContext(['users:manage']);
      vi.mocked(usersDb.listUsers).mockReturnValue([]);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/auth', authRouter);

      const response = await request(app)
        .put('/api/auth/users/nonexistent/roles')
        .send({ roles: ['viewer'] });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });

    it('should return 400 for invalid roles format', async () => {
      const ctx = createMockContext(['users:manage']);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/auth', authRouter);

      const response = await request(app)
        .put('/api/auth/users/target-user/roles')
        .send({ roles: 'not-an-array' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid roles');
    });

    it('should return 400 for roles array with non-string items', async () => {
      const ctx = createMockContext(['users:manage']);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/auth', authRouter);

      const response = await request(app)
        .put('/api/auth/users/target-user/roles')
        .send({ roles: ['viewer', 123] });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid roles');
    });

    it('should return 403 without users:manage capability', async () => {
      const ctx = createMockContext(['users:list']); // No users:manage

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/auth', authRouter);

      const response = await request(app)
        .put('/api/auth/users/target-user/roles')
        .send({ roles: ['viewer'] });

      expect(response.status).toBe(403);
      expect(response.body.missing).toContain('users:manage');
    });

    it('should handle no changes when roles are the same', async () => {
      const ctx = createMockContext(['users:manage']);
      vi.mocked(usersDb.listUsers).mockReturnValue([
        { id: 'target-user', username: 'Target', email: null, firstSeen: '2024-01-01', lastSeen: '2024-01-02', roles: ['viewer'] }
      ]);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/auth', authRouter);

      const response = await request(app)
        .put('/api/auth/users/target-user/roles')
        .send({ roles: ['viewer'] });

      expect(response.status).toBe(200);
      expect(usersDb.assignUserRole).not.toHaveBeenCalled();
      expect(usersDb.removeUserRole).not.toHaveBeenCalled();
    });
  });
});
