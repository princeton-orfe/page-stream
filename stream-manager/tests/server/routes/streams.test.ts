import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Application, Request } from 'express';
import request from 'supertest';
import streamsRouter from '../../../src/server/routes/streams.js';
import type { RequestContext, Capability } from '../../../src/server/auth/types.js';
import type { StreamContainer } from '../../../src/server/docker.js';
import type { HealthStatus } from '../../../src/server/health-parser.js';

// Mock the docker module
vi.mock('../../../src/server/docker.js', () => ({
  listStreamContainers: vi.fn(),
  getContainer: vi.fn(),
  getRecentLogs: vi.fn()
}));

// Mock the health-parser module
vi.mock('../../../src/server/health-parser.js', () => ({
  getLatestHealth: vi.fn(),
  extractHealthHistory: vi.fn()
}));

import * as docker from '../../../src/server/docker.js';
import * as healthParser from '../../../src/server/health-parser.js';

// Helper to create mock request context
function createMockContext(capabilities: Capability[]): RequestContext {
  const capSet = new Set(capabilities);
  return {
    user: {
      id: 'test-user',
      username: 'Test User',
      roles: ['viewer'],
      authSource: 'header'
    },
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

// Sample test data
const mockContainer: StreamContainer = {
  id: 'abc123',
  name: 'test-stream-1',
  status: 'running',
  health: 'healthy',
  created: '2024-01-01T00:00:00Z',
  image: 'page-stream:latest',
  labels: {},
  ports: [{ container: 5000, host: 5000, protocol: 'tcp' }]
};

const mockHealthStatus: HealthStatus = {
  timestamp: '2024-01-01T00:00:00Z',
  uptimeSec: 3600,
  ingest: 'srt://example.com:9000',
  protocol: 'SRT',
  restartAttempt: 0,
  lastFfmpegExitCode: null,
  retrying: false
};

describe('Streams Routes', () => {
  let app: Application;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('GET /api/streams', () => {
    it('should return list of streams with streams:list capability', async () => {
      const ctx = createMockContext(['streams:list']);
      vi.mocked(docker.listStreamContainers).mockResolvedValue([mockContainer]);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams');

      expect(response.status).toBe(200);
      expect(response.body.streams).toHaveLength(1);
      expect(response.body.streams[0].id).toBe('abc123');
      expect(response.body.timestamp).toBeDefined();
      expect(docker.listStreamContainers).toHaveBeenCalled();
    });

    it('should return 403 without streams:list capability', async () => {
      const ctx = createMockContext(['streams:read']); // No streams:list

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Forbidden');
      expect(response.body.missing).toContain('streams:list');
    });

    it('should return empty array when no containers', async () => {
      const ctx = createMockContext(['streams:list']);
      vi.mocked(docker.listStreamContainers).mockResolvedValue([]);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams');

      expect(response.status).toBe(200);
      expect(response.body.streams).toEqual([]);
    });
  });

  describe('GET /api/streams/:id', () => {
    it('should return stream details with streams:read capability', async () => {
      const ctx = createMockContext(['streams:read']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer);
      vi.mocked(docker.getRecentLogs).mockResolvedValue(['log line 1', 'log line 2']);
      vi.mocked(healthParser.getLatestHealth).mockReturnValue(mockHealthStatus);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams/abc123');

      expect(response.status).toBe(200);
      expect(response.body.stream.id).toBe('abc123');
      expect(response.body.health.uptimeSec).toBe(3600);
      expect(response.body.recentLogs).toHaveLength(2);
      expect(docker.getContainer).toHaveBeenCalledWith('abc123');
      expect(docker.getRecentLogs).toHaveBeenCalledWith('abc123', 100);
    });

    it('should return 404 for non-existent stream', async () => {
      const ctx = createMockContext(['streams:read']);
      vi.mocked(docker.getContainer).mockResolvedValue(null);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Stream not found');
    });

    it('should return 403 without streams:read capability', async () => {
      const ctx = createMockContext(['streams:list']); // No streams:read

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams/abc123');

      expect(response.status).toBe(403);
      expect(response.body.missing).toContain('streams:read');
    });
  });

  describe('GET /api/streams/:id/logs', () => {
    it('should return logs with streams:logs capability', async () => {
      const ctx = createMockContext(['streams:logs']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer);
      vi.mocked(docker.getRecentLogs).mockResolvedValue([
        '2024-01-01T00:00:00Z Log line 1',
        '2024-01-01T00:00:01Z Log line 2'
      ]);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams/abc123/logs');

      expect(response.status).toBe(200);
      expect(response.body.logs).toHaveLength(2);
      expect(response.body.hasMore).toBe(false);
    });

    it('should respect lines query parameter', async () => {
      const ctx = createMockContext(['streams:logs']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer);
      vi.mocked(docker.getRecentLogs).mockResolvedValue(Array(50).fill('log'));

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams/abc123/logs?lines=50');

      expect(docker.getRecentLogs).toHaveBeenCalledWith('abc123', 50);
      expect(response.body.hasMore).toBe(true); // 50 logs returned = 50 requested
    });

    it('should return 404 for non-existent stream', async () => {
      const ctx = createMockContext(['streams:logs']);
      vi.mocked(docker.getContainer).mockResolvedValue(null);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams/nonexistent/logs');

      expect(response.status).toBe(404);
    });

    it('should return 403 without streams:logs capability', async () => {
      const ctx = createMockContext(['streams:read']); // No streams:logs

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams/abc123/logs');

      expect(response.status).toBe(403);
      expect(response.body.missing).toContain('streams:logs');
    });
  });

  describe('GET /api/streams/:id/health/history', () => {
    it('should return health history with streams:health capability', async () => {
      const ctx = createMockContext(['streams:health']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer);
      vi.mocked(docker.getRecentLogs).mockResolvedValue([]);
      vi.mocked(healthParser.extractHealthHistory).mockReturnValue([
        mockHealthStatus,
        { ...mockHealthStatus, uptimeSec: 7200 }
      ]);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams/abc123/health/history');

      expect(response.status).toBe(200);
      expect(response.body.history).toHaveLength(2);
      expect(response.body.latest.uptimeSec).toBe(7200); // Last item
    });

    it('should respect limit query parameter', async () => {
      const ctx = createMockContext(['streams:health']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer);
      vi.mocked(docker.getRecentLogs).mockResolvedValue([]);
      vi.mocked(healthParser.extractHealthHistory).mockReturnValue(
        Array(100).fill(mockHealthStatus)
      );

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams/abc123/health/history?limit=10');

      expect(response.body.history).toHaveLength(10);
    });

    it('should return null latest when no health history', async () => {
      const ctx = createMockContext(['streams:health']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer);
      vi.mocked(docker.getRecentLogs).mockResolvedValue([]);
      vi.mocked(healthParser.extractHealthHistory).mockReturnValue([]);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams/abc123/health/history');

      expect(response.status).toBe(200);
      expect(response.body.history).toEqual([]);
      expect(response.body.latest).toBeNull();
    });

    it('should return 404 for non-existent stream', async () => {
      const ctx = createMockContext(['streams:health']);
      vi.mocked(docker.getContainer).mockResolvedValue(null);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams/nonexistent/health/history');

      expect(response.status).toBe(404);
    });

    it('should return 403 without streams:health capability', async () => {
      const ctx = createMockContext(['streams:read']); // No streams:health

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams/abc123/health/history');

      expect(response.status).toBe(403);
      expect(response.body.missing).toContain('streams:health');
    });
  });

  describe('Error Handling', () => {
    it('should handle Docker API errors gracefully', async () => {
      const ctx = createMockContext(['streams:list']);
      vi.mocked(docker.listStreamContainers).mockRejectedValue(new Error('Docker connection failed'));

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);
      // Add error handler
      app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ error: 'Internal server error', message: err.message });
      });

      const response = await request(app).get('/api/streams');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });
});
