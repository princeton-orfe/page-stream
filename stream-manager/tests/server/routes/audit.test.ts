import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Application, Request } from 'express';
import request from 'supertest';
import auditRouter from '../../../src/server/routes/audit.js';
import type { RequestContext, Capability, User } from '../../../src/server/auth/types.js';

// Mock the db/audit module
vi.mock('../../../src/server/db/audit.js', () => ({
  queryAuditLog: vi.fn()
}));

import * as auditDb from '../../../src/server/db/audit.js';

// Helper to create mock request context
function createMockContext(capabilities: Capability[], userOverrides: Partial<User> = {}): RequestContext {
  const capSet = new Set(capabilities);
  const user: User = {
    id: 'test-user',
    username: 'Test User',
    email: 'test@example.com',
    roles: ['admin'],
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

describe('Audit Routes', () => {
  let app: Application;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('GET /api/audit', () => {
    it('should return audit entries with audit:read capability', async () => {
      const ctx = createMockContext(['audit:read']);
      vi.mocked(auditDb.queryAuditLog).mockReturnValue({
        entries: [
          {
            id: 1,
            timestamp: '2024-01-01T00:00:00Z',
            userId: 'user1',
            username: 'User 1',
            action: 'stream:start',
            resourceType: 'stream',
            resourceId: 'container-123',
            result: 'success'
          },
          {
            id: 2,
            timestamp: '2024-01-01T01:00:00Z',
            userId: 'user2',
            username: 'User 2',
            action: 'stream:stop',
            resourceType: 'stream',
            resourceId: 'container-456',
            result: 'success'
          }
        ],
        total: 2
      });

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/audit', auditRouter);

      const response = await request(app).get('/api/audit');

      expect(response.status).toBe(200);
      expect(response.body.entries).toHaveLength(2);
      expect(response.body.total).toBe(2);
      expect(response.body.limit).toBe(100);
      expect(response.body.offset).toBe(0);
      expect(response.body.hasMore).toBe(false);
      expect(auditDb.queryAuditLog).toHaveBeenCalledWith({
        limit: 100,
        offset: 0,
        userId: undefined,
        action: undefined,
        resourceType: undefined,
        since: undefined
      });
    });

    it('should return 403 without audit:read capability', async () => {
      const ctx = createMockContext(['streams:list']);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/audit', auditRouter);

      const response = await request(app).get('/api/audit');

      expect(response.status).toBe(403);
      expect(response.body.missing).toContain('audit:read');
    });

    it('should pass filter parameters to query', async () => {
      const ctx = createMockContext(['audit:read']);
      vi.mocked(auditDb.queryAuditLog).mockReturnValue({ entries: [], total: 0 });

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/audit', auditRouter);

      await request(app)
        .get('/api/audit')
        .query({
          limit: '50',
          offset: '10',
          userId: 'user1',
          action: 'stream:start',
          resourceType: 'stream',
          since: '2024-01-01T00:00:00Z'
        });

      expect(auditDb.queryAuditLog).toHaveBeenCalledWith({
        limit: 50,
        offset: 10,
        userId: 'user1',
        action: 'stream:start',
        resourceType: 'stream',
        since: '2024-01-01T00:00:00Z'
      });
    });

    it('should return 400 for invalid limit', async () => {
      const ctx = createMockContext(['audit:read']);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/audit', auditRouter);

      const response = await request(app)
        .get('/api/audit')
        .query({ limit: '9999' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid limit');
    });

    it('should return 400 for limit less than 1', async () => {
      const ctx = createMockContext(['audit:read']);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/audit', auditRouter);

      const response = await request(app)
        .get('/api/audit')
        .query({ limit: '0' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid limit');
    });

    it('should return 400 for negative offset', async () => {
      const ctx = createMockContext(['audit:read']);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/audit', auditRouter);

      const response = await request(app)
        .get('/api/audit')
        .query({ offset: '-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid offset');
    });

    it('should return 400 for invalid since date', async () => {
      const ctx = createMockContext(['audit:read']);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/audit', auditRouter);

      const response = await request(app)
        .get('/api/audit')
        .query({ since: 'not-a-date' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid since');
    });

    it('should correctly calculate hasMore when there are more entries', async () => {
      const ctx = createMockContext(['audit:read']);
      vi.mocked(auditDb.queryAuditLog).mockReturnValue({
        entries: Array(10).fill({
          id: 1,
          timestamp: '2024-01-01T00:00:00Z',
          userId: 'user1',
          username: 'User 1',
          action: 'stream:start',
          result: 'success'
        }),
        total: 50
      });

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/audit', auditRouter);

      const response = await request(app)
        .get('/api/audit')
        .query({ limit: '10' });

      expect(response.status).toBe(200);
      expect(response.body.hasMore).toBe(true);
    });
  });

  describe('GET /api/audit/actions', () => {
    it('should return known action types with audit:read capability', async () => {
      const ctx = createMockContext(['audit:read']);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/audit', auditRouter);

      const response = await request(app).get('/api/audit/actions');

      expect(response.status).toBe(200);
      expect(response.body.actions).toContain('stream:start');
      expect(response.body.actions).toContain('stream:stop');
      expect(response.body.actions).toContain('stream:restart');
      expect(response.body.actions).toContain('stream:refresh');
    });

    it('should return 403 without audit:read capability', async () => {
      const ctx = createMockContext(['streams:list']);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/audit', auditRouter);

      const response = await request(app).get('/api/audit/actions');

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/audit/export', () => {
    it('should return CSV with audit:read capability', async () => {
      const ctx = createMockContext(['audit:read']);
      vi.mocked(auditDb.queryAuditLog).mockReturnValue({
        entries: [
          {
            id: 1,
            timestamp: '2024-01-01T00:00:00Z',
            userId: 'user1',
            username: 'User 1',
            action: 'stream:start',
            resourceType: 'stream',
            resourceId: 'container-123',
            result: 'success',
            details: { streamName: 'test-stream' }
          }
        ],
        total: 1
      });

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/audit', auditRouter);

      const response = await request(app).get('/api/audit/export');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('audit-log');
      expect(response.text).toContain('timestamp,userId,username');
      expect(response.text).toContain('user1');
      expect(response.text).toContain('stream:start');
    });

    it('should return 403 without audit:read capability', async () => {
      const ctx = createMockContext(['streams:list']);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/audit', auditRouter);

      const response = await request(app).get('/api/audit/export');

      expect(response.status).toBe(403);
    });

    it('should pass filter parameters for export', async () => {
      const ctx = createMockContext(['audit:read']);
      vi.mocked(auditDb.queryAuditLog).mockReturnValue({ entries: [], total: 0 });

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/audit', auditRouter);

      await request(app)
        .get('/api/audit/export')
        .query({ userId: 'user1', action: 'stream:start' });

      expect(auditDb.queryAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user1',
        action: 'stream:start',
        limit: 10000
      }));
    });

    it('should return 400 for invalid since date in export', async () => {
      const ctx = createMockContext(['audit:read']);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/audit', auditRouter);

      const response = await request(app)
        .get('/api/audit/export')
        .query({ since: 'not-a-date' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid since');
    });

    it('should escape special characters in CSV', async () => {
      const ctx = createMockContext(['audit:read']);
      vi.mocked(auditDb.queryAuditLog).mockReturnValue({
        entries: [
          {
            id: 1,
            timestamp: '2024-01-01T00:00:00Z',
            userId: 'user1',
            username: 'User "Quoted" Name',
            action: 'stream:start',
            result: 'success'
          }
        ],
        total: 1
      });

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/audit', auditRouter);

      const response = await request(app).get('/api/audit/export');

      expect(response.status).toBe(200);
      // Quotes should be escaped as double quotes in CSV
      expect(response.text).toContain('""Quoted""');
    });
  });
});
