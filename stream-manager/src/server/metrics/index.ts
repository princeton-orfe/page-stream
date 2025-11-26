/**
 * Prometheus metrics endpoint for Stream Manager
 *
 * Exposes metrics in Prometheus text format at /metrics
 * Optionally protected by METRICS_API_KEY environment variable
 */

import { Router, Request, Response, NextFunction } from 'express';
import { listStreamContainers, StreamContainer } from '../docker.js';
import { getActiveUsersCount, getRecentApiRequestsByUser, ApiRequestCount } from '../db/users.js';
import { getAlertEventCountByState, getAlertRuleCount } from '../alerts/storage.js';
import { getScheduleStats } from '../schedules/storage.js';
import { getGroupCount } from '../groups/storage.js';

const router = Router();

// Metrics collection state
interface MetricsState {
  lastCollectionTime: number;
  containerMetrics: ContainerMetrics | null;
  userMetrics: UserMetrics | null;
  alertMetrics: AlertMetrics | null;
  scheduleMetrics: ScheduleMetrics | null;
  groupMetrics: GroupMetrics | null;
}

interface ContainerMetrics {
  total: number;
  byStatus: Record<string, number>;
  byHealth: Record<string, number>;
}

interface UserMetrics {
  activeUsers: number;
  requestsByUser: ApiRequestCount[];
}

interface AlertMetrics {
  rulesTotal: number;
  eventsByState: Record<string, number>;
}

interface ScheduleMetrics {
  total: number;
  enabled: number;
  disabled: number;
}

interface GroupMetrics {
  total: number;
}

const metricsState: MetricsState = {
  lastCollectionTime: 0,
  containerMetrics: null,
  userMetrics: null,
  alertMetrics: null,
  scheduleMetrics: null,
  groupMetrics: null
};

// Cache TTL in milliseconds (15 seconds to avoid hammering Docker)
const METRICS_CACHE_TTL = 15000;

/**
 * Collect all metrics from various sources
 */
async function collectMetrics(): Promise<void> {
  const now = Date.now();

  // Use cached metrics if still fresh
  if (now - metricsState.lastCollectionTime < METRICS_CACHE_TTL) {
    return;
  }

  // Collect container metrics
  try {
    const containers = await listStreamContainers();
    metricsState.containerMetrics = aggregateContainerMetrics(containers);
  } catch {
    // Keep previous metrics on error
  }

  // Collect user metrics
  try {
    metricsState.userMetrics = {
      activeUsers: getActiveUsersCount(60), // Active in last 60 minutes
      requestsByUser: getRecentApiRequestsByUser(60)
    };
  } catch {
    // Keep previous metrics on error
  }

  // Collect alert metrics
  try {
    metricsState.alertMetrics = {
      rulesTotal: getAlertRuleCount(),
      eventsByState: getAlertEventCountByState()
    };
  } catch {
    // Keep previous metrics on error
  }

  // Collect schedule metrics
  try {
    metricsState.scheduleMetrics = getScheduleStats();
  } catch {
    // Keep previous metrics on error
  }

  // Collect group metrics
  try {
    metricsState.groupMetrics = {
      total: getGroupCount()
    };
  } catch {
    // Keep previous metrics on error
  }

  metricsState.lastCollectionTime = now;
}

/**
 * Aggregate container metrics by status and health
 */
function aggregateContainerMetrics(containers: StreamContainer[]): ContainerMetrics {
  const byStatus: Record<string, number> = {
    running: 0,
    stopped: 0,
    restarting: 0,
    exited: 0
  };

  const byHealth: Record<string, number> = {
    healthy: 0,
    unhealthy: 0,
    starting: 0,
    none: 0
  };

  for (const container of containers) {
    byStatus[container.status] = (byStatus[container.status] || 0) + 1;
    byHealth[container.health] = (byHealth[container.health] || 0) + 1;
  }

  return {
    total: containers.length,
    byStatus,
    byHealth
  };
}

/**
 * Format metrics in Prometheus text exposition format
 */
function formatPrometheusMetrics(): string {
  const lines: string[] = [];
  const timestamp = Date.now();

  // Container metrics
  if (metricsState.containerMetrics) {
    const { total, byStatus, byHealth } = metricsState.containerMetrics;

    lines.push('# HELP stream_manager_containers_total Total number of page-stream containers');
    lines.push('# TYPE stream_manager_containers_total gauge');
    lines.push(`stream_manager_containers_total ${total} ${timestamp}`);

    lines.push('# HELP stream_manager_containers_by_status Number of containers by status');
    lines.push('# TYPE stream_manager_containers_by_status gauge');
    for (const [status, count] of Object.entries(byStatus)) {
      lines.push(`stream_manager_containers_by_status{status="${status}"} ${count} ${timestamp}`);
    }

    lines.push('# HELP stream_manager_containers_by_health Number of containers by health status');
    lines.push('# TYPE stream_manager_containers_by_health gauge');
    for (const [health, count] of Object.entries(byHealth)) {
      lines.push(`stream_manager_containers_by_health{health="${health}"} ${count} ${timestamp}`);
    }
  }

  // User metrics
  if (metricsState.userMetrics) {
    const { activeUsers, requestsByUser } = metricsState.userMetrics;

    lines.push('# HELP stream_manager_active_users Number of users with activity in the last hour');
    lines.push('# TYPE stream_manager_active_users gauge');
    lines.push(`stream_manager_active_users ${activeUsers} ${timestamp}`);

    // Only include per-user metrics if enabled via environment
    if (process.env.METRICS_INCLUDE_USER_REQUESTS === 'true' && requestsByUser.length > 0) {
      lines.push('# HELP stream_manager_api_requests_by_user API requests by user in the last hour');
      lines.push('# TYPE stream_manager_api_requests_by_user gauge');
      for (const { userId, username, requestCount } of requestsByUser) {
        const label = username || userId;
        lines.push(`stream_manager_api_requests_by_user{user="${escapeLabel(label)}"} ${requestCount} ${timestamp}`);
      }
    }
  }

  // Alert metrics
  if (metricsState.alertMetrics) {
    const { rulesTotal, eventsByState } = metricsState.alertMetrics;

    lines.push('# HELP stream_manager_alert_rules_total Total number of alert rules');
    lines.push('# TYPE stream_manager_alert_rules_total gauge');
    lines.push(`stream_manager_alert_rules_total ${rulesTotal} ${timestamp}`);

    lines.push('# HELP stream_manager_alert_events_by_state Number of alert events by state');
    lines.push('# TYPE stream_manager_alert_events_by_state gauge');
    for (const [state, count] of Object.entries(eventsByState)) {
      lines.push(`stream_manager_alert_events_by_state{state="${state}"} ${count} ${timestamp}`);
    }
  }

  // Schedule metrics
  if (metricsState.scheduleMetrics) {
    const { total, enabled, disabled } = metricsState.scheduleMetrics;

    lines.push('# HELP stream_manager_schedules_total Total number of schedules');
    lines.push('# TYPE stream_manager_schedules_total gauge');
    lines.push(`stream_manager_schedules_total ${total} ${timestamp}`);

    lines.push('# HELP stream_manager_schedules_enabled Number of enabled schedules');
    lines.push('# TYPE stream_manager_schedules_enabled gauge');
    lines.push(`stream_manager_schedules_enabled ${enabled} ${timestamp}`);

    lines.push('# HELP stream_manager_schedules_disabled Number of disabled schedules');
    lines.push('# TYPE stream_manager_schedules_disabled gauge');
    lines.push(`stream_manager_schedules_disabled ${disabled} ${timestamp}`);
  }

  // Group metrics
  if (metricsState.groupMetrics) {
    lines.push('# HELP stream_manager_groups_total Total number of stream groups');
    lines.push('# TYPE stream_manager_groups_total gauge');
    lines.push(`stream_manager_groups_total ${metricsState.groupMetrics.total} ${timestamp}`);
  }

  // Application info
  lines.push('# HELP stream_manager_info Application information');
  lines.push('# TYPE stream_manager_info gauge');
  lines.push(`stream_manager_info{version="1.0.0"} 1 ${timestamp}`);

  return lines.join('\n') + '\n';
}

/**
 * Escape special characters in Prometheus label values
 */
function escapeLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/**
 * API key authentication middleware for metrics endpoint
 */
function metricsAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.METRICS_API_KEY;

  // If no API key configured, allow access
  if (!apiKey) {
    return next();
  }

  // Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const [type, token] = authHeader.split(' ');
    if (type === 'Bearer' && token === apiKey) {
      return next();
    }
  }

  // Check query parameter
  if (req.query.api_key === apiKey) {
    return next();
  }

  res.status(401).json({ error: 'Invalid or missing API key' });
}

/**
 * Check if metrics are enabled
 */
function isMetricsEnabled(): boolean {
  const enabled = process.env.METRICS_ENABLED;
  // Default to true if not specified
  return enabled !== 'false';
}

// Metrics endpoint
router.get('/', metricsAuthMiddleware, async (_req: Request, res: Response) => {
  if (!isMetricsEnabled()) {
    res.status(404).json({ error: 'Metrics endpoint is disabled' });
    return;
  }

  try {
    await collectMetrics();
    const metrics = formatPrometheusMetrics();
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics);
  } catch (error) {
    console.error('Error collecting metrics:', error);
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});

export default router;

// Export for testing
export {
  collectMetrics,
  formatPrometheusMetrics,
  metricsAuthMiddleware,
  aggregateContainerMetrics,
  escapeLabel,
  isMetricsEnabled,
  metricsState,
  METRICS_CACHE_TTL
};
