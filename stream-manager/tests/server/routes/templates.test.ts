import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Application, Request } from 'express';
import request from 'supertest';
import templatesRouter from '../../../src/server/routes/templates.js';
import type { RequestContext, Capability, User } from '../../../src/server/auth/types.js';

// Mock the db/audit module
vi.mock('../../../src/server/db/audit.js', () => ({
  logAuditEvent: vi.fn()
}));

// Mock the config/templates module
vi.mock('../../../src/server/config/templates.js', () => ({
  createTemplate: vi.fn(),
  getTemplate: vi.fn(),
  getTemplateByName: vi.fn(),
  listTemplates: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  applyTemplate: vi.fn(),
  createTemplateFromConfig: vi.fn(),
  TemplateValidationError: class TemplateValidationError extends Error {
    constructor(message: string, public field: string, public value: unknown) {
      super(message);
      this.name = 'TemplateValidationError';
    }
  }
}));

// Mock the config/storage module
vi.mock('../../../src/server/config/storage.js', () => ({
  getStreamConfig: vi.fn()
}));

import * as templates from '../../../src/server/config/templates.js';
import * as storage from '../../../src/server/config/storage.js';

// Helper to create mock request context
function createMockContext(capabilities: Capability[], userOverrides: Partial<User> = {}): RequestContext {
  const capSet = new Set(capabilities);
  const user: User = {
    id: 'test-user',
    username: 'Test User',
    email: 'test@example.com',
    roles: ['editor'],
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

describe('Template Routes', () => {
  let app: Application;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('GET /api/templates', () => {
    it('should return templates with templates:list capability', async () => {
      const ctx = createMockContext(['templates:list']);
      vi.mocked(templates.listTemplates).mockReturnValue({
        templates: [
          {
            id: 'tmpl-1',
            name: 'Basic Web Page',
            description: 'Standard web page streaming',
            category: 'standard',
            config: { width: 1920, height: 1080 },
            builtIn: true,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z'
          }
        ],
        total: 1
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app).get('/api/templates');

      expect(response.status).toBe(200);
      expect(response.body.templates).toHaveLength(1);
      expect(response.body.total).toBe(1);
    });

    it('should return 403 without templates:list capability', async () => {
      const ctx = createMockContext([]);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app).get('/api/templates');

      expect(response.status).toBe(403);
    });

    it('should filter by category', async () => {
      const ctx = createMockContext(['templates:list']);
      vi.mocked(templates.listTemplates).mockReturnValue({
        templates: [],
        total: 0
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      await request(app).get('/api/templates?category=compositor');

      expect(templates.listTemplates).toHaveBeenCalledWith({
        category: 'compositor',
        builtIn: undefined,
        limit: undefined,
        offset: undefined
      });
    });

    it('should filter by builtIn', async () => {
      const ctx = createMockContext(['templates:list']);
      vi.mocked(templates.listTemplates).mockReturnValue({
        templates: [],
        total: 0
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      await request(app).get('/api/templates?builtIn=true');

      expect(templates.listTemplates).toHaveBeenCalledWith({
        category: undefined,
        builtIn: true,
        limit: undefined,
        offset: undefined
      });
    });
  });

  describe('GET /api/templates/:id', () => {
    it('should return template with templates:read capability', async () => {
      const ctx = createMockContext(['templates:read']);
      vi.mocked(templates.getTemplate).mockReturnValue({
        id: 'tmpl-1',
        name: 'Test Template',
        description: 'Test description',
        category: 'standard',
        config: { width: 1920, height: 1080 },
        builtIn: false,
        createdBy: 'test-user',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app).get('/api/templates/tmpl-1');

      expect(response.status).toBe(200);
      expect(response.body.template.id).toBe('tmpl-1');
    });

    it('should return 404 for non-existent template', async () => {
      const ctx = createMockContext(['templates:read']);
      vi.mocked(templates.getTemplate).mockReturnValue(null);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app).get('/api/templates/non-existent');

      expect(response.status).toBe(404);
    });

    it('should return 403 without templates:read capability', async () => {
      const ctx = createMockContext([]);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app).get('/api/templates/tmpl-1');

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/templates', () => {
    it('should create template with templates:create capability', async () => {
      const ctx = createMockContext(['templates:create']);
      vi.mocked(templates.createTemplate).mockReturnValue({
        id: 'new-tmpl',
        name: 'New Template',
        description: 'New description',
        category: 'custom',
        config: { width: 1280, height: 720 },
        builtIn: false,
        createdBy: 'test-user',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app)
        .post('/api/templates')
        .send({
          name: 'New Template',
          description: 'New description',
          category: 'custom',
          config: { width: 1280, height: 720 }
        });

      expect(response.status).toBe(201);
      expect(response.body.template.id).toBe('new-tmpl');
    });

    it('should return 400 for invalid input', async () => {
      const ctx = createMockContext(['templates:create']);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app)
        .post('/api/templates')
        .send({
          // Missing required name
          description: 'Test',
          config: {}
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation error');
    });

    it('should return 409 for duplicate name', async () => {
      const ctx = createMockContext(['templates:create']);
      const { TemplateValidationError } = templates;
      vi.mocked(templates.createTemplate).mockImplementation(() => {
        throw new TemplateValidationError('A template with name "Existing" already exists', 'name', 'Existing');
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app)
        .post('/api/templates')
        .send({
          name: 'Existing',
          description: 'Test',
          config: {}
        });

      expect(response.status).toBe(409);
    });

    it('should return 403 without templates:create capability', async () => {
      const ctx = createMockContext(['templates:read']);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app)
        .post('/api/templates')
        .send({
          name: 'Test',
          description: 'Test',
          config: {}
        });

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/templates/from-stream/:streamId', () => {
    it('should create template from stream config', async () => {
      const ctx = createMockContext(['templates:create']);
      vi.mocked(storage.getStreamConfig).mockReturnValue({
        id: 'stream-1',
        name: 'my-stream',
        type: 'standard',
        enabled: true,
        url: 'https://example.com',
        width: 1920,
        height: 1080,
        fps: 30,
        cropInfobar: 0,
        preset: 'veryfast',
        videoBitrate: '2500k',
        audioBitrate: '128k',
        format: 'mpegts',
        ingest: 'srt://localhost:9000',
        autoRefreshSeconds: 0,
        reconnectAttempts: 0,
        reconnectInitialDelayMs: 1000,
        reconnectMaxDelayMs: 30000,
        healthIntervalSeconds: 30,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'test-user'
      });
      vi.mocked(templates.createTemplateFromConfig).mockReturnValue({
        id: 'new-tmpl',
        name: 'From my-stream',
        description: 'Created from stream "my-stream"',
        category: 'custom',
        config: { width: 1920, height: 1080, preset: 'veryfast' },
        builtIn: false,
        createdBy: 'test-user',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app)
        .post('/api/templates/from-stream/stream-1')
        .send({
          name: 'From my-stream'
        });

      expect(response.status).toBe(201);
      expect(response.body.template.id).toBe('new-tmpl');
    });

    it('should return 404 for non-existent stream', async () => {
      const ctx = createMockContext(['templates:create']);
      vi.mocked(storage.getStreamConfig).mockReturnValue(null);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app)
        .post('/api/templates/from-stream/non-existent')
        .send({
          name: 'Test Template'
        });

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /api/templates/:id', () => {
    it('should update template with templates:create capability', async () => {
      const ctx = createMockContext(['templates:create']);
      vi.mocked(templates.getTemplate).mockReturnValue({
        id: 'tmpl-1',
        name: 'Test Template',
        description: 'Test',
        category: 'custom',
        config: {},
        builtIn: false,
        createdBy: 'test-user',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      });
      vi.mocked(templates.updateTemplate).mockReturnValue({
        id: 'tmpl-1',
        name: 'Updated Template',
        description: 'Updated',
        category: 'custom',
        config: {},
        builtIn: false,
        createdBy: 'test-user',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T01:00:00Z'
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app)
        .put('/api/templates/tmpl-1')
        .send({
          name: 'Updated Template',
          description: 'Updated'
        });

      expect(response.status).toBe(200);
      expect(response.body.template.name).toBe('Updated Template');
    });

    it('should return 403 for built-in template update', async () => {
      const ctx = createMockContext(['templates:create']);
      vi.mocked(templates.getTemplate).mockReturnValue({
        id: 'tmpl-1',
        name: 'Built-in',
        description: 'Test',
        category: 'standard',
        config: {},
        builtIn: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      });
      const { TemplateValidationError } = templates;
      vi.mocked(templates.updateTemplate).mockImplementation(() => {
        throw new TemplateValidationError('Cannot modify built-in templates', 'id', 'tmpl-1');
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app)
        .put('/api/templates/tmpl-1')
        .send({
          description: 'Trying to modify'
        });

      expect(response.status).toBe(403);
    });

    it('should return 404 for non-existent template', async () => {
      const ctx = createMockContext(['templates:create']);
      vi.mocked(templates.getTemplate).mockReturnValue(null);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app)
        .put('/api/templates/non-existent')
        .send({
          description: 'Test'
        });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/templates/:id', () => {
    it('should delete template with templates:delete capability', async () => {
      const ctx = createMockContext(['templates:delete']);
      vi.mocked(templates.getTemplate).mockReturnValue({
        id: 'tmpl-1',
        name: 'Test Template',
        description: 'Test',
        category: 'custom',
        config: {},
        builtIn: false,
        createdBy: 'test-user',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      });
      vi.mocked(templates.deleteTemplate).mockReturnValue(true);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app).delete('/api/templates/tmpl-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 403 for built-in template delete', async () => {
      const ctx = createMockContext(['templates:delete']);
      vi.mocked(templates.getTemplate).mockReturnValue({
        id: 'tmpl-1',
        name: 'Built-in',
        description: 'Test',
        category: 'standard',
        config: {},
        builtIn: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      });
      const { TemplateValidationError } = templates;
      vi.mocked(templates.deleteTemplate).mockImplementation(() => {
        throw new TemplateValidationError('Cannot delete built-in templates', 'id', 'tmpl-1');
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app).delete('/api/templates/tmpl-1');

      expect(response.status).toBe(403);
    });

    it('should return 403 without templates:delete capability', async () => {
      const ctx = createMockContext(['templates:read']);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app).delete('/api/templates/tmpl-1');

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/templates/:id/apply', () => {
    it('should apply template with templates:read capability', async () => {
      const ctx = createMockContext(['templates:read']);
      vi.mocked(templates.applyTemplate).mockReturnValue({
        name: 'my-stream',
        type: 'standard',
        enabled: true,
        url: 'https://example.com',
        width: 1920,
        height: 1080,
        fps: 30,
        cropInfobar: 0,
        preset: 'veryfast',
        videoBitrate: '2500k',
        audioBitrate: '128k',
        format: 'mpegts',
        ingest: 'srt://localhost:9000',
        autoRefreshSeconds: 0,
        reconnectAttempts: 0,
        reconnectInitialDelayMs: 1000,
        reconnectMaxDelayMs: 30000,
        healthIntervalSeconds: 30
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app)
        .post('/api/templates/tmpl-1/apply')
        .send({
          name: 'my-stream',
          url: 'https://example.com',
          ingest: 'srt://localhost:9000'
        });

      expect(response.status).toBe(200);
      expect(response.body.config.name).toBe('my-stream');
      expect(response.body.config.width).toBe(1920);
    });

    it('should return 400 for missing required fields', async () => {
      const ctx = createMockContext(['templates:read']);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app)
        .post('/api/templates/tmpl-1/apply')
        .send({
          name: 'my-stream'
          // Missing url and ingest
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('url');
      expect(response.body.message).toContain('ingest');
    });

    it('should return 404 for non-existent template', async () => {
      const ctx = createMockContext(['templates:read']);
      const { TemplateValidationError } = templates;
      vi.mocked(templates.applyTemplate).mockImplementation(() => {
        throw new TemplateValidationError('Template not found', 'templateId', 'non-existent');
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/templates', templatesRouter);

      const response = await request(app)
        .post('/api/templates/non-existent/apply')
        .send({
          name: 'test',
          url: 'https://example.com',
          ingest: 'srt://localhost:9000'
        });

      expect(response.status).toBe(404);
    });
  });
});
