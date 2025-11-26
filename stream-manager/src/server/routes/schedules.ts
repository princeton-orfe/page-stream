import { Router, Request, Response, NextFunction } from 'express';
import { requireCapability } from '../auth/index.js';
import { logAuditEvent } from '../db/audit.js';
import {
  createSchedule,
  getSchedule,
  listSchedules,
  updateSchedule,
  deleteSchedule,
  getSchedulesForTarget,
  duplicateSchedule
} from '../schedules/storage.js';
import {
  validateScheduleCreate,
  validateScheduleUpdate,
  ScheduleValidationError,
  getCommonTimezones,
  calculateNextRun
} from '../schedules/schema.js';
import {
  triggerSchedule,
  getSchedulerStatus
} from '../schedules/scheduler.js';

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
// CRUD Endpoints
// ============================================================================

/**
 * GET /api/schedules
 * List all schedules with optional filters
 */
router.get('/', requireCapability('schedules:list'), asyncHandler(async (req, res) => {
  const enabled = req.query.enabled === undefined
    ? undefined
    : req.query.enabled === 'true';
  const targetType = req.query.targetType as string | undefined;
  const targetId = req.query.targetId as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
  const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;

  const result = listSchedules({
    enabled,
    targetType: targetType as 'stream' | 'group' | 'compositor' | undefined,
    targetId,
    limit,
    offset
  });

  res.json(result);
}));

/**
 * GET /api/schedules/timezones
 * Get list of common timezones for UI selection
 */
router.get('/timezones', requireCapability('schedules:list'), asyncHandler(async (_req, res) => {
  res.json({ timezones: getCommonTimezones() });
}));

/**
 * GET /api/schedules/status
 * Get scheduler service status
 */
router.get('/status', requireCapability('schedules:list'), asyncHandler(async (_req, res) => {
  res.json(getSchedulerStatus());
}));

/**
 * GET /api/schedules/by-target/:targetType/:targetId
 * Get all schedules for a specific target
 */
router.get('/by-target/:targetType/:targetId', requireCapability('schedules:list'), asyncHandler(async (req, res) => {
  const { targetType, targetId } = req.params;

  if (!['stream', 'group', 'compositor'].includes(targetType)) {
    res.status(400).json({ error: 'Invalid target type' });
    return;
  }

  const schedules = getSchedulesForTarget(
    targetType as 'stream' | 'group' | 'compositor',
    targetId
  );

  res.json({ schedules, total: schedules.length });
}));

/**
 * GET /api/schedules/:id
 * Get a single schedule by ID
 */
router.get('/:id', requireCapability('schedules:read'), asyncHandler(async (req, res) => {
  const schedule = getSchedule(req.params.id);

  if (!schedule) {
    res.status(404).json({ error: 'Schedule not found' });
    return;
  }

  res.json(schedule);
}));

/**
 * POST /api/schedules
 * Create a new schedule
 */
router.post('/', requireCapability('schedules:create'), asyncHandler(async (req, res) => {
  try {
    const validated = validateScheduleCreate(req.body);
    const schedule = createSchedule(validated, req.ctx.user);

    logAuditEvent(req.ctx.user, 'schedule:create', {
      resourceType: 'schedule',
      resourceId: schedule.id,
      details: {
        name: schedule.name,
        targetType: schedule.targetType,
        targetId: schedule.targetId,
        action: schedule.action,
        cronExpression: schedule.cronExpression,
        timezone: schedule.timezone
      }
    });

    res.status(201).json(schedule);
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
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
 * PUT /api/schedules/:id
 * Update an existing schedule
 */
router.put('/:id', requireCapability('schedules:update'), asyncHandler(async (req, res) => {
  try {
    const validated = validateScheduleUpdate(req.body);
    const schedule = updateSchedule(req.params.id, validated, req.ctx.user);

    logAuditEvent(req.ctx.user, 'schedule:update', {
      resourceType: 'schedule',
      resourceId: schedule.id,
      details: {
        name: schedule.name,
        changes: Object.keys(validated)
      }
    });

    res.json(schedule);
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
      if (error.field === 'id') {
        res.status(404).json({ error: 'Schedule not found' });
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
 * DELETE /api/schedules/:id
 * Delete a schedule
 */
router.delete('/:id', requireCapability('schedules:delete'), asyncHandler(async (req, res) => {
  const schedule = getSchedule(req.params.id);

  if (!schedule) {
    res.status(404).json({ error: 'Schedule not found' });
    return;
  }

  const deleted = deleteSchedule(req.params.id);

  if (deleted) {
    logAuditEvent(req.ctx.user, 'schedule:delete', {
      resourceType: 'schedule',
      resourceId: req.params.id,
      details: {
        name: schedule.name,
        targetType: schedule.targetType,
        targetId: schedule.targetId
      }
    });

    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Schedule not found' });
  }
}));

/**
 * POST /api/schedules/:id/duplicate
 * Duplicate a schedule with a new name
 */
router.post('/:id/duplicate', requireCapability('schedules:create'), asyncHandler(async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'New name is required' });
      return;
    }

    const schedule = duplicateSchedule(req.params.id, name.trim(), req.ctx.user);

    logAuditEvent(req.ctx.user, 'schedule:duplicate', {
      resourceType: 'schedule',
      resourceId: schedule.id,
      details: {
        sourceId: req.params.id,
        name: schedule.name
      }
    });

    res.status(201).json(schedule);
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
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

// ============================================================================
// Control Endpoints
// ============================================================================

/**
 * POST /api/schedules/:id/trigger
 * Manually trigger a schedule execution
 * Requires schedules:update capability (not just read)
 */
router.post('/:id/trigger', requireCapability('schedules:update'), asyncHandler(async (req, res) => {
  const result = await triggerSchedule(req.params.id, req.ctx.user);

  if (!result.success && result.error === 'Schedule not found') {
    res.status(404).json({ error: 'Schedule not found' });
    return;
  }

  if (!result.success) {
    res.status(500).json({
      success: false,
      error: result.error
    });
    return;
  }

  res.json({ success: true, message: 'Schedule triggered successfully' });
}));

/**
 * POST /api/schedules/:id/enable
 * Enable a schedule
 */
router.post('/:id/enable', requireCapability('schedules:update'), asyncHandler(async (req, res) => {
  try {
    const schedule = updateSchedule(req.params.id, { enabled: true }, req.ctx.user);

    logAuditEvent(req.ctx.user, 'schedule:enable', {
      resourceType: 'schedule',
      resourceId: schedule.id,
      details: { name: schedule.name }
    });

    res.json(schedule);
  } catch (error) {
    if (error instanceof ScheduleValidationError && error.field === 'id') {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }
    throw error;
  }
}));

/**
 * POST /api/schedules/:id/disable
 * Disable a schedule
 */
router.post('/:id/disable', requireCapability('schedules:update'), asyncHandler(async (req, res) => {
  try {
    const schedule = updateSchedule(req.params.id, { enabled: false }, req.ctx.user);

    logAuditEvent(req.ctx.user, 'schedule:disable', {
      resourceType: 'schedule',
      resourceId: schedule.id,
      details: { name: schedule.name }
    });

    res.json(schedule);
  } catch (error) {
    if (error instanceof ScheduleValidationError && error.field === 'id') {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }
    throw error;
  }
}));

/**
 * POST /api/schedules/preview-next-run
 * Preview the next run time for a cron expression (without creating a schedule)
 */
router.post('/preview-next-run', requireCapability('schedules:list'), asyncHandler(async (req, res) => {
  const { cronExpression, timezone = 'UTC' } = req.body;

  if (!cronExpression || typeof cronExpression !== 'string') {
    res.status(400).json({ error: 'cronExpression is required' });
    return;
  }

  try {
    const nextRun = calculateNextRun(cronExpression, timezone);
    res.json({ nextRun, cronExpression, timezone });
  } catch (error) {
    res.status(400).json({
      error: 'Invalid cron expression',
      message: (error as Error).message
    });
  }
}));

export default router;
