import { Router, Request, Response, NextFunction } from 'express';
import { requireCapability } from '../auth/index.js';
import {
  listStreamContainers,
  getContainer,
  getContainerByName,
  getRecentLogs,
  startContainer,
  stopContainer,
  restartContainer,
  refreshContainer,
  createAndStartContainer,
  removeContainer
} from '../docker.js';
import { getLatestHealth, extractHealthHistory } from '../health-parser.js';
import { logAuditEvent } from '../db/audit.js';
import {
  createStreamConfig,
  getStreamConfig,
  getStreamConfigByName,
  listStreamConfigs,
  updateStreamConfig,
  deleteStreamConfig
} from '../config/storage.js';
import {
  validateStreamConfig,
  validatePartialStreamConfig,
  StreamConfigValidationError
} from '../config/schema.js';
import {
  generateContainerConfig,
  validateContainerConfig
} from '../docker-generator.js';

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

// GET /api/streams - List all streams (containers)
router.get(
  '/',
  requireCapability('streams:list'),
  asyncHandler(async (req, res) => {
    const streams = await listStreamContainers();
    res.json({ streams, timestamp: new Date().toISOString() });
  })
);

// GET /api/streams/configs - List all stream configurations (database)
// Note: This route must come before /:id to avoid matching "configs" as an ID
router.get(
  '/configs',
  requireCapability('streams:list'),
  asyncHandler(async (req, res) => {
    const type = req.query.type as string | undefined;
    const enabled = req.query.enabled !== undefined
      ? req.query.enabled === 'true'
      : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;

    const result = listStreamConfigs({ type: type as 'standard' | 'compositor-source' | 'compositor' | undefined, enabled, limit, offset });
    res.json(result);
  })
);

// GET /api/streams/configs/:id - Get a stream configuration by ID
router.get(
  '/configs/:id',
  requireCapability('streams:read'),
  asyncHandler(async (req, res) => {
    const config = getStreamConfig(req.params.id);
    if (!config) {
      res.status(404).json({ error: 'Stream configuration not found' });
      return;
    }
    res.json({ config });
  })
);

// GET /api/streams/:id - Get stream details (container)
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

// ============================================================================
// CRUD Routes (Phase 3) - Create, Update, Delete operations
// Note: GET routes for /configs are defined above (before /:id routes)
// ============================================================================

// POST /api/streams - Create new stream (and optionally start it)
router.post(
  '/',
  requireCapability('streams:create'),
  asyncHandler(async (req, res) => {
    // Validate input
    let validatedConfig;
    try {
      validatedConfig = validateStreamConfig(req.body);
    } catch (error) {
      if (error instanceof StreamConfigValidationError) {
        res.status(400).json({
          error: 'Validation error',
          field: error.field,
          message: error.message
        });
        return;
      }
      throw error;
    }

    // Create the stream configuration in database
    let stream;
    try {
      stream = createStreamConfig(validatedConfig, req.ctx.user);
    } catch (error) {
      if (error instanceof StreamConfigValidationError) {
        res.status(409).json({
          error: 'Conflict',
          field: error.field,
          message: error.message
        });
        return;
      }
      throw error;
    }

    // Audit log
    logAuditEvent(req.ctx.user, 'stream:create', {
      resourceType: 'stream',
      resourceId: stream.id,
      details: { name: stream.name, ingest: stream.ingest }
    });

    // Optionally start container if enabled
    let containerId: string | undefined;
    if (stream.enabled) {
      try {
        const containerConfig = generateContainerConfig(stream);
        validateContainerConfig(containerConfig);
        containerId = await createAndStartContainer(containerConfig);

        logAuditEvent(req.ctx.user, 'stream:start', {
          resourceType: 'stream',
          resourceId: stream.id,
          details: { name: stream.name, containerId, autoStarted: true }
        });
      } catch (error) {
        // Log the failure but still return success for config creation
        logAuditEvent(req.ctx.user, 'stream:start', {
          resourceType: 'stream',
          resourceId: stream.id,
          details: { name: stream.name, autoStarted: true },
          result: 'failure',
          error: (error as Error).message
        });
        // Return partial success
        res.status(201).json({
          stream,
          containerId: undefined,
          warning: `Stream configuration created but container failed to start: ${(error as Error).message}`
        });
        return;
      }
    }

    // Broadcast status change
    if (broadcastStatusChange && containerId) {
      broadcastStatusChange(containerId);
    }

    res.status(201).json({ stream, containerId });
  })
);

// PUT /api/streams/:id - Update stream configuration
router.put(
  '/:id',
  requireCapability('streams:update'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Check if this is a config ID or container ID
    let config = getStreamConfig(id);
    if (!config) {
      res.status(404).json({ error: 'Stream configuration not found' });
      return;
    }

    // Validate updates
    let validatedUpdates;
    try {
      validatedUpdates = validatePartialStreamConfig(req.body);
    } catch (error) {
      if (error instanceof StreamConfigValidationError) {
        res.status(400).json({
          error: 'Validation error',
          field: error.field,
          message: error.message
        });
        return;
      }
      throw error;
    }

    // Update the configuration
    try {
      config = updateStreamConfig(id, validatedUpdates, req.ctx.user);
    } catch (error) {
      if (error instanceof StreamConfigValidationError) {
        res.status(409).json({
          error: 'Conflict',
          field: error.field,
          message: error.message
        });
        return;
      }
      throw error;
    }

    // Audit log
    logAuditEvent(req.ctx.user, 'stream:update', {
      resourceType: 'stream',
      resourceId: config.id,
      details: { changes: Object.keys(validatedUpdates) }
    });

    res.json({ stream: config, restarted: false });
  })
);

// DELETE /api/streams/:id - Delete stream (stops container if running)
router.delete(
  '/:id',
  requireCapability('streams:delete'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Get the configuration
    const config = getStreamConfig(id);
    if (!config) {
      res.status(404).json({ error: 'Stream configuration not found' });
      return;
    }

    // Try to stop and remove container if it exists
    const container = await getContainerByName(config.name);
    if (container) {
      try {
        await removeContainer(container.id, true);

        logAuditEvent(req.ctx.user, 'stream:stop', {
          resourceType: 'stream',
          resourceId: id,
          details: { name: config.name, containerId: container.id, reason: 'deleted' }
        });
      } catch (error) {
        // Log but continue with deletion
        logAuditEvent(req.ctx.user, 'stream:stop', {
          resourceType: 'stream',
          resourceId: id,
          details: { name: config.name, containerId: container.id, reason: 'deleted' },
          result: 'failure',
          error: (error as Error).message
        });
      }
    }

    // Delete the configuration
    deleteStreamConfig(id);

    // Audit log
    logAuditEvent(req.ctx.user, 'stream:delete', {
      resourceType: 'stream',
      resourceId: id,
      details: { name: config.name }
    });

    // Broadcast status change if container existed
    if (broadcastStatusChange && container) {
      broadcastStatusChange(container.id);
    }

    res.json({ success: true });
  })
);

// POST /api/streams/:id/deploy - Deploy a stream configuration (create/recreate container)
router.post(
  '/:id/deploy',
  requireCapability('streams:create'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Get the configuration
    const config = getStreamConfig(id);
    if (!config) {
      res.status(404).json({ error: 'Stream configuration not found' });
      return;
    }

    // Check if container already exists
    const existingContainer = await getContainerByName(config.name);
    if (existingContainer) {
      // Remove existing container first
      try {
        await removeContainer(existingContainer.id, true);
      } catch (error) {
        res.status(500).json({
          error: 'Failed to remove existing container',
          message: (error as Error).message
        });
        return;
      }
    }

    // Generate and create new container
    try {
      const containerConfig = generateContainerConfig(config);
      validateContainerConfig(containerConfig);
      const containerId = await createAndStartContainer(containerConfig);

      logAuditEvent(req.ctx.user, 'stream:deploy', {
        resourceType: 'stream',
        resourceId: id,
        details: { name: config.name, containerId, redeployed: !!existingContainer }
      });

      // Broadcast status change
      if (broadcastStatusChange) {
        broadcastStatusChange(containerId);
      }

      res.json({ success: true, containerId, redeployed: !!existingContainer });
    } catch (error) {
      logAuditEvent(req.ctx.user, 'stream:deploy', {
        resourceType: 'stream',
        resourceId: id,
        details: { name: config.name, redeployed: !!existingContainer },
        result: 'failure',
        error: (error as Error).message
      });

      res.status(500).json({
        error: 'Failed to create container',
        message: (error as Error).message
      });
    }
  })
);

export default router;
