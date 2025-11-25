import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Server } from 'http';
import { BUILT_IN_ROLES } from '../../src/server/auth/rbac.js';
import { RoleStore } from '../../src/server/auth/middleware.js';
import { initDatabase, closeDatabase } from '../../src/server/db/index.js';
import { createApp } from '../../src/server/index.js';
import { closeWebSocketServer } from '../../src/server/websocket.js';

// Mock docker module
vi.mock('../../src/server/docker.js', () => ({
  listStreamContainers: vi.fn().mockResolvedValue([
    {
      id: 'container-1',
      name: 'page-stream-test',
      status: 'running',
      health: 'healthy',
      created: '2024-01-01T00:00:00Z',
      image: 'page-stream:latest',
      labels: {},
      ports: []
    }
  ]),
  getContainer: vi.fn().mockResolvedValue({
    id: 'container-1',
    name: 'page-stream-test',
    status: 'running',
    health: 'healthy',
    created: '2024-01-01T00:00:00Z',
    image: 'page-stream:latest',
    labels: {},
    ports: []
  }),
  getRecentLogs: vi.fn().mockResolvedValue([
    '2024-01-01T00:00:00Z Test log line',
    '[health] {"type":"health","uptimeSec":100,"ingest":"test","protocol":"SRT"}'
  ]),
  streamLogs: vi.fn().mockImplementation(async function* () {
    yield '2024-01-01T00:00:00Z Test log line';
  })
}));

// Create mock role store
function createMockRoleStore(): RoleStore {
  return {
    getRoles: vi.fn().mockResolvedValue(BUILT_IN_ROLES),
    getUserRoles: vi.fn().mockResolvedValue([]),
    mapGroupsToRoles: vi.fn().mockReturnValue([])
  };
}

describe('Express Server', () => {
  let app: ReturnType<typeof createApp> extends Promise<infer U> ? U : never;
  let server: Server;
  let roleStore: RoleStore;

  beforeAll(() => {
    // Initialize in-memory database
    initDatabase(':memory:');
    roleStore = createMockRoleStore();
  });

  afterAll(async () => {
    await closeWebSocketServer();
    closeDatabase();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const result = await createApp(roleStore);
    app = result;
    server = result.server;
  });

  afterEach(async () => {
    await closeWebSocketServer();
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await request(app.app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        authMode: 'none'
      });
    });
  });

  describe('Auth Routes', () => {
    it('should return current user info at /api/auth/me', async () => {
      const response = await request(app.app).get('/api/auth/me');

      expect(response.status).toBe(200);
      expect(response.body.user).toBeDefined();
      expect(response.body.user.id).toBe('anonymous');
      expect(response.body.capabilities).toContain('streams:list');
    });
  });

  describe('Streams Routes', () => {
    it('should list streams at /api/streams', async () => {
      const response = await request(app.app).get('/api/streams');

      expect(response.status).toBe(200);
      expect(response.body.streams).toBeDefined();
      expect(Array.isArray(response.body.streams)).toBe(true);
      expect(response.body.streams[0].name).toBe('page-stream-test');
      expect(response.body.timestamp).toBeDefined();
    });

    it('should get single stream at /api/streams/:id', async () => {
      const response = await request(app.app).get('/api/streams/container-1');

      expect(response.status).toBe(200);
      expect(response.body.stream).toBeDefined();
      expect(response.body.stream.id).toBe('container-1');
      expect(response.body.stream.name).toBe('page-stream-test');
      expect(response.body.recentLogs).toBeDefined();
    });
  });

  describe('Middleware', () => {
    it('should apply CORS headers', async () => {
      const response = await request(app.app)
        .get('/api/health')
        .set('Origin', 'http://localhost:3000');

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    });

    it('should apply security headers via helmet', async () => {
      const response = await request(app.app).get('/api/health');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    });
  });

  describe('loadAuthConfig', () => {
    it('should default to mode=none', async () => {
      expect(app.authConfig.mode).toBe('none');
    });

    it('should use default header names', () => {
      expect(app.authConfig.headers.userId).toBe('x-forwarded-user');
      expect(app.authConfig.headers.email).toBe('x-forwarded-email');
      expect(app.authConfig.headers.groups).toBe('x-forwarded-groups');
      expect(app.authConfig.headers.name).toBe('x-forwarded-preferred-username');
    });

    it('should use default role mapping', () => {
      expect(app.authConfig.roleMapping.defaultRole).toBe('viewer');
      expect(app.authConfig.roleMapping.anonymousRole).toBeNull();
    });
  });
});

describe('Express Server with proxy auth', () => {
  let app: ReturnType<typeof createApp> extends Promise<infer U> ? U : never;
  let server: Server;
  let roleStore: RoleStore;

  beforeAll(() => {
    // Set environment for proxy mode
    process.env.AUTH_MODE = 'proxy';
    process.env.AUTH_ANONYMOUS_ROLE = 'viewer';

    // Initialize in-memory database
    initDatabase(':memory:');
    roleStore = createMockRoleStore();
  });

  afterAll(async () => {
    delete process.env.AUTH_MODE;
    delete process.env.AUTH_ANONYMOUS_ROLE;
    await closeWebSocketServer();
    closeDatabase();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const result = await createApp(roleStore);
    app = result;
    server = result.server;
  });

  afterEach(async () => {
    await closeWebSocketServer();
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('should use proxy auth mode', async () => {
    const response = await request(app.app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.authMode).toBe('proxy');
  });

  it('should allow anonymous access with viewer role', async () => {
    const response = await request(app.app).get('/api/auth/me');

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe('anonymous');
    expect(response.body.user.roles).toContain('viewer');
  });

  it('should authenticate via headers', async () => {
    const response = await request(app.app)
      .get('/api/auth/me')
      .set('x-forwarded-user', 'testuser')
      .set('x-forwarded-email', 'test@example.com')
      .set('x-forwarded-preferred-username', 'Test User');

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe('testuser');
    expect(response.body.user.username).toBe('Test User');
    expect(response.body.user.email).toBe('test@example.com');
  });
});
