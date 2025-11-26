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
  getContainerByName: vi.fn(),
  getRecentLogs: vi.fn(),
  startContainer: vi.fn(),
  stopContainer: vi.fn(),
  restartContainer: vi.fn(),
  refreshContainer: vi.fn(),
  createAndStartContainer: vi.fn(),
  removeContainer: vi.fn()
}));

// Mock the health-parser module
vi.mock('../../../src/server/health-parser.js', () => ({
  getLatestHealth: vi.fn(),
  extractHealthHistory: vi.fn()
}));

// Mock the audit module
vi.mock('../../../src/server/db/audit.js', () => ({
  logAuditEvent: vi.fn()
}));

// Mock the storage module
vi.mock('../../../src/server/config/storage.js', () => ({
  createStreamConfig: vi.fn(),
  getStreamConfig: vi.fn(),
  getStreamConfigByName: vi.fn(),
  listStreamConfigs: vi.fn(),
  updateStreamConfig: vi.fn(),
  deleteStreamConfig: vi.fn()
}));

// Mock the docker-generator module
vi.mock('../../../src/server/docker-generator.js', () => ({
  generateContainerConfig: vi.fn(),
  validateContainerConfig: vi.fn()
}));

import * as docker from '../../../src/server/docker.js';
import * as healthParser from '../../../src/server/health-parser.js';
import { logAuditEvent } from '../../../src/server/db/audit.js';
import * as storage from '../../../src/server/config/storage.js';
import * as dockerGenerator from '../../../src/server/docker-generator.js';
import { StreamConfigValidationError } from '../../../src/server/config/schema.js';
import { clearRateLimits } from '../../../src/server/routes/streams.js';

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
    clearRateLimits(); // Clear rate limits between tests
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

  // ============================================================================
  // Control Routes Tests (Phase 2)
  // ============================================================================

  describe('POST /api/streams/:id/start', () => {
    const stoppedContainer: StreamContainer = {
      ...mockContainer,
      status: 'stopped'
    };

    it('should start a stopped container with streams:start capability', async () => {
      const ctx = createMockContext(['streams:start']);
      vi.mocked(docker.getContainer).mockResolvedValue(stoppedContainer);
      vi.mocked(docker.startContainer).mockResolvedValue(undefined);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/abc123/start');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Container started');
      expect(docker.startContainer).toHaveBeenCalledWith('abc123');
      expect(logAuditEvent).toHaveBeenCalledWith(
        ctx.user,
        'stream:start',
        expect.objectContaining({
          resourceType: 'stream',
          resourceId: 'abc123'
        })
      );
    });

    it('should return 403 without streams:start capability', async () => {
      const ctx = createMockContext(['streams:read']);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/abc123/start');

      expect(response.status).toBe(403);
      expect(response.body.missing).toContain('streams:start');
    });

    it('should return 404 for non-existent container', async () => {
      const ctx = createMockContext(['streams:start']);
      vi.mocked(docker.getContainer).mockResolvedValue(null);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/nonexistent/start');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Stream not found');
    });

    it('should return 400 when container is already running', async () => {
      const ctx = createMockContext(['streams:start']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer); // Already running

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/abc123/start');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Container is already running');
    });

    it('should return 429 when rate limited', async () => {
      const ctx = createMockContext(['streams:start']);
      vi.mocked(docker.getContainer).mockResolvedValue(stoppedContainer);
      vi.mocked(docker.startContainer).mockResolvedValue(undefined);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      // First request should succeed
      const response1 = await request(app).post('/api/streams/abc123/start');
      expect(response1.status).toBe(200);

      // Reset container state for second request
      vi.mocked(docker.getContainer).mockResolvedValue(stoppedContainer);

      // Second request within 5 seconds should be rate limited
      const response2 = await request(app).post('/api/streams/abc123/start');
      expect(response2.status).toBe(429);
      expect(response2.body.error).toBe('Rate limited');
      expect(response2.body.retryAfter).toBeGreaterThan(0);
    });
  });

  describe('POST /api/streams/:id/stop', () => {
    it('should stop a running container with streams:stop capability', async () => {
      const ctx = createMockContext(['streams:stop']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer); // Running
      vi.mocked(docker.stopContainer).mockResolvedValue(undefined);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/abc123/stop');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Container stopped');
      expect(docker.stopContainer).toHaveBeenCalledWith('abc123', undefined);
    });

    it('should accept optional timeout parameter', async () => {
      const ctx = createMockContext(['streams:stop']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer);
      vi.mocked(docker.stopContainer).mockResolvedValue(undefined);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app)
        .post('/api/streams/abc123/stop')
        .send({ timeout: 60 });

      expect(response.status).toBe(200);
      expect(docker.stopContainer).toHaveBeenCalledWith('abc123', 60);
    });

    it('should return 403 without streams:stop capability', async () => {
      const ctx = createMockContext(['streams:read']);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/abc123/stop');

      expect(response.status).toBe(403);
      expect(response.body.missing).toContain('streams:stop');
    });

    it('should return 400 when container is not running', async () => {
      const ctx = createMockContext(['streams:stop']);
      vi.mocked(docker.getContainer).mockResolvedValue({ ...mockContainer, status: 'stopped' });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/abc123/stop');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Container is not running');
    });
  });

  describe('POST /api/streams/:id/restart', () => {
    it('should restart a container with streams:restart capability', async () => {
      const ctx = createMockContext(['streams:restart']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer);
      vi.mocked(docker.restartContainer).mockResolvedValue(undefined);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/abc123/restart');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Container restarted');
      expect(docker.restartContainer).toHaveBeenCalledWith('abc123', undefined);
    });

    it('should accept optional timeout parameter', async () => {
      const ctx = createMockContext(['streams:restart']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer);
      vi.mocked(docker.restartContainer).mockResolvedValue(undefined);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app)
        .post('/api/streams/abc123/restart')
        .send({ timeout: 45 });

      expect(response.status).toBe(200);
      expect(docker.restartContainer).toHaveBeenCalledWith('abc123', 45);
    });

    it('should return 403 without streams:restart capability', async () => {
      const ctx = createMockContext(['streams:read']);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/abc123/restart');

      expect(response.status).toBe(403);
      expect(response.body.missing).toContain('streams:restart');
    });

    it('should return 404 for non-existent container', async () => {
      const ctx = createMockContext(['streams:restart']);
      vi.mocked(docker.getContainer).mockResolvedValue(null);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/abc123/restart');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Stream not found');
    });
  });

  describe('POST /api/streams/:id/refresh', () => {
    it('should refresh a running container with streams:refresh capability', async () => {
      const ctx = createMockContext(['streams:refresh']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer); // Running
      vi.mocked(docker.refreshContainer).mockResolvedValue({ method: 'fifo', success: true });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/abc123/refresh');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Container refreshed via fifo');
      expect(response.body.method).toBe('fifo');
      expect(docker.refreshContainer).toHaveBeenCalledWith('abc123');
    });

    it('should return signal fallback method in response', async () => {
      const ctx = createMockContext(['streams:refresh']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer);
      vi.mocked(docker.refreshContainer).mockResolvedValue({ method: 'signal', success: true });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/abc123/refresh');

      expect(response.status).toBe(200);
      expect(response.body.method).toBe('signal');
      expect(response.body.message).toBe('Container refreshed via signal');
    });

    it('should return 403 without streams:refresh capability', async () => {
      const ctx = createMockContext(['streams:read']);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/abc123/refresh');

      expect(response.status).toBe(403);
      expect(response.body.missing).toContain('streams:refresh');
    });

    it('should return 400 when container is not running', async () => {
      const ctx = createMockContext(['streams:refresh']);
      vi.mocked(docker.getContainer).mockResolvedValue({ ...mockContainer, status: 'stopped' });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/abc123/refresh');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Container must be running to refresh');
    });

    it('should return failure message when refresh fails', async () => {
      const ctx = createMockContext(['streams:refresh']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer);
      vi.mocked(docker.refreshContainer).mockResolvedValue({ method: 'signal', success: false });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/abc123/refresh');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Refresh failed');
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit different actions on same container', async () => {
      const ctx = createMockContext(['streams:restart', 'streams:refresh']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer);
      vi.mocked(docker.restartContainer).mockResolvedValue(undefined);
      vi.mocked(docker.refreshContainer).mockResolvedValue({ method: 'fifo', success: true });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      // First restart should succeed
      const response1 = await request(app).post('/api/streams/abc123/restart');
      expect(response1.status).toBe(200);

      // Refresh on same container should be rate limited
      const response2 = await request(app).post('/api/streams/abc123/refresh');
      expect(response2.status).toBe(429);
    });

    it('should allow actions on different containers', async () => {
      const ctx = createMockContext(['streams:refresh']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer);
      vi.mocked(docker.refreshContainer).mockResolvedValue({ method: 'fifo', success: true });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      // First refresh on container1
      const response1 = await request(app).post('/api/streams/container1/refresh');
      expect(response1.status).toBe(200);

      // Refresh on different container should succeed
      const response2 = await request(app).post('/api/streams/container2/refresh');
      expect(response2.status).toBe(200);
    });
  });

  describe('Audit Logging', () => {
    it('should log audit event on successful action', async () => {
      const ctx = createMockContext(['streams:restart']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer);
      vi.mocked(docker.restartContainer).mockResolvedValue(undefined);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      await request(app).post('/api/streams/abc123/restart');

      expect(logAuditEvent).toHaveBeenCalledWith(
        ctx.user,
        'stream:restart',
        {
          resourceType: 'stream',
          resourceId: 'abc123',
          details: { streamName: 'test-stream-1', timeout: undefined }
        }
      );
    });

    it('should log audit event with failure on Docker error', async () => {
      const ctx = createMockContext(['streams:restart']);
      vi.mocked(docker.getContainer).mockResolvedValue(mockContainer);
      vi.mocked(docker.restartContainer).mockRejectedValue(new Error('Docker daemon error'));

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);
      // Add error handler
      app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ error: 'Internal server error', message: err.message });
      });

      await request(app).post('/api/streams/abc123/restart');

      expect(logAuditEvent).toHaveBeenCalledWith(
        ctx.user,
        'stream:restart',
        expect.objectContaining({
          result: 'failure',
          error: 'Docker daemon error'
        })
      );
    });
  });

  // ============================================================================
  // CRUD Routes Tests (Phase 3)
  // ============================================================================

  const mockStreamConfig = {
    id: 'config-123',
    name: 'test-stream',
    type: 'standard' as const,
    enabled: true,
    url: 'https://example.com',
    width: 1920,
    height: 1080,
    fps: 30,
    cropInfobar: 0,
    preset: 'veryfast' as const,
    videoBitrate: '2500k',
    audioBitrate: '128k',
    format: 'mpegts' as const,
    ingest: 'srt://localhost:9000',
    autoRefreshSeconds: 0,
    reconnectAttempts: 0,
    reconnectInitialDelayMs: 1000,
    reconnectMaxDelayMs: 30000,
    healthIntervalSeconds: 30,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    createdBy: 'test-user'
  };

  const mockContainerConfig = {
    name: 'test-stream',
    Image: 'page-stream:latest',
    Cmd: ['--ingest', 'srt://localhost:9000', '--url', 'https://example.com'],
    Env: ['DISPLAY=:99'],
    Labels: { 'com.page-stream.managed': 'true' },
    HostConfig: {
      Binds: [],
      NetworkMode: 'bridge',
      RestartPolicy: { Name: 'on-failure' as const }
    }
  };

  describe('GET /api/streams/configs', () => {
    it('should return list of stream configurations', async () => {
      const ctx = createMockContext(['streams:list']);
      vi.mocked(storage.listStreamConfigs).mockReturnValue({
        configs: [mockStreamConfig],
        total: 1
      });

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams/configs');

      expect(response.status).toBe(200);
      expect(response.body.configs).toHaveLength(1);
      expect(response.body.total).toBe(1);
    });

    it('should pass filter parameters to storage', async () => {
      const ctx = createMockContext(['streams:list']);
      vi.mocked(storage.listStreamConfigs).mockReturnValue({ configs: [], total: 0 });

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      await request(app).get('/api/streams/configs?type=standard&enabled=true&limit=10&offset=5');

      expect(storage.listStreamConfigs).toHaveBeenCalledWith({
        type: 'standard',
        enabled: true,
        limit: 10,
        offset: 5
      });
    });
  });

  describe('GET /api/streams/configs/:id', () => {
    it('should return stream configuration by ID', async () => {
      const ctx = createMockContext(['streams:read']);
      vi.mocked(storage.getStreamConfig).mockReturnValue(mockStreamConfig);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams/configs/config-123');

      expect(response.status).toBe(200);
      expect(response.body.config.id).toBe('config-123');
    });

    it('should return 404 for non-existent config', async () => {
      const ctx = createMockContext(['streams:read']);
      vi.mocked(storage.getStreamConfig).mockReturnValue(null);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).get('/api/streams/configs/nonexistent');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/streams (Create)', () => {
    it('should create stream config and start container when enabled', async () => {
      const ctx = createMockContext(['streams:create']);
      vi.mocked(storage.createStreamConfig).mockReturnValue(mockStreamConfig);
      vi.mocked(dockerGenerator.generateContainerConfig).mockReturnValue(mockContainerConfig);
      vi.mocked(dockerGenerator.validateContainerConfig).mockImplementation(() => {});
      vi.mocked(docker.createAndStartContainer).mockResolvedValue('new-container-id');

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app)
        .post('/api/streams')
        .send({
          name: 'test-stream',
          url: 'https://example.com',
          ingest: 'srt://localhost:9000'
        });

      expect(response.status).toBe(201);
      expect(response.body.stream.id).toBe('config-123');
      expect(response.body.containerId).toBe('new-container-id');
      expect(logAuditEvent).toHaveBeenCalledWith(
        ctx.user,
        'stream:create',
        expect.objectContaining({ resourceId: 'config-123' })
      );
    });

    it('should create stream config without starting container when disabled', async () => {
      const ctx = createMockContext(['streams:create']);
      const disabledConfig = { ...mockStreamConfig, enabled: false };
      vi.mocked(storage.createStreamConfig).mockReturnValue(disabledConfig);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app)
        .post('/api/streams')
        .send({
          name: 'test-stream',
          url: 'https://example.com',
          ingest: 'srt://localhost:9000',
          enabled: false
        });

      expect(response.status).toBe(201);
      expect(response.body.containerId).toBeUndefined();
      expect(docker.createAndStartContainer).not.toHaveBeenCalled();
    });

    it('should return 400 for validation errors', async () => {
      const ctx = createMockContext(['streams:create']);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app)
        .post('/api/streams')
        .send({
          name: '', // Invalid: empty name
          url: 'https://example.com',
          ingest: 'srt://localhost:9000'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation error');
    });

    it('should return 409 for duplicate name', async () => {
      const ctx = createMockContext(['streams:create']);
      vi.mocked(storage.createStreamConfig).mockImplementation(() => {
        throw new StreamConfigValidationError('Stream already exists', 'name', 'test-stream');
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app)
        .post('/api/streams')
        .send({
          name: 'test-stream',
          url: 'https://example.com',
          ingest: 'srt://localhost:9000'
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Conflict');
    });

    it('should return 403 without streams:create capability', async () => {
      const ctx = createMockContext(['streams:read']);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app)
        .post('/api/streams')
        .send({ name: 'test', url: 'https://example.com', ingest: 'srt://localhost:9000' });

      expect(response.status).toBe(403);
    });

    it('should return partial success when container fails to start', async () => {
      const ctx = createMockContext(['streams:create']);
      vi.mocked(storage.createStreamConfig).mockReturnValue(mockStreamConfig);
      vi.mocked(dockerGenerator.generateContainerConfig).mockReturnValue(mockContainerConfig);
      vi.mocked(dockerGenerator.validateContainerConfig).mockImplementation(() => {});
      vi.mocked(docker.createAndStartContainer).mockRejectedValue(new Error('Docker error'));

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app)
        .post('/api/streams')
        .send({
          name: 'test-stream',
          url: 'https://example.com',
          ingest: 'srt://localhost:9000'
        });

      expect(response.status).toBe(201);
      expect(response.body.stream).toBeDefined();
      expect(response.body.warning).toContain('container failed to start');
    });
  });

  describe('PUT /api/streams/:id (Update)', () => {
    it('should update stream configuration', async () => {
      const ctx = createMockContext(['streams:update']);
      vi.mocked(storage.getStreamConfig).mockReturnValue(mockStreamConfig);
      vi.mocked(storage.updateStreamConfig).mockReturnValue({
        ...mockStreamConfig,
        url: 'https://newurl.com'
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app)
        .put('/api/streams/config-123')
        .send({ url: 'https://newurl.com' });

      expect(response.status).toBe(200);
      expect(response.body.stream.url).toBe('https://newurl.com');
      expect(logAuditEvent).toHaveBeenCalledWith(
        ctx.user,
        'stream:update',
        expect.objectContaining({ details: { changes: ['url'] } })
      );
    });

    it('should return 404 for non-existent config', async () => {
      const ctx = createMockContext(['streams:update']);
      vi.mocked(storage.getStreamConfig).mockReturnValue(null);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app)
        .put('/api/streams/nonexistent')
        .send({ url: 'https://newurl.com' });

      expect(response.status).toBe(404);
    });

    it('should return 403 without streams:update capability', async () => {
      const ctx = createMockContext(['streams:read']);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app)
        .put('/api/streams/config-123')
        .send({ url: 'https://newurl.com' });

      expect(response.status).toBe(403);
    });
  });

  describe('DELETE /api/streams/:id', () => {
    it('should delete stream config and remove container', async () => {
      const ctx = createMockContext(['streams:delete']);
      vi.mocked(storage.getStreamConfig).mockReturnValue(mockStreamConfig);
      vi.mocked(docker.getContainerByName).mockResolvedValue(mockContainer);
      vi.mocked(docker.removeContainer).mockResolvedValue(undefined);
      vi.mocked(storage.deleteStreamConfig).mockReturnValue(true);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).delete('/api/streams/config-123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(docker.removeContainer).toHaveBeenCalledWith(mockContainer.id, true);
      expect(storage.deleteStreamConfig).toHaveBeenCalledWith('config-123');
      expect(logAuditEvent).toHaveBeenCalledWith(
        ctx.user,
        'stream:delete',
        expect.objectContaining({ resourceId: 'config-123' })
      );
    });

    it('should delete stream config even without running container', async () => {
      const ctx = createMockContext(['streams:delete']);
      vi.mocked(storage.getStreamConfig).mockReturnValue(mockStreamConfig);
      vi.mocked(docker.getContainerByName).mockResolvedValue(null);
      vi.mocked(storage.deleteStreamConfig).mockReturnValue(true);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).delete('/api/streams/config-123');

      expect(response.status).toBe(200);
      expect(docker.removeContainer).not.toHaveBeenCalled();
    });

    it('should return 404 for non-existent config', async () => {
      const ctx = createMockContext(['streams:delete']);
      vi.mocked(storage.getStreamConfig).mockReturnValue(null);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).delete('/api/streams/nonexistent');

      expect(response.status).toBe(404);
    });

    it('should return 403 without streams:delete capability', async () => {
      const ctx = createMockContext(['streams:read']);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).delete('/api/streams/config-123');

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/streams/:id/deploy', () => {
    it('should deploy stream config as new container', async () => {
      const ctx = createMockContext(['streams:create']);
      vi.mocked(storage.getStreamConfig).mockReturnValue(mockStreamConfig);
      vi.mocked(docker.getContainerByName).mockResolvedValue(null);
      vi.mocked(dockerGenerator.generateContainerConfig).mockReturnValue(mockContainerConfig);
      vi.mocked(dockerGenerator.validateContainerConfig).mockImplementation(() => {});
      vi.mocked(docker.createAndStartContainer).mockResolvedValue('deployed-container-id');

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/config-123/deploy');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.containerId).toBe('deployed-container-id');
      expect(response.body.redeployed).toBe(false);
    });

    it('should redeploy by removing existing container first', async () => {
      const ctx = createMockContext(['streams:create']);
      vi.mocked(storage.getStreamConfig).mockReturnValue(mockStreamConfig);
      vi.mocked(docker.getContainerByName).mockResolvedValue(mockContainer);
      vi.mocked(docker.removeContainer).mockResolvedValue(undefined);
      vi.mocked(dockerGenerator.generateContainerConfig).mockReturnValue(mockContainerConfig);
      vi.mocked(dockerGenerator.validateContainerConfig).mockImplementation(() => {});
      vi.mocked(docker.createAndStartContainer).mockResolvedValue('new-container-id');

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/config-123/deploy');

      expect(response.status).toBe(200);
      expect(response.body.redeployed).toBe(true);
      expect(docker.removeContainer).toHaveBeenCalledWith(mockContainer.id, true);
    });

    it('should return 404 for non-existent config', async () => {
      const ctx = createMockContext(['streams:create']);
      vi.mocked(storage.getStreamConfig).mockReturnValue(null);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/nonexistent/deploy');

      expect(response.status).toBe(404);
    });

    it('should return 500 on container creation failure', async () => {
      const ctx = createMockContext(['streams:create']);
      vi.mocked(storage.getStreamConfig).mockReturnValue(mockStreamConfig);
      vi.mocked(docker.getContainerByName).mockResolvedValue(null);
      vi.mocked(dockerGenerator.generateContainerConfig).mockReturnValue(mockContainerConfig);
      vi.mocked(dockerGenerator.validateContainerConfig).mockImplementation(() => {});
      vi.mocked(docker.createAndStartContainer).mockRejectedValue(new Error('Docker daemon error'));

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/streams', streamsRouter);

      const response = await request(app).post('/api/streams/config-123/deploy');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create container');
    });
  });
});
