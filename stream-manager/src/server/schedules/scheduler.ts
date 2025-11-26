/**
 * Scheduler Service
 * Executes scheduled actions on streams, groups, and compositors
 */

import { Schedule, ScheduleAction, ScheduleTargetType, calculateNextRun } from './schema.js';
import { getDueSchedules, recordScheduleExecution, getSchedule } from './storage.js';
import { getStreamConfig } from '../config/storage.js';
import { getStreamGroup } from '../groups/storage.js';
import { getCompositorConfig } from '../compositor/storage.js';
import {
  startContainer,
  stopContainer,
  refreshContainer,
  getContainerByName
} from '../docker.js';
import { logAuditEvent } from '../db/audit.js';
import { User } from '../auth/types.js';

// Scheduler state
let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
const POLL_INTERVAL_MS = 10000; // Check for due schedules every 10 seconds

// System user for scheduled actions (schedules run as system)
const SYSTEM_USER: User = {
  id: 'system',
  username: 'scheduler',
  roles: ['admin'],
  authSource: 'anonymous'  // Internal system user
};

// Callback for WebSocket broadcast (set by server setup)
let broadcastStatusChange: ((containerId: string) => void) | null = null;

export function setBroadcastCallback(callback: (containerId: string) => void): void {
  broadcastStatusChange = callback;
}

/**
 * Start the scheduler
 */
export function startScheduler(): void {
  if (schedulerInterval) {
    console.log('[Scheduler] Already running');
    return;
  }

  console.log('[Scheduler] Starting scheduler service');
  schedulerInterval = setInterval(checkAndExecuteDueSchedules, POLL_INTERVAL_MS);

  // Run immediately on start
  checkAndExecuteDueSchedules();
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[Scheduler] Stopped scheduler service');
  }
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}

/**
 * Check for and execute due schedules
 */
async function checkAndExecuteDueSchedules(): Promise<void> {
  // Prevent concurrent execution
  if (isRunning) {
    return;
  }

  isRunning = true;

  try {
    const dueSchedules = getDueSchedules();

    if (dueSchedules.length > 0) {
      console.log(`[Scheduler] Found ${dueSchedules.length} due schedule(s)`);
    }

    for (const schedule of dueSchedules) {
      await executeSchedule(schedule);
    }
  } catch (error) {
    console.error('[Scheduler] Error checking schedules:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Execute a single schedule
 */
async function executeSchedule(schedule: Schedule): Promise<void> {
  console.log(`[Scheduler] Executing schedule: ${schedule.name} (${schedule.action} ${schedule.targetType}:${schedule.targetId})`);

  try {
    // Verify schedule still exists and is enabled (could have changed since query)
    const currentSchedule = getSchedule(schedule.id);
    if (!currentSchedule || !currentSchedule.enabled) {
      console.log(`[Scheduler] Schedule ${schedule.id} no longer active, skipping`);
      return;
    }

    // Execute the action based on target type
    switch (schedule.targetType) {
      case 'stream':
        await executeStreamAction(schedule);
        break;
      case 'group':
        await executeGroupAction(schedule);
        break;
      case 'compositor':
        await executeCompositorAction(schedule);
        break;
    }

    // Record success
    recordScheduleExecution(schedule.id, 'success');

    // Log audit event
    logAuditEvent(SYSTEM_USER, `schedule:execute`, {
      resourceType: 'schedule',
      resourceId: schedule.id,
      details: {
        scheduleName: schedule.name,
        targetType: schedule.targetType,
        targetId: schedule.targetId,
        action: schedule.action,
        createdBy: schedule.createdBy
      },
      result: 'success'
    });

    console.log(`[Scheduler] Successfully executed schedule: ${schedule.name}`);

  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error(`[Scheduler] Failed to execute schedule ${schedule.name}:`, errorMessage);

    // Record failure
    recordScheduleExecution(schedule.id, 'failure', errorMessage);

    // Log audit event with error
    logAuditEvent(SYSTEM_USER, `schedule:execute`, {
      resourceType: 'schedule',
      resourceId: schedule.id,
      details: {
        scheduleName: schedule.name,
        targetType: schedule.targetType,
        targetId: schedule.targetId,
        action: schedule.action,
        createdBy: schedule.createdBy
      },
      result: 'failure',
      error: errorMessage
    });
  }
}

/**
 * Execute action on a stream
 */
async function executeStreamAction(schedule: Schedule): Promise<void> {
  const config = getStreamConfig(schedule.targetId);
  if (!config) {
    throw new Error(`Stream config not found: ${schedule.targetId}`);
  }

  const container = await getContainerByName(config.name);
  if (!container) {
    throw new Error(`Container not found for stream: ${config.name} - needs deployment`);
  }

  switch (schedule.action) {
    case 'start':
      if (container.status === 'running') {
        console.log(`[Scheduler] Stream ${config.name} already running, skipping start`);
        return;
      }
      await startContainer(container.id);
      break;

    case 'stop':
      if (container.status !== 'running') {
        console.log(`[Scheduler] Stream ${config.name} not running, skipping stop`);
        return;
      }
      await stopContainer(container.id, 10);
      break;

    case 'refresh':
      if (container.status !== 'running') {
        throw new Error(`Cannot refresh stream ${config.name} - not running`);
      }
      await refreshContainer(container.id);
      break;
  }

  if (broadcastStatusChange) {
    broadcastStatusChange(container.id);
  }
}

/**
 * Execute action on a group
 */
async function executeGroupAction(schedule: Schedule): Promise<void> {
  const group = getStreamGroup(schedule.targetId);
  if (!group) {
    throw new Error(`Group not found: ${schedule.targetId}`);
  }

  if (!group.enabled) {
    console.log(`[Scheduler] Group ${group.name} is disabled, skipping action`);
    return;
  }

  // Process streams in the group
  const sortedMembers = [...group.members].sort((a, b) => a.position - b.position);
  const errors: string[] = [];

  for (const member of sortedMembers) {
    try {
      const config = getStreamConfig(member.streamId);
      if (!config) {
        errors.push(`Stream ${member.streamId} config not found`);
        continue;
      }

      const container = await getContainerByName(config.name);
      if (!container) {
        errors.push(`Container for stream ${config.name} not found`);
        continue;
      }

      switch (schedule.action) {
        case 'start':
          if (container.status !== 'running') {
            await startContainer(container.id);
            if (broadcastStatusChange) {
              broadcastStatusChange(container.id);
            }
          }
          break;

        case 'stop':
          if (container.status === 'running') {
            await stopContainer(container.id, 10);
            if (broadcastStatusChange) {
              broadcastStatusChange(container.id);
            }
          }
          break;

        case 'refresh':
          // Refresh is not valid for groups, but handle gracefully
          errors.push('Refresh action not supported for groups');
          break;
      }

      // Add delay between sequential operations if needed
      if (group.startOrder === 'sequential' || group.stopOrder === 'sequential') {
        const delay = member.delayMs ?? (schedule.action === 'start' ? group.startDelayMs : group.stopDelayMs);
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

    } catch (err) {
      errors.push(`Stream ${member.streamId}: ${(err as Error).message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Some streams failed: ${errors.join('; ')}`);
  }
}

/**
 * Execute action on a compositor
 */
async function executeCompositorAction(schedule: Schedule): Promise<void> {
  const compositor = getCompositorConfig(schedule.targetId);
  if (!compositor) {
    throw new Error(`Compositor not found: ${schedule.targetId}`);
  }

  if (!compositor.enabled) {
    console.log(`[Scheduler] Compositor ${compositor.name} is disabled, skipping action`);
    return;
  }

  const container = await getContainerByName(`compositor-${compositor.name}`);
  if (!container) {
    throw new Error(`Container not found for compositor: ${compositor.name} - needs deployment`);
  }

  switch (schedule.action) {
    case 'start':
      if (container.status === 'running') {
        console.log(`[Scheduler] Compositor ${compositor.name} already running, skipping start`);
        return;
      }
      await startContainer(container.id);
      break;

    case 'stop':
      if (container.status !== 'running') {
        console.log(`[Scheduler] Compositor ${compositor.name} not running, skipping stop`);
        return;
      }
      await stopContainer(container.id, 10);
      break;

    case 'refresh':
      // Refresh is not valid for compositors
      throw new Error('Refresh action not supported for compositors');
  }

  if (broadcastStatusChange) {
    broadcastStatusChange(container.id);
  }
}

/**
 * Manually trigger a schedule (for testing or one-off execution)
 */
export async function triggerSchedule(scheduleId: string, user: User): Promise<{ success: boolean; error?: string }> {
  const schedule = getSchedule(scheduleId);
  if (!schedule) {
    return { success: false, error: 'Schedule not found' };
  }

  console.log(`[Scheduler] Manual trigger of schedule: ${schedule.name} by ${user.username}`);

  try {
    // Execute the action based on target type
    switch (schedule.targetType) {
      case 'stream':
        await executeStreamAction(schedule);
        break;
      case 'group':
        await executeGroupAction(schedule);
        break;
      case 'compositor':
        await executeCompositorAction(schedule);
        break;
    }

    // Log audit event (different action for manual trigger)
    logAuditEvent(user, `schedule:trigger`, {
      resourceType: 'schedule',
      resourceId: schedule.id,
      details: {
        scheduleName: schedule.name,
        targetType: schedule.targetType,
        targetId: schedule.targetId,
        action: schedule.action
      },
      result: 'success'
    });

    return { success: true };

  } catch (error) {
    const errorMessage = (error as Error).message;

    logAuditEvent(user, `schedule:trigger`, {
      resourceType: 'schedule',
      resourceId: schedule.id,
      details: {
        scheduleName: schedule.name,
        targetType: schedule.targetType,
        targetId: schedule.targetId,
        action: schedule.action
      },
      result: 'failure',
      error: errorMessage
    });

    return { success: false, error: errorMessage };
  }
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus(): {
  running: boolean;
  pollIntervalMs: number;
} {
  return {
    running: isSchedulerRunning(),
    pollIntervalMs: POLL_INTERVAL_MS
  };
}
