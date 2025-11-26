/**
 * Alert Schema
 * Defines the structure for alert rules that monitor streams, groups, and compositors.
 */

/**
 * Target type for alert rule
 */
export type AlertTargetType = 'stream' | 'group' | 'compositor' | 'any';

/**
 * Condition types for alert rules
 */
export type AlertConditionType =
  | 'status_changed'      // Container status changed (e.g., running -> stopped)
  | 'status_is'           // Container has specific status for duration
  | 'health_unhealthy'    // Container health check failed
  | 'restart_count'       // Container restart count exceeds threshold
  | 'offline_duration'    // Container offline for specified duration
  | 'schedule_failed';    // Scheduled action failed

/**
 * Alert severity levels
 */
export type AlertSeverity = 'info' | 'warning' | 'critical';

/**
 * Notification channel types
 */
export type NotificationChannelType = 'webhook' | 'email';

/**
 * Webhook notification configuration
 */
export interface WebhookNotification {
  type: 'webhook';
  url: string;
  headers?: Record<string, string>;
  method?: 'POST' | 'PUT';
}

/**
 * Email notification configuration
 */
export interface EmailNotification {
  type: 'email';
  recipients: string[];
  subject?: string;  // Optional custom subject template
}

/**
 * Notification channel configuration
 */
export type NotificationChannel = WebhookNotification | EmailNotification;

/**
 * Alert condition configuration
 */
export interface AlertCondition {
  type: AlertConditionType;
  // status_changed: previous status (optional), new status
  statusFrom?: string;
  statusTo?: string;
  // status_is: the status to match
  status?: string;
  // Duration in seconds for status_is and offline_duration
  durationSeconds?: number;
  // restart_count: threshold
  threshold?: number;
  // Time window for counting restarts (seconds)
  timeWindowSeconds?: number;
}

/**
 * Full alert rule configuration interface
 */
export interface AlertRule {
  // Identity
  id: string;                           // UUID, generated on create
  name: string;                         // Human-readable name
  description?: string;                 // Optional description
  enabled: boolean;                     // Whether alert is active

  // Target
  targetType: AlertTargetType;          // What type of resource to monitor ('any' for all)
  targetId?: string;                    // Optional specific ID (if not set, applies to all of type)

  // Condition
  condition: AlertCondition;            // When to trigger

  // Severity
  severity: AlertSeverity;              // Alert importance level

  // Notification
  notifications: NotificationChannel[]; // Where to send alerts
  cooldownMinutes: number;              // Minimum minutes between repeated alerts

  // State tracking
  lastTriggered?: string;               // ISO timestamp of last trigger
  lastNotified?: string;                // ISO timestamp of last notification sent
  triggerCount: number;                 // Total times triggered

  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
}

/**
 * Alert event (triggered alert instance)
 */
export interface AlertEvent {
  id: string;                           // UUID
  ruleId: string;                       // Alert rule that triggered
  ruleName: string;                     // Alert rule name at time of trigger
  severity: AlertSeverity;
  targetType: AlertTargetType;
  targetId: string;                     // The specific resource that triggered
  targetName: string;                   // Human-readable target name
  condition: AlertCondition;            // Condition that matched
  message: string;                      // Human-readable description
  details?: Record<string, unknown>;    // Additional context
  acknowledgedAt?: string;              // When alert was acknowledged
  acknowledgedBy?: string;              // Who acknowledged
  resolvedAt?: string;                  // When condition resolved
  createdAt: string;
}

/**
 * Configuration for creating a new alert rule
 */
export type AlertRuleCreate = Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'lastTriggered' | 'lastNotified' | 'triggerCount'>;

/**
 * Configuration for updating an alert rule
 */
export type AlertRuleUpdate = Partial<Omit<AlertRule, 'id' | 'createdAt' | 'createdBy' | 'lastTriggered' | 'lastNotified' | 'triggerCount'>>;

/**
 * Default values for alert rule configuration
 */
export const ALERT_RULE_DEFAULTS: Partial<AlertRuleCreate> = {
  enabled: true,
  severity: 'warning',
  cooldownMinutes: 15,
  notifications: []
};

/**
 * Custom validation error for alerts
 */
export class AlertValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = 'AlertValidationError';
  }
}

/**
 * Valid target types
 */
const VALID_TARGET_TYPES: AlertTargetType[] = ['stream', 'group', 'compositor', 'any'];

/**
 * Valid condition types
 */
const VALID_CONDITION_TYPES: AlertConditionType[] = [
  'status_changed',
  'status_is',
  'health_unhealthy',
  'restart_count',
  'offline_duration',
  'schedule_failed'
];

/**
 * Valid severity levels
 */
const VALID_SEVERITIES: AlertSeverity[] = ['info', 'warning', 'critical'];

/**
 * Valid container statuses
 */
const VALID_STATUSES = ['running', 'stopped', 'restarting', 'exited'];

/**
 * Validate webhook URL
 */
function validateWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Invalid protocol');
    }
    return url;
  } catch {
    throw new AlertValidationError(
      'Invalid webhook URL. Must be a valid HTTP or HTTPS URL.',
      'notifications'
    );
  }
}

/**
 * Validate email address
 */
function validateEmail(email: string): string {
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new AlertValidationError(
      `Invalid email address: ${email}`,
      'notifications'
    );
  }
  return email;
}

/**
 * Validate notification channel
 */
function validateNotificationChannel(channel: unknown): NotificationChannel {
  if (!channel || typeof channel !== 'object') {
    throw new AlertValidationError('Notification channel must be an object', 'notifications');
  }

  const data = channel as Record<string, unknown>;

  if (data.type === 'webhook') {
    if (!data.url || typeof data.url !== 'string') {
      throw new AlertValidationError('Webhook URL is required', 'notifications');
    }
    const url = validateWebhookUrl(data.url);

    const result: WebhookNotification = { type: 'webhook', url };

    if (data.headers !== undefined) {
      if (typeof data.headers !== 'object' || data.headers === null) {
        throw new AlertValidationError('Headers must be an object', 'notifications');
      }
      result.headers = data.headers as Record<string, string>;
    }

    if (data.method !== undefined) {
      if (data.method !== 'POST' && data.method !== 'PUT') {
        throw new AlertValidationError('Method must be POST or PUT', 'notifications');
      }
      result.method = data.method;
    }

    return result;
  }

  if (data.type === 'email') {
    if (!data.recipients || !Array.isArray(data.recipients) || data.recipients.length === 0) {
      throw new AlertValidationError('Email recipients array is required', 'notifications');
    }

    const recipients = data.recipients.map((r: unknown) => {
      if (typeof r !== 'string') {
        throw new AlertValidationError('Email recipient must be a string', 'notifications');
      }
      return validateEmail(r);
    });

    const result: EmailNotification = { type: 'email', recipients };

    if (data.subject !== undefined) {
      if (typeof data.subject !== 'string') {
        throw new AlertValidationError('Subject must be a string', 'notifications');
      }
      result.subject = data.subject;
    }

    return result;
  }

  throw new AlertValidationError(
    'Notification type must be "webhook" or "email"',
    'notifications'
  );
}

/**
 * Validate alert condition
 */
function validateCondition(condition: unknown): AlertCondition {
  if (!condition || typeof condition !== 'object') {
    throw new AlertValidationError('Condition must be an object', 'condition');
  }

  const data = condition as Record<string, unknown>;

  if (!data.type || typeof data.type !== 'string') {
    throw new AlertValidationError('Condition type is required', 'condition');
  }

  if (!VALID_CONDITION_TYPES.includes(data.type as AlertConditionType)) {
    throw new AlertValidationError(
      `Condition type must be one of: ${VALID_CONDITION_TYPES.join(', ')}`,
      'condition'
    );
  }

  const result: AlertCondition = { type: data.type as AlertConditionType };

  // Validate type-specific fields
  switch (data.type) {
    case 'status_changed':
      if (data.statusFrom !== undefined) {
        if (typeof data.statusFrom !== 'string' || !VALID_STATUSES.includes(data.statusFrom)) {
          throw new AlertValidationError(
            `statusFrom must be one of: ${VALID_STATUSES.join(', ')}`,
            'condition'
          );
        }
        result.statusFrom = data.statusFrom;
      }
      if (data.statusTo !== undefined) {
        if (typeof data.statusTo !== 'string' || !VALID_STATUSES.includes(data.statusTo)) {
          throw new AlertValidationError(
            `statusTo must be one of: ${VALID_STATUSES.join(', ')}`,
            'condition'
          );
        }
        result.statusTo = data.statusTo;
      }
      break;

    case 'status_is':
      if (!data.status || typeof data.status !== 'string') {
        throw new AlertValidationError('status is required for status_is condition', 'condition');
      }
      if (!VALID_STATUSES.includes(data.status)) {
        throw new AlertValidationError(
          `status must be one of: ${VALID_STATUSES.join(', ')}`,
          'condition'
        );
      }
      result.status = data.status;

      if (data.durationSeconds !== undefined) {
        if (typeof data.durationSeconds !== 'number' || data.durationSeconds < 0) {
          throw new AlertValidationError('durationSeconds must be a non-negative number', 'condition');
        }
        result.durationSeconds = data.durationSeconds;
      }
      break;

    case 'health_unhealthy':
      // No additional required fields
      if (data.durationSeconds !== undefined) {
        if (typeof data.durationSeconds !== 'number' || data.durationSeconds < 0) {
          throw new AlertValidationError('durationSeconds must be a non-negative number', 'condition');
        }
        result.durationSeconds = data.durationSeconds;
      }
      break;

    case 'restart_count':
      if (data.threshold === undefined || typeof data.threshold !== 'number') {
        throw new AlertValidationError('threshold is required for restart_count condition', 'condition');
      }
      if (data.threshold < 1) {
        throw new AlertValidationError('threshold must be at least 1', 'condition');
      }
      result.threshold = data.threshold;

      if (data.timeWindowSeconds !== undefined) {
        if (typeof data.timeWindowSeconds !== 'number' || data.timeWindowSeconds < 60) {
          throw new AlertValidationError('timeWindowSeconds must be at least 60', 'condition');
        }
        result.timeWindowSeconds = data.timeWindowSeconds;
      }
      break;

    case 'offline_duration':
      if (data.durationSeconds === undefined || typeof data.durationSeconds !== 'number') {
        throw new AlertValidationError('durationSeconds is required for offline_duration condition', 'condition');
      }
      if (data.durationSeconds < 1) {
        throw new AlertValidationError('durationSeconds must be at least 1', 'condition');
      }
      result.durationSeconds = data.durationSeconds;
      break;

    case 'schedule_failed':
      // No additional required fields
      break;
  }

  return result;
}

/**
 * Validate alert rule creation input
 */
export function validateAlertRuleCreate(input: unknown): AlertRuleCreate {
  if (!input || typeof input !== 'object') {
    throw new AlertValidationError('Input must be an object');
  }

  const data = input as Record<string, unknown>;

  // Name validation
  if (!data.name || typeof data.name !== 'string') {
    throw new AlertValidationError('name is required and must be a string', 'name');
  }

  const name = data.name.trim();
  if (name.length === 0) {
    throw new AlertValidationError('name cannot be empty', 'name');
  }
  if (name.length > 100) {
    throw new AlertValidationError('name cannot exceed 100 characters', 'name');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_\- ]*$/.test(name)) {
    throw new AlertValidationError('name must start with alphanumeric and contain only alphanumeric, underscore, hyphen, or space', 'name');
  }

  // Description validation (optional)
  let description: string | undefined;
  if (data.description !== undefined) {
    if (typeof data.description !== 'string') {
      throw new AlertValidationError('description must be a string', 'description');
    }
    description = data.description.trim() || undefined;
    if (description && description.length > 500) {
      throw new AlertValidationError('description cannot exceed 500 characters', 'description');
    }
  }

  // Enabled validation
  let enabled = ALERT_RULE_DEFAULTS.enabled!;
  if (data.enabled !== undefined) {
    if (typeof data.enabled !== 'boolean') {
      throw new AlertValidationError('enabled must be a boolean', 'enabled');
    }
    enabled = data.enabled;
  }

  // Target type validation
  if (!data.targetType || typeof data.targetType !== 'string') {
    throw new AlertValidationError('targetType is required', 'targetType');
  }
  if (!VALID_TARGET_TYPES.includes(data.targetType as AlertTargetType)) {
    throw new AlertValidationError(
      `targetType must be one of: ${VALID_TARGET_TYPES.join(', ')}`,
      'targetType'
    );
  }
  const targetType = data.targetType as AlertTargetType;

  // Target ID validation (optional)
  let targetId: string | undefined;
  if (data.targetId !== undefined) {
    if (typeof data.targetId !== 'string') {
      throw new AlertValidationError('targetId must be a string', 'targetId');
    }
    targetId = data.targetId.trim() || undefined;
  }

  // Condition validation
  const condition = validateCondition(data.condition);

  // Severity validation
  let severity = ALERT_RULE_DEFAULTS.severity!;
  if (data.severity !== undefined) {
    if (typeof data.severity !== 'string') {
      throw new AlertValidationError('severity must be a string', 'severity');
    }
    if (!VALID_SEVERITIES.includes(data.severity as AlertSeverity)) {
      throw new AlertValidationError(
        `severity must be one of: ${VALID_SEVERITIES.join(', ')}`,
        'severity'
      );
    }
    severity = data.severity as AlertSeverity;
  }

  // Notifications validation
  let notifications: NotificationChannel[] = [];
  if (data.notifications !== undefined) {
    if (!Array.isArray(data.notifications)) {
      throw new AlertValidationError('notifications must be an array', 'notifications');
    }
    notifications = data.notifications.map(validateNotificationChannel);
  }

  // Cooldown validation
  let cooldownMinutes = ALERT_RULE_DEFAULTS.cooldownMinutes!;
  if (data.cooldownMinutes !== undefined) {
    if (typeof data.cooldownMinutes !== 'number' || data.cooldownMinutes < 0) {
      throw new AlertValidationError('cooldownMinutes must be a non-negative number', 'cooldownMinutes');
    }
    cooldownMinutes = data.cooldownMinutes;
  }

  return {
    name,
    description,
    enabled,
    targetType,
    targetId,
    condition,
    severity,
    notifications,
    cooldownMinutes
  };
}

/**
 * Validate partial alert rule update input
 */
export function validateAlertRuleUpdate(input: unknown): AlertRuleUpdate {
  if (!input || typeof input !== 'object') {
    throw new AlertValidationError('Input must be an object');
  }

  const data = input as Record<string, unknown>;
  const result: AlertRuleUpdate = {};

  // Name validation
  if (data.name !== undefined) {
    if (typeof data.name !== 'string') {
      throw new AlertValidationError('name must be a string', 'name');
    }
    const name = data.name.trim();
    if (name.length === 0) {
      throw new AlertValidationError('name cannot be empty', 'name');
    }
    if (name.length > 100) {
      throw new AlertValidationError('name cannot exceed 100 characters', 'name');
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_\- ]*$/.test(name)) {
      throw new AlertValidationError('name must start with alphanumeric and contain only alphanumeric, underscore, hyphen, or space', 'name');
    }
    result.name = name;
  }

  // Description validation
  if (data.description !== undefined) {
    if (data.description !== null && typeof data.description !== 'string') {
      throw new AlertValidationError('description must be a string or null', 'description');
    }
    const desc = typeof data.description === 'string' ? data.description.trim() : undefined;
    if (desc && desc.length > 500) {
      throw new AlertValidationError('description cannot exceed 500 characters', 'description');
    }
    result.description = desc || undefined;
  }

  // Enabled validation
  if (data.enabled !== undefined) {
    if (typeof data.enabled !== 'boolean') {
      throw new AlertValidationError('enabled must be a boolean', 'enabled');
    }
    result.enabled = data.enabled;
  }

  // Target type validation
  if (data.targetType !== undefined) {
    if (typeof data.targetType !== 'string') {
      throw new AlertValidationError('targetType must be a string', 'targetType');
    }
    if (!VALID_TARGET_TYPES.includes(data.targetType as AlertTargetType)) {
      throw new AlertValidationError(
        `targetType must be one of: ${VALID_TARGET_TYPES.join(', ')}`,
        'targetType'
      );
    }
    result.targetType = data.targetType as AlertTargetType;
  }

  // Target ID validation
  if (data.targetId !== undefined) {
    if (data.targetId !== null && typeof data.targetId !== 'string') {
      throw new AlertValidationError('targetId must be a string or null', 'targetId');
    }
    result.targetId = typeof data.targetId === 'string' ? data.targetId.trim() || undefined : undefined;
  }

  // Condition validation
  if (data.condition !== undefined) {
    result.condition = validateCondition(data.condition);
  }

  // Severity validation
  if (data.severity !== undefined) {
    if (typeof data.severity !== 'string') {
      throw new AlertValidationError('severity must be a string', 'severity');
    }
    if (!VALID_SEVERITIES.includes(data.severity as AlertSeverity)) {
      throw new AlertValidationError(
        `severity must be one of: ${VALID_SEVERITIES.join(', ')}`,
        'severity'
      );
    }
    result.severity = data.severity as AlertSeverity;
  }

  // Notifications validation
  if (data.notifications !== undefined) {
    if (!Array.isArray(data.notifications)) {
      throw new AlertValidationError('notifications must be an array', 'notifications');
    }
    result.notifications = data.notifications.map(validateNotificationChannel);
  }

  // Cooldown validation
  if (data.cooldownMinutes !== undefined) {
    if (typeof data.cooldownMinutes !== 'number' || data.cooldownMinutes < 0) {
      throw new AlertValidationError('cooldownMinutes must be a non-negative number', 'cooldownMinutes');
    }
    result.cooldownMinutes = data.cooldownMinutes;
  }

  return result;
}

/**
 * Generate human-readable message for alert condition
 */
export function formatAlertMessage(
  rule: AlertRule,
  targetName: string,
  details?: Record<string, unknown>
): string {
  const { condition, severity, targetType } = rule;

  switch (condition.type) {
    case 'status_changed':
      if (condition.statusFrom && condition.statusTo) {
        return `[${severity.toUpperCase()}] ${targetType} "${targetName}" status changed from ${condition.statusFrom} to ${condition.statusTo}`;
      }
      if (condition.statusTo) {
        return `[${severity.toUpperCase()}] ${targetType} "${targetName}" status changed to ${condition.statusTo}`;
      }
      return `[${severity.toUpperCase()}] ${targetType} "${targetName}" status changed`;

    case 'status_is':
      const duration = condition.durationSeconds
        ? ` for ${formatDuration(condition.durationSeconds)}`
        : '';
      return `[${severity.toUpperCase()}] ${targetType} "${targetName}" has been ${condition.status}${duration}`;

    case 'health_unhealthy':
      return `[${severity.toUpperCase()}] ${targetType} "${targetName}" health check is unhealthy`;

    case 'restart_count':
      const restarts = details?.restartCount ?? condition.threshold;
      const window = condition.timeWindowSeconds
        ? ` in the last ${formatDuration(condition.timeWindowSeconds)}`
        : '';
      return `[${severity.toUpperCase()}] ${targetType} "${targetName}" has restarted ${restarts} times${window}`;

    case 'offline_duration':
      return `[${severity.toUpperCase()}] ${targetType} "${targetName}" has been offline for ${formatDuration(condition.durationSeconds!)}`;

    case 'schedule_failed':
      const error = details?.error ?? 'unknown error';
      return `[${severity.toUpperCase()}] Scheduled action for ${targetType} "${targetName}" failed: ${error}`;

    default:
      return `[${severity.toUpperCase()}] Alert triggered for ${targetType} "${targetName}"`;
  }
}

/**
 * Format duration in seconds to human-readable string
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins} minute${mins !== 1 ? 's' : ''}`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (mins === 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  return `${hours} hour${hours !== 1 ? 's' : ''} ${mins} minute${mins !== 1 ? 's' : ''}`;
}
