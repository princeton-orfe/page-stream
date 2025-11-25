import { Router, Request, Response, NextFunction } from 'express';
import { requireCapability } from '../auth/index.js';
import {
  listStreamContainers,
  getContainer,
  getRecentLogs,
  startContainer,
  stopContainer,
  restartContainer,
  refreshContainer
} from '../docker.js';
import { getLatestHealth, extractHealthHistory } from '../health-parser.js';
import { logAuditEvent } from '../db/audit.js';

// Rate limiting: track last action time per container
const lastActionTime = new Map<string, number>();
const RATE_LIMIT_MS = 5000; // 5 seconds between actions per container

function checkRateLimit(containerId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const lastTime = lastActionTime.get(containerId);

  if (lastTime && now - lastTime < RATE_LIMIT_MS) {
    const retryAfter = Math.ceil((RATE_LIMIT_MS - (now - lastTime)) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

function recordAction(containerId: string): void {
  lastActionTime.set(containerId, Date.now());
}

// Exported for testing
export function clearRateLimits(): void {
  lastActionTime.clear();
}

// Callback for WebSocket broadcast (set by server setup)
let broadcastStatusChange: ((containerId: string) => void) | null = null;

export function setBroadcastCallback(callback: (containerId: string) => void): void {
  broadcastStatusChange = callback;
}

const router = Router();

// Async handler wrapper for cleaner error handling
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// GET /api/streams - List all streams
router.get(
  '/',
  requireCapability('streams:list'),
  asyncHandler(async (req, res) => {
    const streams = await listStreamContainers();
    res.json({ streams, timestamp: new Date().toISOString() });
  })
);

// GET /api/streams/:id - Get stream details
router.get(
  '/:id',
  requireCapability('streams:read'),
  asyncHandler(async (req, res) => {
    const stream = await getContainer(req.params.id);
    if (!stream) {
      res.status(404).json({ error: 'Stream not found' });
      return;
    }

    const logs = await getRecentLogs(req.params.id, 100);
    const health = getLatestHealth(logs);

    res.json({ stream, health, recentLogs: logs });
  })
);

// GET /api/streams/:id/logs
router.get(
  '/:id/logs',
  requireCapability('streams:logs'),
  asyncHandler(async (req, res) => {
    // First check if container exists
    const stream = await getContainer(req.params.id);
    if (!stream) {
      res.status(404).json({ error: 'Stream not found' });
      return;
    }

    const lines = parseInt(req.query.lines as string) || 100;
    const logs = await getRecentLogs(req.params.id, lines);
    res.json({ logs, hasMore: logs.length === lines });
  })
);

// GET /api/streams/:id/health/history
router.get(
  '/:id/health/history',
  requireCapability('streams:health'),
  asyncHandler(async (req, res) => {
    // First check if container exists
    const stream = await getContainer(req.params.id);
    if (!stream) {
      res.status(404).json({ error: 'Stream not found' });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 50;
    const logs = await getRecentLogs(req.params.id, 500);
    const history = extractHealthHistory(logs).slice(0, limit);
    res.json({ history, latest: history[history.length - 1] || null });
  })
);

// ============================================================================
// Control Routes (Phase 2)
// ============================================================================

// POST /api/streams/:id/start - Start a stopped container
router.post(
  '/:id/start',
  requireCapability('streams:start'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Check rate limit
    const rateCheck = checkRateLimit(id);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error: 'Rate limited',
        message: `Too many actions on this container. Try again in ${rateCheck.retryAfter} seconds.`,
        retryAfter: rateCheck.retryAfter
      });
      return;
    }

    // Check container exists
    const stream = await getContainer(id);
    if (!stream) {
      res.status(404).json({ error: 'Stream not found' });
      return;
    }

    // Check container state
    if (stream.status === 'running') {
      res.status(400).json({ error: 'Container is already running' });
      return;
    }

    // Perform action
    try {
      await startContainer(id);
      recordAction(id);

      // Audit log
      logAuditEvent(req.ctx.user, 'stream:start', {
        resourceType: 'stream',
        resourceId: id,
        details: { streamName: stream.name }
      });

      // Broadcast status change
      if (broadcastStatusChange) {
        broadcastStatusChange(id);
      }

      res.json({ success: true, message: 'Container started' });
    } catch (error) {
      logAuditEvent(req.ctx.user, 'stream:start', {
        resourceType: 'stream',
        resourceId: id,
        details: { streamName: stream.name },
        result: 'failure',
        error: (error as Error).message
      });
      throw error;
    }
  })
);

// POST /api/streams/:id/stop - Stop a running container
router.post(
  '/:id/stop',
  requireCapability('streams:stop'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const timeout = typeof req.body?.timeout === 'number' ? req.body.timeout : undefined;

    // Check rate limit
    const rateCheck = checkRateLimit(id);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error: 'Rate limited',
        message: `Too many actions on this container. Try again in ${rateCheck.retryAfter} seconds.`,
        retryAfter: rateCheck.retryAfter
      });
      return;
    }

    // Check container exists
    const stream = await getContainer(id);
    if (!stream) {
      res.status(404).json({ error: 'Stream not found' });
      return;
    }

    // Check container state
    if (stream.status !== 'running') {
      res.status(400).json({ error: 'Container is not running' });
      return;
    }

    // Perform action
    try {
      await stopContainer(id, timeout);
      recordAction(id);

      // Audit log
      logAuditEvent(req.ctx.user, 'stream:stop', {
        resourceType: 'stream',
        resourceId: id,
        details: { streamName: stream.name, timeout }
      });

      // Broadcast status change
      if (broadcastStatusChange) {
        broadcastStatusChange(id);
      }

      res.json({ success: true, message: 'Container stopped' });
    } catch (error) {
      logAuditEvent(req.ctx.user, 'stream:stop', {
        resourceType: 'stream',
        resourceId: id,
        details: { streamName: stream.name, timeout },
        result: 'failure',
        error: (error as Error).message
      });
      throw error;
    }
  })
);

// POST /api/streams/:id/restart - Restart a container
router.post(
  '/:id/restart',
  requireCapability('streams:restart'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const timeout = typeof req.body?.timeout === 'number' ? req.body.timeout : undefined;

    // Check rate limit
    const rateCheck = checkRateLimit(id);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error: 'Rate limited',
        message: `Too many actions on this container. Try again in ${rateCheck.retryAfter} seconds.`,
        retryAfter: rateCheck.retryAfter
      });
      return;
    }

    // Check container exists
    const stream = await getContainer(id);
    if (!stream) {
      res.status(404).json({ error: 'Stream not found' });
      return;
    }

    // Perform action
    try {
      await restartContainer(id, timeout);
      recordAction(id);

      // Audit log
      logAuditEvent(req.ctx.user, 'stream:restart', {
        resourceType: 'stream',
        resourceId: id,
        details: { streamName: stream.name, timeout }
      });

      // Broadcast status change
      if (broadcastStatusChange) {
        broadcastStatusChange(id);
      }

      res.json({ success: true, message: 'Container restarted' });
    } catch (error) {
      logAuditEvent(req.ctx.user, 'stream:restart', {
        resourceType: 'stream',
        resourceId: id,
        details: { streamName: stream.name, timeout },
        result: 'failure',
        error: (error as Error).message
      });
      throw error;
    }
  })
);

// POST /api/streams/:id/refresh - Refresh (reload config) a running container
router.post(
  '/:id/refresh',
  requireCapability('streams:refresh'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Check rate limit
    const rateCheck = checkRateLimit(id);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error: 'Rate limited',
        message: `Too many actions on this container. Try again in ${rateCheck.retryAfter} seconds.`,
        retryAfter: rateCheck.retryAfter
      });
      return;
    }

    // Check container exists
    const stream = await getContainer(id);
    if (!stream) {
      res.status(404).json({ error: 'Stream not found' });
      return;
    }

    // Check container state (must be running)
    if (stream.status !== 'running') {
      res.status(400).json({ error: 'Container must be running to refresh' });
      return;
    }

    // Perform action
    try {
      const result = await refreshContainer(id);
      recordAction(id);

      // Audit log
      logAuditEvent(req.ctx.user, 'stream:refresh', {
        resourceType: 'stream',
        resourceId: id,
        details: { streamName: stream.name, method: result.method }
      });

      // Broadcast status change (refresh might change health status)
      if (broadcastStatusChange) {
        broadcastStatusChange(id);
      }

      res.json({
        success: result.success,
        message: result.success
          ? `Container refreshed via ${result.method}`
          : 'Refresh failed',
        method: result.method
      });
    } catch (error) {
      logAuditEvent(req.ctx.user, 'stream:refresh', {
        resourceType: 'stream',
        resourceId: id,
        details: { streamName: stream.name },
        result: 'failure',
        error: (error as Error).message
      });
      throw error;
    }
  })
);

export default router;
