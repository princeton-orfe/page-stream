import { Router, Request, Response, NextFunction } from 'express';
import { requireCapability } from '../auth/index.js';
import { logAuditEvent } from '../db/audit.js';
import {
  createAlertRule,
  getAlertRule,
  listAlertRules,
  updateAlertRule,
  deleteAlertRule,
  getAlertRulesForTarget,
  listAlertEvents,
  getAlertEvent,
  acknowledgeAlertEvent,
  acknowledgeAllEvents,
  getUnacknowledgedEventCount,
  getActiveEvents
} from '../alerts/storage.js';
import {
  validateAlertRuleCreate,
  validateAlertRuleUpdate,
  AlertValidationError
} from '../alerts/schema.js';
import {
  getAlertEvaluatorStatus,
  startAlertEvaluator,
  stopAlertEvaluator
} from '../alerts/evaluator.js';
import { testNotificationChannel } from '../alerts/notifications.js';

const router = Router();

// Async handler wrapper for cleaner error handling
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ============================================================================
// Alert Rules CRUD
// ============================================================================

/**
 * GET /api/alerts/rules
 * List all alert rules with optional filters
 */
router.get('/rules', requireCapability('alerts:list'), asyncHandler(async (req, res) => {
  const enabled = req.query.enabled === undefined
    ? undefined
    : req.query.enabled === 'true';
  const targetType = req.query.targetType as string | undefined;
  const targetId = req.query.targetId as string | undefined;
  const severity = req.query.severity as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
  const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;

  const result = listAlertRules({
    enabled,
    targetType: targetType as 'stream' | 'group' | 'compositor' | 'any' | undefined,
    targetId,
    severity: severity as 'info' | 'warning' | 'critical' | undefined,
    limit,
    offset
  });

  res.json(result);
}));

/**
 * GET /api/alerts/rules/by-target/:targetType/:targetId
 * Get all alert rules for a specific target
 */
router.get('/rules/by-target/:targetType/:targetId', requireCapability('alerts:list'), asyncHandler(async (req, res) => {
  const { targetType, targetId } = req.params;

  if (!['stream', 'group', 'compositor', 'any'].includes(targetType)) {
    res.status(400).json({ error: 'Invalid target type' });
    return;
  }

  const rules = getAlertRulesForTarget(
    targetType as 'stream' | 'group' | 'compositor' | 'any',
    targetId
  );

  res.json({ rules, total: rules.length });
}));

/**
 * GET /api/alerts/rules/:id
 * Get a single alert rule by ID
 */
router.get('/rules/:id', requireCapability('alerts:read'), asyncHandler(async (req, res) => {
  const rule = getAlertRule(req.params.id);

  if (!rule) {
    res.status(404).json({ error: 'Alert rule not found' });
    return;
  }

  res.json(rule);
}));

/**
 * POST /api/alerts/rules
 * Create a new alert rule
 */
router.post('/rules', requireCapability('alerts:create'), asyncHandler(async (req, res) => {
  try {
    const validated = validateAlertRuleCreate(req.body);
    const rule = createAlertRule(validated, req.ctx.user);

    logAuditEvent(req.ctx.user, 'alert:create', {
      resourceType: 'alert_rule',
      resourceId: rule.id,
      details: {
        name: rule.name,
        targetType: rule.targetType,
        targetId: rule.targetId,
        condition: rule.condition.type,
        severity: rule.severity
      }
    });

    res.status(201).json(rule);
  } catch (error) {
    if (error instanceof AlertValidationError) {
      res.status(400).json({
        error: 'Validation error',
        message: error.message,
        field: error.field
      });
      return;
    }
    throw error;
  }
}));

/**
 * PUT /api/alerts/rules/:id
 * Update an existing alert rule
 */
router.put('/rules/:id', requireCapability('alerts:update'), asyncHandler(async (req, res) => {
  try {
    const validated = validateAlertRuleUpdate(req.body);
    const rule = updateAlertRule(req.params.id, validated, req.ctx.user);

    logAuditEvent(req.ctx.user, 'alert:update', {
      resourceType: 'alert_rule',
      resourceId: rule.id,
      details: {
        name: rule.name,
        changes: Object.keys(validated)
      }
    });

    res.json(rule);
  } catch (error) {
    if (error instanceof AlertValidationError) {
      if (error.field === 'id') {
        res.status(404).json({ error: 'Alert rule not found' });
        return;
      }
      res.status(400).json({
        error: 'Validation error',
        message: error.message,
        field: error.field
      });
      return;
    }
    throw error;
  }
}));

/**
 * DELETE /api/alerts/rules/:id
 * Delete an alert rule
 */
router.delete('/rules/:id', requireCapability('alerts:delete'), asyncHandler(async (req, res) => {
  const rule = getAlertRule(req.params.id);

  if (!rule) {
    res.status(404).json({ error: 'Alert rule not found' });
    return;
  }

  const deleted = deleteAlertRule(req.params.id);

  if (deleted) {
    logAuditEvent(req.ctx.user, 'alert:delete', {
      resourceType: 'alert_rule',
      resourceId: req.params.id,
      details: {
        name: rule.name,
        targetType: rule.targetType,
        targetId: rule.targetId
      }
    });

    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Alert rule not found' });
  }
}));

/**
 * POST /api/alerts/rules/:id/enable
 * Enable an alert rule
 */
router.post('/rules/:id/enable', requireCapability('alerts:update'), asyncHandler(async (req, res) => {
  try {
    const rule = updateAlertRule(req.params.id, { enabled: true }, req.ctx.user);

    logAuditEvent(req.ctx.user, 'alert:enable', {
      resourceType: 'alert_rule',
      resourceId: rule.id,
      details: { name: rule.name }
    });

    res.json(rule);
  } catch (error) {
    if (error instanceof AlertValidationError && error.field === 'id') {
      res.status(404).json({ error: 'Alert rule not found' });
      return;
    }
    throw error;
  }
}));

/**
 * POST /api/alerts/rules/:id/disable
 * Disable an alert rule
 */
router.post('/rules/:id/disable', requireCapability('alerts:update'), asyncHandler(async (req, res) => {
  try {
    const rule = updateAlertRule(req.params.id, { enabled: false }, req.ctx.user);

    logAuditEvent(req.ctx.user, 'alert:disable', {
      resourceType: 'alert_rule',
      resourceId: rule.id,
      details: { name: rule.name }
    });

    res.json(rule);
  } catch (error) {
    if (error instanceof AlertValidationError && error.field === 'id') {
      res.status(404).json({ error: 'Alert rule not found' });
      return;
    }
    throw error;
  }
}));

/**
 * POST /api/alerts/rules/:id/test
 * Test notifications for an alert rule
 */
router.post('/rules/:id/test', requireCapability('alerts:update'), asyncHandler(async (req, res) => {
  const rule = getAlertRule(req.params.id);

  if (!rule) {
    res.status(404).json({ error: 'Alert rule not found' });
    return;
  }

  if (rule.notifications.length === 0) {
    res.status(400).json({ error: 'Alert rule has no notification channels configured' });
    return;
  }

  const results = await Promise.all(
    rule.notifications.map(channel => testNotificationChannel(channel))
  );

  const allSuccess = results.every(r => r.success);

  res.json({
    success: allSuccess,
    results: results.map((r, i) => ({
      channel: rule.notifications[i].type,
      ...r
    }))
  });
}));

// ============================================================================
// Alert Events
// ============================================================================

/**
 * GET /api/alerts/events
 * List alert events with optional filters
 */
router.get('/events', requireCapability('alerts:list'), asyncHandler(async (req, res) => {
  const ruleId = req.query.ruleId as string | undefined;
  const targetType = req.query.targetType as string | undefined;
  const targetId = req.query.targetId as string | undefined;
  const severity = req.query.severity as string | undefined;
  const acknowledged = req.query.acknowledged === undefined
    ? undefined
    : req.query.acknowledged === 'true';
  const resolved = req.query.resolved === undefined
    ? undefined
    : req.query.resolved === 'true';
  const since = req.query.since as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
  const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;

  const result = listAlertEvents({
    ruleId,
    targetType: targetType as 'stream' | 'group' | 'compositor' | 'any' | undefined,
    targetId,
    severity: severity as 'info' | 'warning' | 'critical' | undefined,
    acknowledged,
    resolved,
    since,
    limit,
    offset
  });

  res.json(result);
}));

/**
 * GET /api/alerts/events/active
 * Get all active (unresolved) events
 */
router.get('/events/active', requireCapability('alerts:list'), asyncHandler(async (_req, res) => {
  const events = getActiveEvents();
  res.json({ events, total: events.length });
}));

/**
 * GET /api/alerts/events/count
 * Get count of unacknowledged events
 */
router.get('/events/count', requireCapability('alerts:list'), asyncHandler(async (_req, res) => {
  const count = getUnacknowledgedEventCount();
  res.json({ count });
}));

/**
 * GET /api/alerts/events/:id
 * Get a single alert event by ID
 */
router.get('/events/:id', requireCapability('alerts:read'), asyncHandler(async (req, res) => {
  const event = getAlertEvent(req.params.id);

  if (!event) {
    res.status(404).json({ error: 'Alert event not found' });
    return;
  }

  res.json(event);
}));

/**
 * POST /api/alerts/events/:id/acknowledge
 * Acknowledge an alert event
 */
router.post('/events/:id/acknowledge', requireCapability('alerts:update'), asyncHandler(async (req, res) => {
  const event = acknowledgeAlertEvent(req.params.id, req.ctx.user);

  if (!event) {
    res.status(404).json({ error: 'Alert event not found or already acknowledged' });
    return;
  }

  logAuditEvent(req.ctx.user, 'alert:acknowledge', {
    resourceType: 'alert_event',
    resourceId: event.id,
    details: {
      ruleName: event.ruleName,
      targetName: event.targetName
    }
  });

  res.json(event);
}));

/**
 * POST /api/alerts/events/acknowledge-all
 * Acknowledge all unacknowledged events
 */
router.post('/events/acknowledge-all', requireCapability('alerts:update'), asyncHandler(async (req, res) => {
  const count = acknowledgeAllEvents(req.ctx.user);

  logAuditEvent(req.ctx.user, 'alert:acknowledge_all', {
    resourceType: 'alert_event',
    details: { count }
  });

  res.json({ success: true, count });
}));

// ============================================================================
// Alert Service Status
// ============================================================================

/**
 * GET /api/alerts/status
 * Get alert evaluator service status
 */
router.get('/status', requireCapability('alerts:list'), asyncHandler(async (_req, res) => {
  res.json(getAlertEvaluatorStatus());
}));

export default router;
