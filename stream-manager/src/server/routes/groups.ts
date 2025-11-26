import { Router, Request, Response, NextFunction } from 'express';
import { requireCapability } from '../auth/index.js';
import {
  startContainer,
  stopContainer,
  getContainerByName,
  listStreamContainers
} from '../docker.js';
import { logAuditEvent } from '../db/audit.js';
import {
  createStreamGroup,
  getStreamGroup,
  listStreamGroups,
  updateStreamGroup,
  deleteStreamGroup,
  getGroupsContainingStream
} from '../groups/storage.js';
import {
  validateStreamGroupCreate,
  validateStreamGroupUpdate,
  StreamGroupValidationError,
  StreamGroup
} from '../groups/schema.js';
import { getStreamConfig } from '../config/storage.js';

// Rate limiting: track last action time per group
const lastActionTime = new Map<string, number>();
const RATE_LIMIT_MS = 5000; // 5 seconds between actions per group

function checkRateLimit(groupId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const lastTime = lastActionTime.get(groupId);

  if (lastTime && now - lastTime < RATE_LIMIT_MS) {
    const retryAfter = Math.ceil((RATE_LIMIT_MS - (now - lastTime)) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

function recordAction(groupId: string): void {
  lastActionTime.set(groupId, Date.now());
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
// Helper functions for group control operations
// ============================================================================

interface StreamStatus {
  streamId: string;
  name: string;
  containerId?: string;
  status: 'running' | 'stopped' | 'restarting' | 'exited' | 'unknown';
}

/**
 * Get status for all streams in a group
 */
async function getGroupStreamStatuses(group: StreamGroup): Promise<StreamStatus[]> {
  const statuses: StreamStatus[] = [];

  for (const member of group.members) {
    const config = getStreamConfig(member.streamId);
    if (!config) {
      statuses.push({
        streamId: member.streamId,
        name: `Unknown (${member.streamId})`,
        status: 'unknown'
      });
      continue;
    }

    const container = await getContainerByName(config.name);
    statuses.push({
      streamId: member.streamId,
      name: config.name,
      containerId: container?.id,
      status: container?.status || 'stopped'
    });
  }

  return statuses;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Start all streams in a group with proper ordering
 */
async function startGroupStreams(
  group: StreamGroup,
  onProgress?: (streamId: string, status: 'started' | 'skipped' | 'error', error?: string) => void
): Promise<{ started: string[]; skipped: string[]; errors: Array<{ streamId: string; error: string }> }> {
  const started: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ streamId: string; error: string }> = [];

  // Sort members by position
  const sortedMembers = [...group.members].sort((a, b) => a.position - b.position);

  if (group.startOrder === 'parallel') {
    // Start all streams in parallel
    const promises = sortedMembers.map(async (member) => {
      const config = getStreamConfig(member.streamId);
      if (!config) {
        errors.push({ streamId: member.streamId, error: 'Stream config not found' });
        onProgress?.(member.streamId, 'error', 'Stream config not found');
        return;
      }

      const container = await getContainerByName(config.name);
      if (!container) {
        errors.push({ streamId: member.streamId, error: 'Container not found - needs deployment' });
        onProgress?.(member.streamId, 'error', 'Container not found');
        return;
      }

      if (container.status === 'running') {
        skipped.push(member.streamId);
        onProgress?.(member.streamId, 'skipped');
        return;
      }

      try {
        await startContainer(container.id);
        started.push(member.streamId);
        onProgress?.(member.streamId, 'started');
        if (broadcastStatusChange) {
          broadcastStatusChange(container.id);
        }
      } catch (err) {
        errors.push({ streamId: member.streamId, error: (err as Error).message });
        onProgress?.(member.streamId, 'error', (err as Error).message);
      }
    });

    await Promise.all(promises);
  } else {
    // Sequential start
    for (let i = 0; i < sortedMembers.length; i++) {
      const member = sortedMembers[i];
      const config = getStreamConfig(member.streamId);

      if (!config) {
        errors.push({ streamId: member.streamId, error: 'Stream config not found' });
        onProgress?.(member.streamId, 'error', 'Stream config not found');
        continue;
      }

      const container = await getContainerByName(config.name);
      if (!container) {
        errors.push({ streamId: member.streamId, error: 'Container not found - needs deployment' });
        onProgress?.(member.streamId, 'error', 'Container not found');
        continue;
      }

      if (container.status === 'running') {
        skipped.push(member.streamId);
        onProgress?.(member.streamId, 'skipped');
      } else {
        try {
          await startContainer(container.id);
          started.push(member.streamId);
          onProgress?.(member.streamId, 'started');
          if (broadcastStatusChange) {
            broadcastStatusChange(container.id);
          }
        } catch (err) {
          errors.push({ streamId: member.streamId, error: (err as Error).message });
          onProgress?.(member.streamId, 'error', (err as Error).message);
        }
      }

      // Add delay between starts (use member-specific delay or group default)
      if (i < sortedMembers.length - 1) {
        const delay = member.delayMs ?? group.startDelayMs;
        if (delay > 0) {
          await sleep(delay);
        }
      }
    }
  }

  return { started, skipped, errors };
}

/**
 * Stop all streams in a group with proper ordering
 */
async function stopGroupStreams(
  group: StreamGroup,
  onProgress?: (streamId: string, status: 'stopped' | 'skipped' | 'error', error?: string) => void
): Promise<{ stopped: string[]; skipped: string[]; errors: Array<{ streamId: string; error: string }> }> {
  const stopped: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ streamId: string; error: string }> = [];

  // Sort members by position
  let sortedMembers = [...group.members].sort((a, b) => a.position - b.position);

  // Reverse order if specified
  if (group.stopOrder === 'reverse') {
    sortedMembers = sortedMembers.reverse();
  }

  if (group.stopOrder === 'parallel') {
    // Stop all streams in parallel
    const promises = sortedMembers.map(async (member) => {
      const config = getStreamConfig(member.streamId);
      if (!config) {
        errors.push({ streamId: member.streamId, error: 'Stream config not found' });
        onProgress?.(member.streamId, 'error', 'Stream config not found');
        return;
      }

      const container = await getContainerByName(config.name);
      if (!container) {
        skipped.push(member.streamId);
        onProgress?.(member.streamId, 'skipped');
        return;
      }

      if (container.status !== 'running') {
        skipped.push(member.streamId);
        onProgress?.(member.streamId, 'skipped');
        return;
      }

      try {
        await stopContainer(container.id, 10);
        stopped.push(member.streamId);
        onProgress?.(member.streamId, 'stopped');
        if (broadcastStatusChange) {
          broadcastStatusChange(container.id);
        }
      } catch (err) {
        errors.push({ streamId: member.streamId, error: (err as Error).message });
        onProgress?.(member.streamId, 'error', (err as Error).message);
      }
    });

    await Promise.all(promises);
  } else {
    // Sequential stop (normal or reverse order)
    for (let i = 0; i < sortedMembers.length; i++) {
      const member = sortedMembers[i];
      const config = getStreamConfig(member.streamId);

      if (!config) {
        errors.push({ streamId: member.streamId, error: 'Stream config not found' });
        onProgress?.(member.streamId, 'error', 'Stream config not found');
        continue;
      }

      const container = await getContainerByName(config.name);
      if (!container) {
        skipped.push(member.streamId);
        onProgress?.(member.streamId, 'skipped');
        continue;
      }

      if (container.status !== 'running') {
        skipped.push(member.streamId);
        onProgress?.(member.streamId, 'skipped');
      } else {
        try {
          await stopContainer(container.id, 10);
          stopped.push(member.streamId);
          onProgress?.(member.streamId, 'stopped');
          if (broadcastStatusChange) {
            broadcastStatusChange(container.id);
          }
        } catch (err) {
          errors.push({ streamId: member.streamId, error: (err as Error).message });
          onProgress?.(member.streamId, 'error', (err as Error).message);
        }
      }

      // Add delay between stops
      if (i < sortedMembers.length - 1) {
        const delay = member.delayMs ?? group.stopDelayMs;
        if (delay > 0) {
          await sleep(delay);
        }
      }
    }
  }

  return { stopped, skipped, errors };
}

// ============================================================================
// CRUD Routes
// ============================================================================

// GET /api/groups - List all stream groups
router.get(
  '/',
  requireCapability('groups:list'),
  asyncHandler(async (req, res) => {
    const enabled = req.query.enabled !== undefined
      ? req.query.enabled === 'true'
      : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;

    const result = listStreamGroups({ enabled, limit, offset });

    // Get container statuses for each group
    const groupsWithStatus = await Promise.all(
      result.groups.map(async (group) => {
        const statuses = await getGroupStreamStatuses(group);
        const runningCount = statuses.filter(s => s.status === 'running').length;
        const totalCount = statuses.length;
        return {
          ...group,
          streamStatuses: statuses,
          runningCount,
          totalCount
        };
      })
    );

    res.json({ groups: groupsWithStatus, total: result.total });
  })
);

// GET /api/groups/:id - Get stream group by ID
router.get(
  '/:id',
  requireCapability('groups:read'),
  asyncHandler(async (req, res) => {
    const group = getStreamGroup(req.params.id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const statuses = await getGroupStreamStatuses(group);
    const runningCount = statuses.filter(s => s.status === 'running').length;
    const totalCount = statuses.length;

    res.json({
      ...group,
      streamStatuses: statuses,
      runningCount,
      totalCount
    });
  })
);

// POST /api/groups - Create new stream group
router.post(
  '/',
  requireCapability('groups:create'),
  asyncHandler(async (req, res) => {
    // Validate input
    let validatedConfig;
    try {
      validatedConfig = validateStreamGroupCreate(req.body);
    } catch (error) {
      if (error instanceof StreamGroupValidationError) {
        res.status(400).json({
          error: 'Validation error',
          field: error.field,
          message: error.message
        });
        return;
      }
      throw error;
    }

    // Create the group in database
    let group;
    try {
      group = createStreamGroup(validatedConfig, req.ctx.user);
    } catch (error) {
      if (error instanceof StreamGroupValidationError) {
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
    logAuditEvent(req.ctx.user, 'group:create', {
      resourceType: 'group',
      resourceId: group.id,
      details: { name: group.name, memberCount: group.members.length }
    });

    res.status(201).json(group);
  })
);

// PUT /api/groups/:id - Update stream group
router.put(
  '/:id',
  requireCapability('groups:update'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    let group = getStreamGroup(id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    // Validate updates
    let validatedUpdates;
    try {
      validatedUpdates = validateStreamGroupUpdate(req.body);
    } catch (error) {
      if (error instanceof StreamGroupValidationError) {
        res.status(400).json({
          error: 'Validation error',
          field: error.field,
          message: error.message
        });
        return;
      }
      throw error;
    }

    // Update the group
    try {
      group = updateStreamGroup(id, validatedUpdates, req.ctx.user);
    } catch (error) {
      if (error instanceof StreamGroupValidationError) {
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
    logAuditEvent(req.ctx.user, 'group:update', {
      resourceType: 'group',
      resourceId: group.id,
      details: { changes: Object.keys(validatedUpdates) }
    });

    res.json(group);
  })
);

// DELETE /api/groups/:id - Delete stream group
router.delete(
  '/:id',
  requireCapability('groups:delete'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const group = getStreamGroup(id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    // Delete the group
    deleteStreamGroup(id);

    // Audit log
    logAuditEvent(req.ctx.user, 'group:delete', {
      resourceType: 'group',
      resourceId: id,
      details: { name: group.name }
    });

    res.json({ success: true });
  })
);

// ============================================================================
// Control Routes
// ============================================================================

// POST /api/groups/:id/start - Start all streams in group
router.post(
  '/:id/start',
  requireCapability('groups:control'),
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

    const group = getStreamGroup(id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    if (!group.enabled) {
      res.status(400).json({ error: 'Group is disabled' });
      return;
    }

    try {
      const result = await startGroupStreams(group);
      recordAction(id);

      // Audit log
      logAuditEvent(req.ctx.user, 'group:start', {
        resourceType: 'group',
        resourceId: id,
        details: {
          name: group.name,
          started: result.started.length,
          skipped: result.skipped.length,
          errors: result.errors.length
        }
      });

      res.json({
        success: true,
        message: `Started ${result.started.length} streams`,
        ...result
      });
    } catch (error) {
      logAuditEvent(req.ctx.user, 'group:start', {
        resourceType: 'group',
        resourceId: id,
        details: { name: group.name },
        result: 'failure',
        error: (error as Error).message
      });
      throw error;
    }
  })
);

// POST /api/groups/:id/stop - Stop all streams in group
router.post(
  '/:id/stop',
  requireCapability('groups:control'),
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

    const group = getStreamGroup(id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    try {
      const result = await stopGroupStreams(group);
      recordAction(id);

      // Audit log
      logAuditEvent(req.ctx.user, 'group:stop', {
        resourceType: 'group',
        resourceId: id,
        details: {
          name: group.name,
          stopped: result.stopped.length,
          skipped: result.skipped.length,
          errors: result.errors.length
        }
      });

      res.json({
        success: true,
        message: `Stopped ${result.stopped.length} streams`,
        ...result
      });
    } catch (error) {
      logAuditEvent(req.ctx.user, 'group:stop', {
        resourceType: 'group',
        resourceId: id,
        details: { name: group.name },
        result: 'failure',
        error: (error as Error).message
      });
      throw error;
    }
  })
);

// POST /api/groups/:id/restart - Restart all streams in group
router.post(
  '/:id/restart',
  requireCapability('groups:control'),
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

    const group = getStreamGroup(id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    if (!group.enabled) {
      res.status(400).json({ error: 'Group is disabled' });
      return;
    }

    try {
      // Stop first
      const stopResult = await stopGroupStreams(group);

      // Small delay between stop and start
      await sleep(1000);

      // Then start
      const startResult = await startGroupStreams(group);
      recordAction(id);

      // Audit log
      logAuditEvent(req.ctx.user, 'group:restart', {
        resourceType: 'group',
        resourceId: id,
        details: {
          name: group.name,
          stopped: stopResult.stopped.length,
          started: startResult.started.length
        }
      });

      res.json({
        success: true,
        message: `Restarted group`,
        stopped: stopResult,
        started: startResult
      });
    } catch (error) {
      logAuditEvent(req.ctx.user, 'group:restart', {
        resourceType: 'group',
        resourceId: id,
        details: { name: group.name },
        result: 'failure',
        error: (error as Error).message
      });
      throw error;
    }
  })
);

// GET /api/groups/by-stream/:streamId - Get groups containing a stream
router.get(
  '/by-stream/:streamId',
  requireCapability('groups:list'),
  asyncHandler(async (req, res) => {
    const { streamId } = req.params;
    const groups = getGroupsContainingStream(streamId);
    res.json({ groups });
  })
);

export default router;
