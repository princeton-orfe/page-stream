import { Router, Request, Response, NextFunction } from 'express';
import { requireCapability } from '../auth/index.js';
import {
  getDocker,
  getRecentLogs,
  startContainer,
  stopContainer,
  restartContainer
} from '../docker.js';
import { logAuditEvent } from '../db/audit.js';
import {
  createCompositorConfig,
  getCompositorConfig,
  getCompositorConfigByName,
  listCompositorConfigs,
  updateCompositorConfig,
  deleteCompositorConfig
} from '../compositor/storage.js';
import {
  validateCompositorConfig,
  validatePartialCompositorConfig,
  CompositorConfigValidationError,
  CompositorConfig,
  generateFilterComplex
} from '../compositor/schema.js';

// Rate limiting: track last action time per compositor
const lastActionTime = new Map<string, number>();
const RATE_LIMIT_MS = 5000; // 5 seconds between actions per compositor

function checkRateLimit(compositorId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const lastTime = lastActionTime.get(compositorId);

  if (lastTime && now - lastTime < RATE_LIMIT_MS) {
    const retryAfter = Math.ceil((RATE_LIMIT_MS - (now - lastTime)) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

function recordAction(compositorId: string): void {
  lastActionTime.set(compositorId, Date.now());
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

// ============================================================================
// Helper functions for compositor containers
// ============================================================================

const COMPOSITOR_LABEL = 'com.page-stream.compositor';
const FFMPEG_IMAGE = 'jrottenberg/ffmpeg:4.4-ubuntu';

interface CompositorContainer {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'restarting' | 'exited';
  configId?: string;
}

/**
 * List all compositor containers
 */
async function listCompositorContainers(): Promise<CompositorContainer[]> {
  const docker = getDocker();
  const containers = await docker.listContainers({ all: true });

  return containers
    .filter(c => c.Labels?.[COMPOSITOR_LABEL] === 'true')
    .map(c => ({
      id: c.Id,
      name: c.Names[0]?.replace(/^\//, '') || c.Id.slice(0, 12),
      status: normalizeStatus(c.State),
      configId: c.Labels?.['com.page-stream.compositor-id']
    }));
}

/**
 * Get a compositor container by config ID or name
 */
async function getCompositorContainer(nameOrId: string): Promise<CompositorContainer | null> {
  const containers = await listCompositorContainers();
  return containers.find(
    c => c.configId === nameOrId || c.name === nameOrId || c.id === nameOrId
  ) || null;
}

function normalizeStatus(state: string): CompositorContainer['status'] {
  const lowerState = state.toLowerCase();
  if (lowerState === 'running') return 'running';
  if (lowerState === 'restarting') return 'restarting';
  if (lowerState === 'exited' || lowerState === 'dead') return 'exited';
  return 'stopped';
}

/**
 * Generate FFmpeg command for compositor
 */
function generateFfmpegCommand(config: CompositorConfig): string[] {
  const filterComplex = generateFilterComplex(config);

  // Build input arguments
  const inputArgs: string[] = [];
  for (const input of config.inputs) {
    inputArgs.push('-i', `srt://0.0.0.0:${input.listenPort}?mode=listener`);
  }

  // Build output arguments
  const outputArgs = [
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-map', '0:a?', // Map audio from first input (optional)
    '-c:v', 'libx264',
    '-preset', config.preset,
    '-tune', 'zerolatency',
    '-b:v', config.videoBitrate,
    '-maxrate', config.videoBitrate.replace(/k$/i, '').replace(/m$/i, '000') + 'k', // maxrate slightly higher
    '-bufsize', (parseInt(config.videoBitrate.replace(/[kKmM]/g, '')) * 2) + 'k',
    '-g', String(config.outputFps),
    '-keyint_min', String(config.outputFps),
    '-sc_threshold', '0',
    '-c:a', 'aac',
    '-b:a', config.audioBitrate,
    '-ar', '44100',
    '-f', config.format,
    config.outputIngest
  ];

  // Combine all arguments
  const fullArgs = [
    '-hide_banner',
    '-loglevel', 'info',
    ...inputArgs,
    ...outputArgs
  ];

  // Add any extra args
  if (config.extraFfmpegArgs?.length) {
    fullArgs.push(...config.extraFfmpegArgs);
  }

  return fullArgs;
}

/**
 * Create and start a compositor container
 */
async function createAndStartCompositorContainer(config: CompositorConfig): Promise<string> {
  const docker = getDocker();

  // Check if container already exists
  const existing = await getCompositorContainer(config.name);
  if (existing) {
    const error = new Error(`Compositor container "${config.name}" already exists`);
    (error as Error & { statusCode: number }).statusCode = 409;
    throw error;
  }

  const cmd = generateFfmpegCommand(config);

  // Expose ports for inputs
  const exposedPorts: Record<string, Record<string, never>> = {};
  const portBindings: Record<string, Array<{ HostPort: string }>> = {};
  for (const input of config.inputs) {
    const portKey = `${input.listenPort}/udp`;
    exposedPorts[portKey] = {};
    portBindings[portKey] = [{ HostPort: String(input.listenPort) }];
  }

  const container = await docker.createContainer({
    name: config.name,
    Image: FFMPEG_IMAGE,
    Cmd: cmd,
    Labels: {
      [COMPOSITOR_LABEL]: 'true',
      'com.page-stream.compositor-id': config.id,
      'com.page-stream.managed': 'true'
    },
    ExposedPorts: exposedPorts,
    HostConfig: {
      PortBindings: portBindings,
      NetworkMode: 'bridge',
      RestartPolicy: {
        Name: 'on-failure',
        MaximumRetryCount: 5
      }
    }
  });

  await container.start();
  return container.id;
}

/**
 * Remove a compositor container
 */
async function removeCompositorContainer(containerId: string, force: boolean = false): Promise<void> {
  const docker = getDocker();
  const container = docker.getContainer(containerId);

  try {
    const info = await container.inspect();
    if (info.State.Running && !force) {
      await container.stop({ t: 10 });
    }
    await container.remove({ force });
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 404) {
      throw error;
    }
  }
}

// ============================================================================
// API Routes
// ============================================================================

// GET /api/compositors - List all compositor configs
router.get(
  '/',
  requireCapability('compositors:list'),
  asyncHandler(async (req, res) => {
    const enabled = req.query.enabled !== undefined
      ? req.query.enabled === 'true'
      : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;

    const result = listCompositorConfigs({ enabled, limit, offset });

    // Also get container status for each config
    const containers = await listCompositorContainers();
    const containerMap = new Map(containers.map(c => [c.configId, c]));

    const configsWithStatus = result.configs.map(config => ({
      ...config,
      containerStatus: containerMap.get(config.id)?.status || 'stopped',
      containerId: containerMap.get(config.id)?.id
    }));

    res.json({ configs: configsWithStatus, total: result.total });
  })
);

// GET /api/compositors/:id - Get compositor config by ID
router.get(
  '/:id',
  requireCapability('compositors:read'),
  asyncHandler(async (req, res) => {
    const config = getCompositorConfig(req.params.id);
    if (!config) {
      res.status(404).json({ error: 'Compositor not found' });
      return;
    }

    const container = await getCompositorContainer(config.id);
    res.json({
      config,
      containerStatus: container?.status || 'stopped',
      containerId: container?.id
    });
  })
);

// GET /api/compositors/:id/logs - Get compositor logs
router.get(
  '/:id/logs',
  requireCapability('compositors:read'),
  asyncHandler(async (req, res) => {
    const config = getCompositorConfig(req.params.id);
    if (!config) {
      res.status(404).json({ error: 'Compositor not found' });
      return;
    }

    const container = await getCompositorContainer(config.id);
    if (!container) {
      res.status(404).json({ error: 'Compositor container not running' });
      return;
    }

    const lines = parseInt(req.query.lines as string) || 100;
    const logs = await getRecentLogs(container.id, lines);
    res.json({ logs, hasMore: logs.length === lines });
  })
);

// POST /api/compositors - Create new compositor config
router.post(
  '/',
  requireCapability('compositors:create'),
  asyncHandler(async (req, res) => {
    // Validate input
    let validatedConfig;
    try {
      validatedConfig = validateCompositorConfig(req.body);
    } catch (error) {
      if (error instanceof CompositorConfigValidationError) {
        res.status(400).json({
          error: 'Validation error',
          field: error.field,
          message: error.message
        });
        return;
      }
      throw error;
    }

    // Create the compositor configuration in database
    let compositor;
    try {
      compositor = createCompositorConfig(validatedConfig, req.ctx.user);
    } catch (error) {
      if (error instanceof CompositorConfigValidationError) {
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
    logAuditEvent(req.ctx.user, 'compositor:create', {
      resourceType: 'compositor',
      resourceId: compositor.id,
      details: { name: compositor.name, layout: compositor.layout }
    });

    // Optionally start container if enabled
    let containerId: string | undefined;
    if (compositor.enabled) {
      try {
        containerId = await createAndStartCompositorContainer(compositor);

        logAuditEvent(req.ctx.user, 'compositor:start', {
          resourceType: 'compositor',
          resourceId: compositor.id,
          details: { name: compositor.name, containerId, autoStarted: true }
        });
      } catch (error) {
        logAuditEvent(req.ctx.user, 'compositor:start', {
          resourceType: 'compositor',
          resourceId: compositor.id,
          details: { name: compositor.name, autoStarted: true },
          result: 'failure',
          error: (error as Error).message
        });
        res.status(201).json({
          config: compositor,
          containerId: undefined,
          warning: `Compositor config created but container failed to start: ${(error as Error).message}`
        });
        return;
      }
    }

    if (broadcastStatusChange && containerId) {
      broadcastStatusChange(containerId);
    }

    res.status(201).json({ config: compositor, containerId });
  })
);

// PUT /api/compositors/:id - Update compositor config
router.put(
  '/:id',
  requireCapability('compositors:update'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    let config = getCompositorConfig(id);
    if (!config) {
      res.status(404).json({ error: 'Compositor not found' });
      return;
    }

    // Validate updates
    let validatedUpdates;
    try {
      validatedUpdates = validatePartialCompositorConfig(req.body);
    } catch (error) {
      if (error instanceof CompositorConfigValidationError) {
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
      config = updateCompositorConfig(id, validatedUpdates, req.ctx.user);
    } catch (error) {
      if (error instanceof CompositorConfigValidationError) {
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
    logAuditEvent(req.ctx.user, 'compositor:update', {
      resourceType: 'compositor',
      resourceId: config.id,
      details: { changes: Object.keys(validatedUpdates) }
    });

    res.json({ config });
  })
);

// DELETE /api/compositors/:id - Delete compositor config
router.delete(
  '/:id',
  requireCapability('compositors:delete'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const config = getCompositorConfig(id);
    if (!config) {
      res.status(404).json({ error: 'Compositor not found' });
      return;
    }

    // Stop and remove container if running
    const container = await getCompositorContainer(config.id);
    if (container) {
      try {
        await removeCompositorContainer(container.id, true);

        logAuditEvent(req.ctx.user, 'compositor:stop', {
          resourceType: 'compositor',
          resourceId: id,
          details: { name: config.name, containerId: container.id, reason: 'deleted' }
        });
      } catch (error) {
        logAuditEvent(req.ctx.user, 'compositor:stop', {
          resourceType: 'compositor',
          resourceId: id,
          details: { name: config.name, containerId: container.id, reason: 'deleted' },
          result: 'failure',
          error: (error as Error).message
        });
      }
    }

    // Delete the configuration
    deleteCompositorConfig(id);

    // Audit log
    logAuditEvent(req.ctx.user, 'compositor:delete', {
      resourceType: 'compositor',
      resourceId: id,
      details: { name: config.name }
    });

    if (broadcastStatusChange && container) {
      broadcastStatusChange(container.id);
    }

    res.json({ success: true });
  })
);

// ============================================================================
// Control Routes
// ============================================================================

// POST /api/compositors/:id/start - Start a compositor
router.post(
  '/:id/start',
  requireCapability('compositors:control'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Check rate limit
    const rateCheck = checkRateLimit(id);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error: 'Rate limited',
        message: `Too many actions. Try again in ${rateCheck.retryAfter} seconds.`,
        retryAfter: rateCheck.retryAfter
      });
      return;
    }

    const config = getCompositorConfig(id);
    if (!config) {
      res.status(404).json({ error: 'Compositor not found' });
      return;
    }

    // Check if container already exists
    let container = await getCompositorContainer(config.id);
    if (container?.status === 'running') {
      res.status(400).json({ error: 'Compositor is already running' });
      return;
    }

    try {
      let containerId: string;
      if (container) {
        // Container exists but stopped - start it
        await startContainer(container.id);
        containerId = container.id;
      } else {
        // Create new container
        containerId = await createAndStartCompositorContainer(config);
      }

      recordAction(id);

      logAuditEvent(req.ctx.user, 'compositor:start', {
        resourceType: 'compositor',
        resourceId: id,
        details: { name: config.name, containerId }
      });

      if (broadcastStatusChange) {
        broadcastStatusChange(containerId);
      }

      res.json({ success: true, message: 'Compositor started', containerId });
    } catch (error) {
      logAuditEvent(req.ctx.user, 'compositor:start', {
        resourceType: 'compositor',
        resourceId: id,
        details: { name: config.name },
        result: 'failure',
        error: (error as Error).message
      });
      throw error;
    }
  })
);

// POST /api/compositors/:id/stop - Stop a compositor
router.post(
  '/:id/stop',
  requireCapability('compositors:control'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Check rate limit
    const rateCheck = checkRateLimit(id);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error: 'Rate limited',
        message: `Too many actions. Try again in ${rateCheck.retryAfter} seconds.`,
        retryAfter: rateCheck.retryAfter
      });
      return;
    }

    const config = getCompositorConfig(id);
    if (!config) {
      res.status(404).json({ error: 'Compositor not found' });
      return;
    }

    const container = await getCompositorContainer(config.id);
    if (!container) {
      res.status(400).json({ error: 'Compositor container not found' });
      return;
    }

    if (container.status !== 'running') {
      res.status(400).json({ error: 'Compositor is not running' });
      return;
    }

    try {
      await stopContainer(container.id, 10);
      recordAction(id);

      logAuditEvent(req.ctx.user, 'compositor:stop', {
        resourceType: 'compositor',
        resourceId: id,
        details: { name: config.name, containerId: container.id }
      });

      if (broadcastStatusChange) {
        broadcastStatusChange(container.id);
      }

      res.json({ success: true, message: 'Compositor stopped' });
    } catch (error) {
      logAuditEvent(req.ctx.user, 'compositor:stop', {
        resourceType: 'compositor',
        resourceId: id,
        details: { name: config.name, containerId: container.id },
        result: 'failure',
        error: (error as Error).message
      });
      throw error;
    }
  })
);

// POST /api/compositors/:id/restart - Restart a compositor
router.post(
  '/:id/restart',
  requireCapability('compositors:control'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Check rate limit
    const rateCheck = checkRateLimit(id);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error: 'Rate limited',
        message: `Too many actions. Try again in ${rateCheck.retryAfter} seconds.`,
        retryAfter: rateCheck.retryAfter
      });
      return;
    }

    const config = getCompositorConfig(id);
    if (!config) {
      res.status(404).json({ error: 'Compositor not found' });
      return;
    }

    const container = await getCompositorContainer(config.id);
    if (!container) {
      res.status(400).json({ error: 'Compositor container not found' });
      return;
    }

    try {
      await restartContainer(container.id, 10);
      recordAction(id);

      logAuditEvent(req.ctx.user, 'compositor:restart', {
        resourceType: 'compositor',
        resourceId: id,
        details: { name: config.name, containerId: container.id }
      });

      if (broadcastStatusChange) {
        broadcastStatusChange(container.id);
      }

      res.json({ success: true, message: 'Compositor restarted' });
    } catch (error) {
      logAuditEvent(req.ctx.user, 'compositor:restart', {
        resourceType: 'compositor',
        resourceId: id,
        details: { name: config.name, containerId: container.id },
        result: 'failure',
        error: (error as Error).message
      });
      throw error;
    }
  })
);

// POST /api/compositors/:id/deploy - Redeploy compositor container
router.post(
  '/:id/deploy',
  requireCapability('compositors:control'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const config = getCompositorConfig(id);
    if (!config) {
      res.status(404).json({ error: 'Compositor not found' });
      return;
    }

    // Remove existing container if present
    const existingContainer = await getCompositorContainer(config.id);
    if (existingContainer) {
      try {
        await removeCompositorContainer(existingContainer.id, true);
      } catch (error) {
        res.status(500).json({
          error: 'Failed to remove existing container',
          message: (error as Error).message
        });
        return;
      }
    }

    // Create and start new container
    try {
      const containerId = await createAndStartCompositorContainer(config);

      logAuditEvent(req.ctx.user, 'compositor:deploy', {
        resourceType: 'compositor',
        resourceId: id,
        details: { name: config.name, containerId, redeployed: !!existingContainer }
      });

      if (broadcastStatusChange) {
        broadcastStatusChange(containerId);
      }

      res.json({ success: true, containerId, redeployed: !!existingContainer });
    } catch (error) {
      logAuditEvent(req.ctx.user, 'compositor:deploy', {
        resourceType: 'compositor',
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

// GET /api/compositors/:id/preview - Preview the generated FFmpeg command
router.get(
  '/:id/preview',
  requireCapability('compositors:read'),
  asyncHandler(async (req, res) => {
    const config = getCompositorConfig(req.params.id);
    if (!config) {
      res.status(404).json({ error: 'Compositor not found' });
      return;
    }

    const cmd = generateFfmpegCommand(config);
    const filterComplex = generateFilterComplex(config);

    res.json({
      ffmpegCommand: ['ffmpeg', ...cmd].join(' '),
      filterComplex,
      image: FFMPEG_IMAGE
    });
  })
);

export default router;
