/**
 * Alert Evaluator Service
 * Evaluates alert conditions against container states and triggers notifications
 */

import {
  AlertRule,
  AlertEvent,
  AlertCondition,
  formatAlertMessage
} from './schema.js';
import {
  getEnabledAlertRules,
  getAlertRulesForTarget,
  createAlertEvent,
  recordAlertTriggered,
  getRecentEventsForRule,
  resolveAlertEvent,
  getActiveEvents
} from './storage.js';
import { sendNotifications } from './notifications.js';
import { StreamContainer, listStreamContainers, getContainer } from '../docker.js';
import { listStreamConfigs } from '../config/storage.js';
import { listCompositorConfigs } from '../compositor/storage.js';
import { CompositorConfig } from '../compositor/schema.js';

// Evaluator state
let evaluatorInterval: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL_MS = 30000; // Check conditions every 30 seconds

// State tracking for status-based alerts
interface ContainerState {
  id: string;
  name: string;
  status: StreamContainer['status'];
  health: StreamContainer['health'];
  lastStatusChange: number;
  restartCount: number;
  restartTimestamps: number[];
}

const containerStates = new Map<string, ContainerState>();

/**
 * Start the alert evaluator
 */
export function startAlertEvaluator(): void {
  if (evaluatorInterval) {
    console.log('[AlertEvaluator] Already running');
    return;
  }

  console.log('[AlertEvaluator] Starting alert evaluator service');
  evaluatorInterval = setInterval(evaluateAlerts, POLL_INTERVAL_MS);

  // Run immediately on start
  evaluateAlerts();
}

/**
 * Stop the alert evaluator
 */
export function stopAlertEvaluator(): void {
  if (evaluatorInterval) {
    clearInterval(evaluatorInterval);
    evaluatorInterval = null;
    console.log('[AlertEvaluator] Stopped alert evaluator service');
  }
}

/**
 * Check if evaluator is running
 */
export function isAlertEvaluatorRunning(): boolean {
  return evaluatorInterval !== null;
}

/**
 * Get evaluator status
 */
export function getAlertEvaluatorStatus(): {
  running: boolean;
  pollIntervalMs: number;
  trackedContainers: number;
} {
  return {
    running: isAlertEvaluatorRunning(),
    pollIntervalMs: POLL_INTERVAL_MS,
    trackedContainers: containerStates.size
  };
}

/**
 * Main evaluation loop
 */
async function evaluateAlerts(): Promise<void> {
  try {
    // Get current container states
    const containers = await listStreamContainers();

    // Update state tracking and check for changes
    const statusChanges: Array<{
      container: StreamContainer;
      previousStatus?: string;
      previousHealth?: string;
    }> = [];

    for (const container of containers) {
      const previousState = containerStates.get(container.id);
      const now = Date.now();

      if (!previousState) {
        // New container - initialize tracking
        containerStates.set(container.id, {
          id: container.id,
          name: container.name,
          status: container.status,
          health: container.health,
          lastStatusChange: now,
          restartCount: 0,
          restartTimestamps: []
        });
      } else {
        // Check for status change
        if (previousState.status !== container.status) {
          statusChanges.push({
            container,
            previousStatus: previousState.status
          });

          // Track restarts
          if (container.status === 'running' && previousState.status !== 'running') {
            previousState.restartCount++;
            previousState.restartTimestamps.push(now);
            // Keep only last hour of restart timestamps
            const oneHourAgo = now - 3600000;
            previousState.restartTimestamps = previousState.restartTimestamps.filter(t => t > oneHourAgo);
          }

          previousState.status = container.status;
          previousState.lastStatusChange = now;
        }

        // Check for health change
        if (previousState.health !== container.health) {
          statusChanges.push({
            container,
            previousHealth: previousState.health
          });
          previousState.health = container.health;
        }
      }
    }

    // Clean up states for removed containers
    const currentIds = new Set(containers.map(c => c.id));
    for (const [id] of containerStates) {
      if (!currentIds.has(id)) {
        containerStates.delete(id);
      }
    }

    // Evaluate alert rules
    const rules = getEnabledAlertRules();

    for (const rule of rules) {
      await evaluateRule(rule, containers, statusChanges);
    }

    // Check for resolved alerts
    await checkResolvedAlerts(containers);

  } catch (error) {
    console.error('[AlertEvaluator] Error evaluating alerts:', error);
  }
}

/**
 * Evaluate a single alert rule
 */
async function evaluateRule(
  rule: AlertRule,
  containers: StreamContainer[],
  statusChanges: Array<{ container: StreamContainer; previousStatus?: string; previousHealth?: string }>
): Promise<void> {
  // Determine which containers to check based on rule target
  const targetsToCheck = getTargetsForRule(rule, containers);

  for (const target of targetsToCheck) {
    const change = statusChanges.find(c => c.container.id === target.container.id);
    const state = containerStates.get(target.container.id);

    if (await shouldTriggerAlert(rule, target.container, state, change)) {
      await triggerAlert(rule, target.container, target.name, target.type, state);
    }
  }
}

/**
 * Get targets to check for a rule
 */
function getTargetsForRule(
  rule: AlertRule,
  containers: StreamContainer[]
): Array<{ container: StreamContainer; name: string; type: 'stream' | 'compositor' | 'group' }> {
  const targets: Array<{ container: StreamContainer; name: string; type: 'stream' | 'compositor' | 'group' }> = [];

  // Get all stream configs for mapping
  const streamConfigs = listStreamConfigs().configs;
  const compositorConfigs = listCompositorConfigs().configs;

  for (const container of containers) {
    // Check if container matches rule target
    let matchedType: 'stream' | 'compositor' | null = null;
    let matchedName = container.name;

    // Check if it's a stream
    const streamConfig = streamConfigs.find((s: { name: string }) => s.name === container.name);
    if (streamConfig) {
      if (rule.targetType === 'stream' || rule.targetType === 'any') {
        if (!rule.targetId || rule.targetId === streamConfig.id) {
          matchedType = 'stream';
          matchedName = streamConfig.name;
        }
      }
    }

    // Check if it's a compositor
    const compositorConfig = compositorConfigs.find((c: CompositorConfig) => `compositor-${c.name}` === container.name);
    if (compositorConfig) {
      if (rule.targetType === 'compositor' || rule.targetType === 'any') {
        if (!rule.targetId || rule.targetId === compositorConfig.id) {
          matchedType = 'compositor';
          matchedName = compositorConfig.name;
        }
      }
    }

    if (matchedType) {
      targets.push({
        container,
        name: matchedName,
        type: matchedType
      });
    }
  }

  return targets;
}

/**
 * Check if an alert should be triggered
 */
async function shouldTriggerAlert(
  rule: AlertRule,
  container: StreamContainer,
  state: ContainerState | undefined,
  change: { container: StreamContainer; previousStatus?: string; previousHealth?: string } | undefined
): Promise<boolean> {
  const { condition } = rule;

  switch (condition.type) {
    case 'status_changed':
      if (!change || !change.previousStatus) return false;
      if (condition.statusFrom && change.previousStatus !== condition.statusFrom) return false;
      if (condition.statusTo && container.status !== condition.statusTo) return false;
      return true;

    case 'status_is':
      if (!condition.status || container.status !== condition.status) return false;
      if (condition.durationSeconds && state) {
        const durationMs = condition.durationSeconds * 1000;
        const elapsed = Date.now() - state.lastStatusChange;
        if (elapsed < durationMs) return false;
      }
      return true;

    case 'health_unhealthy':
      if (container.health !== 'unhealthy') return false;
      // Only trigger once when health changes to unhealthy
      if (change && change.previousHealth !== 'unhealthy') return true;
      return false;

    case 'restart_count':
      if (!state || !condition.threshold) return false;
      const windowMs = (condition.timeWindowSeconds || 3600) * 1000;
      const windowStart = Date.now() - windowMs;
      const recentRestarts = state.restartTimestamps.filter(t => t >= windowStart).length;
      return recentRestarts >= condition.threshold;

    case 'offline_duration':
      if (!state || !condition.durationSeconds) return false;
      if (container.status === 'running') return false;
      const offlineDurationMs = condition.durationSeconds * 1000;
      const offlineElapsed = Date.now() - state.lastStatusChange;
      return offlineElapsed >= offlineDurationMs;

    case 'schedule_failed':
      // This is handled by the scheduler, not the evaluator
      return false;

    default:
      return false;
  }
}

/**
 * Trigger an alert
 */
async function triggerAlert(
  rule: AlertRule,
  container: StreamContainer,
  targetName: string,
  targetType: 'stream' | 'compositor' | 'group',
  state: ContainerState | undefined
): Promise<void> {
  // Check cooldown
  if (!shouldNotify(rule)) {
    console.log(`[AlertEvaluator] Alert ${rule.name} triggered but in cooldown period`);
    recordAlertTriggered(rule.id, false);
    return;
  }

  // Find the target ID
  let targetId = container.id;
  if (targetType === 'stream') {
    const config = listStreamConfigs().configs.find((c: { id: string; name: string }) => c.name === targetName);
    if (config) targetId = config.id;
  } else if (targetType === 'compositor') {
    const config = listCompositorConfigs().configs.find((c: CompositorConfig) => c.name === targetName);
    if (config) targetId = config.id;
  }

  // Build details
  const details: Record<string, unknown> = {
    containerStatus: container.status,
    containerHealth: container.health
  };

  if (state) {
    details.restartCount = state.restartCount;
    details.lastStatusChange = new Date(state.lastStatusChange).toISOString();
  }

  // Generate message
  const message = formatAlertMessage(rule, targetName, details);

  // Create alert event
  const event = createAlertEvent({
    ruleId: rule.id,
    ruleName: rule.name,
    severity: rule.severity,
    targetType,
    targetId,
    targetName,
    condition: rule.condition,
    message,
    details
  });

  console.log(`[AlertEvaluator] Alert triggered: ${message}`);

  // Record trigger with notification
  recordAlertTriggered(rule.id, true);

  // Send notifications
  if (rule.notifications.length > 0) {
    try {
      const results = await sendNotifications(rule, event);
      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        console.error(`[AlertEvaluator] Some notifications failed:`, failed.map(f => f.error));
      }
    } catch (error) {
      console.error(`[AlertEvaluator] Failed to send notifications:`, error);
    }
  }
}

/**
 * Check if notification should be sent (respecting cooldown)
 */
function shouldNotify(rule: AlertRule): boolean {
  if (rule.cooldownMinutes === 0) return true;
  if (!rule.lastNotified) return true;

  const lastNotified = new Date(rule.lastNotified).getTime();
  const cooldownMs = rule.cooldownMinutes * 60 * 1000;
  const now = Date.now();

  return now - lastNotified >= cooldownMs;
}

/**
 * Check for resolved alerts and mark them
 */
async function checkResolvedAlerts(containers: StreamContainer[]): Promise<void> {
  const activeEvents = getActiveEvents();

  for (const event of activeEvents) {
    // Find the container for this event
    const container = containers.find((c: StreamContainer) => {
      if (event.targetType === 'stream') {
        const config = listStreamConfigs().configs.find((s: { id: string; name: string }) => s.id === event.targetId);
        return config && c.name === config.name;
      }
      if (event.targetType === 'compositor') {
        const config = listCompositorConfigs().configs.find((s: CompositorConfig) => s.id === event.targetId);
        return config && c.name === `compositor-${config.name}`;
      }
      return false;
    });

    if (!container) continue;

    // Check if condition is resolved based on type
    let resolved = false;

    switch (event.condition.type) {
      case 'status_changed':
        // Status changed alerts resolve when status changes again
        if (event.condition.statusTo && container.status !== event.condition.statusTo) {
          resolved = true;
        }
        break;

      case 'status_is':
        // Status is alerts resolve when status changes
        if (event.condition.status && container.status !== event.condition.status) {
          resolved = true;
        }
        break;

      case 'health_unhealthy':
        // Unhealthy alerts resolve when health becomes healthy
        if (container.health === 'healthy') {
          resolved = true;
        }
        break;

      case 'offline_duration':
        // Offline duration alerts resolve when container starts running
        if (container.status === 'running') {
          resolved = true;
        }
        break;

      case 'restart_count':
        // These don't auto-resolve
        break;

      case 'schedule_failed':
        // These don't auto-resolve
        break;
    }

    if (resolved) {
      resolveAlertEvent(event.id);
      console.log(`[AlertEvaluator] Alert resolved: ${event.ruleName} for ${event.targetName}`);
    }
  }
}

/**
 * Manually trigger an alert for schedule failure
 * Called by the scheduler when a scheduled action fails
 */
export async function triggerScheduleFailedAlert(
  targetType: 'stream' | 'group' | 'compositor',
  targetId: string,
  targetName: string,
  error: string
): Promise<void> {
  // Find rules that match this schedule failure
  const rules = getAlertRulesForTarget(targetType, targetId).filter(
    r => r.condition.type === 'schedule_failed'
  );

  for (const rule of rules) {
    if (!shouldNotify(rule)) continue;

    const details = { error, scheduledAt: new Date().toISOString() };
    const message = formatAlertMessage(rule, targetName, details);

    const event = createAlertEvent({
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      targetType,
      targetId,
      targetName,
      condition: rule.condition,
      message,
      details
    });

    console.log(`[AlertEvaluator] Schedule failure alert triggered: ${message}`);

    recordAlertTriggered(rule.id, true);

    if (rule.notifications.length > 0) {
      try {
        await sendNotifications(rule, event);
      } catch (err) {
        console.error(`[AlertEvaluator] Failed to send schedule failure notification:`, err);
      }
    }
  }
}
