import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Application, Request } from 'express';
import request from 'supertest';
import alertsRouter from '../../../src/server/routes/alerts.js';
import type { RequestContext, Capability } from '../../../src/server/auth/types.js';

// Mock the storage module
vi.mock('../../../src/server/alerts/storage.js', () => ({
  createAlertRule: vi.fn(),
  getAlertRule: vi.fn(),
  listAlertRules: vi.fn(),
  updateAlertRule: vi.fn(),
  deleteAlertRule: vi.fn(),
  getAlertRulesForTarget: vi.fn(),
  listAlertEvents: vi.fn(),
  getAlertEvent: vi.fn(),
  acknowledgeAlertEvent: vi.fn(),
  acknowledgeAllEvents: vi.fn(),
  getUnacknowledgedEventCount: vi.fn(),
  getActiveEvents: vi.fn()
}));

// Mock the schema module
vi.mock('../../../src/server/alerts/schema.js', () => ({
  validateAlertRuleCreate: vi.fn(),
  validateAlertRuleUpdate: vi.fn(),
  AlertValidationError: class AlertValidationError extends Error {
    field?: string;
    constructor(message: string, field?: string) {
      super(message);
      this.name = 'AlertValidationError';
      this.field = field;
    }
  }
}));

// Mock the evaluator module
vi.mock('../../../src/server/alerts/evaluator.js', () => ({
  getAlertEvaluatorStatus: vi.fn(),
  startAlertEvaluator: vi.fn(),
  stopAlertEvaluator: vi.fn()
}));

// Mock the notifications module
vi.mock('../../../src/server/alerts/notifications.js', () => ({
  testNotificationChannel: vi.fn()
}));

// Mock the audit module
vi.mock('../../../src/server/db/audit.js', () => ({
  logAuditEvent: vi.fn()
}));

import * as storage from '../../../src/server/alerts/storage.js';
import * as schema from '../../../src/server/alerts/schema.js';
import * as evaluator from '../../../src/server/alerts/evaluator.js';
import * as notifications from '../../../src/server/alerts/notifications.js';
import { logAuditEvent } from '../../../src/server/db/audit.js';

// Helper to create mock request context
function createMockContext(capabilities: Capability[]): RequestContext {
  const capSet = new Set(capabilities);
  return {
    user: {
      id: 'test-user',
      username: 'Test User',
      roles: ['admin'],
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
const mockAlertRule = {
  id: 'rule-123',
  name: 'test-alert',
  description: 'Test alert description',
  enabled: true,
  targetType: 'stream' as const,
  targetId: 'stream-456',
  condition: { type: 'status_changed' as const, statusTo: 'stopped' },
  severity: 'warning' as const,
  notifications: [{ type: 'webhook' as const, url: 'https://example.com/hook' }],
  cooldownMinutes: 15,
  triggerCount: 5,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  createdBy: 'test-user'
};

const mockAlertEvent = {
  id: 'event-123',
  ruleId: 'rule-123',
  ruleName: 'test-alert',
  severity: 'warning' as const,
  targetType: 'stream' as const,
  targetId: 'stream-456',
  targetName: 'Test Stream',
  condition: { type: 'status_changed' as const, statusTo: 'stopped' },
  message: 'Stream stopped unexpectedly',
  createdAt: '2024-01-01T00:00:00Z'
};

describe('Alerts Routes', () => {
  let app: Application;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ==========================================================================
  // Alert Rules CRUD
  // ==========================================================================

  describe('GET /api/alerts/rules', () => {
    it('should return list of alert rules with alerts:list capability', async () => {
      const ctx = createMockContext(['alerts:list']);
      vi.mocked(storage.listAlertRules).mockReturnValue({
        rules: [mockAlertRule],
        total: 1
      });

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).get('/api/alerts/rules');

      expect(response.status).toBe(200);
      expect(response.body.rules).toHaveLength(1);
      expect(response.body.total).toBe(1);
      expect(storage.listAlertRules).toHaveBeenCalled();
    });

    it('should pass filter parameters to storage', async () => {
      const ctx = createMockContext(['alerts:list']);
      vi.mocked(storage.listAlertRules).mockReturnValue({ rules: [], total: 0 });

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      await request(app).get('/api/alerts/rules?enabled=true&targetType=stream&severity=warning&limit=10&offset=5');

      expect(storage.listAlertRules).toHaveBeenCalledWith({
        enabled: true,
        targetType: 'stream',
        targetId: undefined,
        severity: 'warning',
        limit: 10,
        offset: 5
      });
    });

    it('should return 403 without alerts:list capability', async () => {
      const ctx = createMockContext(['alerts:read']);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).get('/api/alerts/rules');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Forbidden');
    });
  });

  describe('GET /api/alerts/rules/by-target/:targetType/:targetId', () => {
    it('should return rules for specific target', async () => {
      const ctx = createMockContext(['alerts:list']);
      vi.mocked(storage.getAlertRulesForTarget).mockReturnValue([mockAlertRule]);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).get('/api/alerts/rules/by-target/stream/stream-456');

      expect(response.status).toBe(200);
      expect(response.body.rules).toHaveLength(1);
      expect(response.body.total).toBe(1);
      expect(storage.getAlertRulesForTarget).toHaveBeenCalledWith('stream', 'stream-456');
    });

    it('should return 400 for invalid target type', async () => {
      const ctx = createMockContext(['alerts:list']);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).get('/api/alerts/rules/by-target/invalid/stream-456');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid target type');
    });
  });

  describe('GET /api/alerts/rules/:id', () => {
    it('should return alert rule by ID with alerts:read capability', async () => {
      const ctx = createMockContext(['alerts:read']);
      vi.mocked(storage.getAlertRule).mockReturnValue(mockAlertRule);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).get('/api/alerts/rules/rule-123');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('rule-123');
      expect(response.body.name).toBe('test-alert');
    });

    it('should return 404 for non-existent rule', async () => {
      const ctx = createMockContext(['alerts:read']);
      vi.mocked(storage.getAlertRule).mockReturnValue(null);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).get('/api/alerts/rules/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Alert rule not found');
    });

    it('should return 403 without alerts:read capability', async () => {
      const ctx = createMockContext(['alerts:list']);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).get('/api/alerts/rules/rule-123');

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/alerts/rules', () => {
    it('should create alert rule with alerts:create capability', async () => {
      const ctx = createMockContext(['alerts:create']);
      const createInput = {
        name: 'test-alert',
        targetType: 'stream',
        condition: { type: 'status_changed' }
      };
      vi.mocked(schema.validateAlertRuleCreate).mockReturnValue(createInput as ReturnType<typeof schema.validateAlertRuleCreate>);
      vi.mocked(storage.createAlertRule).mockReturnValue(mockAlertRule);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app)
        .post('/api/alerts/rules')
        .send(createInput);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('rule-123');
      expect(logAuditEvent).toHaveBeenCalledWith(
        ctx.user,
        'alert:create',
        expect.objectContaining({
          resourceType: 'alert_rule',
          resourceId: 'rule-123'
        })
      );
    });

    it('should return 400 for validation errors', async () => {
      const ctx = createMockContext(['alerts:create']);
      vi.mocked(schema.validateAlertRuleCreate).mockImplementation(() => {
        throw new schema.AlertValidationError('name is required', 'name');
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app)
        .post('/api/alerts/rules')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation error');
      expect(response.body.field).toBe('name');
    });

    it('should return 403 without alerts:create capability', async () => {
      const ctx = createMockContext(['alerts:read']);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app)
        .post('/api/alerts/rules')
        .send({ name: 'test' });

      expect(response.status).toBe(403);
    });
  });

  describe('PUT /api/alerts/rules/:id', () => {
    it('should update alert rule with alerts:update capability', async () => {
      const ctx = createMockContext(['alerts:update']);
      const updateInput = { name: 'updated-alert' };
      vi.mocked(schema.validateAlertRuleUpdate).mockReturnValue(updateInput);
      vi.mocked(storage.updateAlertRule).mockReturnValue({
        ...mockAlertRule,
        name: 'updated-alert'
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app)
        .put('/api/alerts/rules/rule-123')
        .send(updateInput);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('updated-alert');
      expect(logAuditEvent).toHaveBeenCalledWith(
        ctx.user,
        'alert:update',
        expect.objectContaining({
          resourceType: 'alert_rule',
          resourceId: 'rule-123'
        })
      );
    });

    it('should return 404 for non-existent rule', async () => {
      const ctx = createMockContext(['alerts:update']);
      vi.mocked(schema.validateAlertRuleUpdate).mockReturnValue({ name: 'updated' });
      vi.mocked(storage.updateAlertRule).mockImplementation(() => {
        throw new schema.AlertValidationError('Rule not found', 'id');
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app)
        .put('/api/alerts/rules/nonexistent')
        .send({ name: 'updated' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Alert rule not found');
    });

    it('should return 400 for validation errors', async () => {
      const ctx = createMockContext(['alerts:update']);
      vi.mocked(schema.validateAlertRuleUpdate).mockImplementation(() => {
        throw new schema.AlertValidationError('Invalid severity', 'severity');
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app)
        .put('/api/alerts/rules/rule-123')
        .send({ severity: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.field).toBe('severity');
    });
  });

  describe('DELETE /api/alerts/rules/:id', () => {
    it('should delete alert rule with alerts:delete capability', async () => {
      const ctx = createMockContext(['alerts:delete']);
      vi.mocked(storage.getAlertRule).mockReturnValue(mockAlertRule);
      vi.mocked(storage.deleteAlertRule).mockReturnValue(true);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).delete('/api/alerts/rules/rule-123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(logAuditEvent).toHaveBeenCalledWith(
        ctx.user,
        'alert:delete',
        expect.objectContaining({
          resourceType: 'alert_rule',
          resourceId: 'rule-123'
        })
      );
    });

    it('should return 404 for non-existent rule', async () => {
      const ctx = createMockContext(['alerts:delete']);
      vi.mocked(storage.getAlertRule).mockReturnValue(null);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).delete('/api/alerts/rules/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Alert rule not found');
    });

    it('should return 403 without alerts:delete capability', async () => {
      const ctx = createMockContext(['alerts:read']);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).delete('/api/alerts/rules/rule-123');

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/alerts/rules/:id/enable', () => {
    it('should enable alert rule', async () => {
      const ctx = createMockContext(['alerts:update']);
      vi.mocked(storage.updateAlertRule).mockReturnValue({
        ...mockAlertRule,
        enabled: true
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).post('/api/alerts/rules/rule-123/enable');

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(true);
      expect(storage.updateAlertRule).toHaveBeenCalledWith(
        'rule-123',
        { enabled: true },
        ctx.user
      );
      expect(logAuditEvent).toHaveBeenCalledWith(
        ctx.user,
        'alert:enable',
        expect.objectContaining({ resourceId: 'rule-123' })
      );
    });

    it('should return 404 for non-existent rule', async () => {
      const ctx = createMockContext(['alerts:update']);
      vi.mocked(storage.updateAlertRule).mockImplementation(() => {
        throw new schema.AlertValidationError('Rule not found', 'id');
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).post('/api/alerts/rules/nonexistent/enable');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/alerts/rules/:id/disable', () => {
    it('should disable alert rule', async () => {
      const ctx = createMockContext(['alerts:update']);
      vi.mocked(storage.updateAlertRule).mockReturnValue({
        ...mockAlertRule,
        enabled: false
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).post('/api/alerts/rules/rule-123/disable');

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(false);
      expect(storage.updateAlertRule).toHaveBeenCalledWith(
        'rule-123',
        { enabled: false },
        ctx.user
      );
      expect(logAuditEvent).toHaveBeenCalledWith(
        ctx.user,
        'alert:disable',
        expect.objectContaining({ resourceId: 'rule-123' })
      );
    });
  });

  describe('POST /api/alerts/rules/:id/test', () => {
    it('should test notification channels', async () => {
      const ctx = createMockContext(['alerts:update']);
      vi.mocked(storage.getAlertRule).mockReturnValue(mockAlertRule);
      vi.mocked(notifications.testNotificationChannel).mockResolvedValue({
        success: true,
        message: 'Test notification sent'
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).post('/api/alerts/rules/rule-123/test');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].channel).toBe('webhook');
    });

    it('should return 404 for non-existent rule', async () => {
      const ctx = createMockContext(['alerts:update']);
      vi.mocked(storage.getAlertRule).mockReturnValue(null);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).post('/api/alerts/rules/nonexistent/test');

      expect(response.status).toBe(404);
    });

    it('should return 400 if rule has no notifications', async () => {
      const ctx = createMockContext(['alerts:update']);
      vi.mocked(storage.getAlertRule).mockReturnValue({
        ...mockAlertRule,
        notifications: []
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).post('/api/alerts/rules/rule-123/test');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Alert rule has no notification channels configured');
    });

    it('should report partial failure', async () => {
      const ctx = createMockContext(['alerts:update']);
      vi.mocked(storage.getAlertRule).mockReturnValue({
        ...mockAlertRule,
        notifications: [
          { type: 'webhook' as const, url: 'https://example.com/hook' },
          { type: 'email' as const, recipients: ['test@example.com'] }
        ]
      });
      vi.mocked(notifications.testNotificationChannel)
        .mockResolvedValueOnce({ success: true, message: 'OK' })
        .mockResolvedValueOnce({ success: false, message: 'SMTP error' });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).post('/api/alerts/rules/rule-123/test');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.results[0].success).toBe(true);
      expect(response.body.results[1].success).toBe(false);
    });
  });

  // ==========================================================================
  // Alert Events
  // ==========================================================================

  describe('GET /api/alerts/events', () => {
    it('should return list of events with alerts:list capability', async () => {
      const ctx = createMockContext(['alerts:list']);
      vi.mocked(storage.listAlertEvents).mockReturnValue({
        events: [mockAlertEvent],
        total: 1
      });

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).get('/api/alerts/events');

      expect(response.status).toBe(200);
      expect(response.body.events).toHaveLength(1);
      expect(response.body.total).toBe(1);
    });

    it('should pass filter parameters', async () => {
      const ctx = createMockContext(['alerts:list']);
      vi.mocked(storage.listAlertEvents).mockReturnValue({ events: [], total: 0 });

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      await request(app).get('/api/alerts/events?ruleId=rule-123&acknowledged=false&resolved=false');

      expect(storage.listAlertEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleId: 'rule-123',
          acknowledged: false,
          resolved: false
        })
      );
    });
  });

  describe('GET /api/alerts/events/active', () => {
    it('should return active events', async () => {
      const ctx = createMockContext(['alerts:list']);
      vi.mocked(storage.getActiveEvents).mockReturnValue([mockAlertEvent]);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).get('/api/alerts/events/active');

      expect(response.status).toBe(200);
      expect(response.body.events).toHaveLength(1);
      expect(response.body.total).toBe(1);
    });
  });

  describe('GET /api/alerts/events/count', () => {
    it('should return unacknowledged event count', async () => {
      const ctx = createMockContext(['alerts:list']);
      vi.mocked(storage.getUnacknowledgedEventCount).mockReturnValue(5);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).get('/api/alerts/events/count');

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(5);
    });
  });

  describe('GET /api/alerts/events/:id', () => {
    it('should return event by ID', async () => {
      const ctx = createMockContext(['alerts:read']);
      vi.mocked(storage.getAlertEvent).mockReturnValue(mockAlertEvent);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).get('/api/alerts/events/event-123');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('event-123');
    });

    it('should return 404 for non-existent event', async () => {
      const ctx = createMockContext(['alerts:read']);
      vi.mocked(storage.getAlertEvent).mockReturnValue(null);

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).get('/api/alerts/events/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Alert event not found');
    });
  });

  describe('POST /api/alerts/events/:id/acknowledge', () => {
    it('should acknowledge event', async () => {
      const ctx = createMockContext(['alerts:update']);
      vi.mocked(storage.acknowledgeAlertEvent).mockReturnValue({
        ...mockAlertEvent,
        acknowledgedAt: '2024-01-01T01:00:00Z',
        acknowledgedBy: 'test-user'
      });

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).post('/api/alerts/events/event-123/acknowledge');

      expect(response.status).toBe(200);
      expect(response.body.acknowledgedAt).toBeDefined();
      expect(logAuditEvent).toHaveBeenCalledWith(
        ctx.user,
        'alert:acknowledge',
        expect.objectContaining({ resourceId: 'event-123' })
      );
    });

    it('should return 404 if event not found or already acknowledged', async () => {
      const ctx = createMockContext(['alerts:update']);
      vi.mocked(storage.acknowledgeAlertEvent).mockReturnValue(null);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).post('/api/alerts/events/event-123/acknowledge');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Alert event not found or already acknowledged');
    });
  });

  describe('POST /api/alerts/events/acknowledge-all', () => {
    it('should acknowledge all events', async () => {
      const ctx = createMockContext(['alerts:update']);
      vi.mocked(storage.acknowledgeAllEvents).mockReturnValue(10);

      app = express();
      app.use(express.json());
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).post('/api/alerts/events/acknowledge-all');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(10);
      expect(logAuditEvent).toHaveBeenCalledWith(
        ctx.user,
        'alert:acknowledge_all',
        expect.objectContaining({ details: { count: 10 } })
      );
    });
  });

  // ==========================================================================
  // Alert Service Status
  // ==========================================================================

  describe('GET /api/alerts/status', () => {
    it('should return evaluator status', async () => {
      const ctx = createMockContext(['alerts:list']);
      vi.mocked(evaluator.getAlertEvaluatorStatus).mockReturnValue({
        running: true,
        pollInterval: 30000,
        trackedContainers: 5
      });

      app = express();
      app.use(injectContext(ctx));
      app.use('/api/alerts', alertsRouter);

      const response = await request(app).get('/api/alerts/status');

      expect(response.status).toBe(200);
      expect(response.body.running).toBe(true);
      expect(response.body.pollInterval).toBe(30000);
      expect(response.body.trackedContainers).toBe(5);
    });
  });
});
