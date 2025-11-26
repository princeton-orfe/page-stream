/**
 * Schedule Schema
 * Defines the structure for scheduled actions on streams, groups, and compositors.
 */

import cronParser from 'cron-parser';

/**
 * Target type for scheduled action
 */
export type ScheduleTargetType = 'stream' | 'group' | 'compositor';

/**
 * Action to perform
 */
export type ScheduleAction = 'start' | 'stop' | 'refresh';

/**
 * Full schedule configuration interface
 */
export interface Schedule {
  // Identity
  id: string;                           // UUID, generated on create
  name: string;                         // Human-readable name
  description?: string;                 // Optional description
  enabled: boolean;                     // Whether schedule is active

  // Target
  targetType: ScheduleTargetType;       // What type of resource to control
  targetId: string;                     // ID of stream, group, or compositor
  action: ScheduleAction;               // Action to perform

  // Timing
  cronExpression: string;               // Cron expression (5 or 6 fields)
  timezone: string;                     // IANA timezone (e.g., 'America/New_York')

  // Execution tracking
  lastRun?: string;                     // ISO timestamp of last execution
  nextRun?: string;                     // ISO timestamp of next scheduled run
  lastRunResult?: 'success' | 'failure';
  lastRunError?: string;

  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
}

/**
 * Configuration for creating a new schedule
 */
export type ScheduleCreate = Omit<Schedule, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'lastRun' | 'nextRun' | 'lastRunResult' | 'lastRunError'>;

/**
 * Configuration for updating a schedule
 */
export type ScheduleUpdate = Partial<Omit<Schedule, 'id' | 'createdAt' | 'createdBy' | 'lastRun' | 'nextRun' | 'lastRunResult' | 'lastRunError'>>;

/**
 * Default values for schedule configuration
 */
export const SCHEDULE_DEFAULTS: Partial<ScheduleCreate> = {
  enabled: true,
  timezone: 'UTC',
  description: undefined
};

/**
 * Custom validation error for schedules
 */
export class ScheduleValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = 'ScheduleValidationError';
  }
}

/**
 * Valid target types
 */
const VALID_TARGET_TYPES: ScheduleTargetType[] = ['stream', 'group', 'compositor'];

/**
 * Valid actions
 */
const VALID_ACTIONS: ScheduleAction[] = ['start', 'stop', 'refresh'];

/**
 * Common IANA timezones for validation
 */
const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Toronto', 'America/Vancouver', 'America/Sao_Paulo', 'America/Mexico_City',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Amsterdam', 'Europe/Rome',
  'Europe/Madrid', 'Europe/Moscow', 'Europe/Istanbul',
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Seoul',
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Bangkok', 'Asia/Jakarta',
  'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth',
  'Pacific/Auckland', 'Pacific/Fiji',
  'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos'
];

/**
 * Validate cron expression
 */
function validateCronExpression(expression: string): string {
  try {
    // Parse to validate - this will throw if invalid
    cronParser.parseExpression(expression);
    return expression;
  } catch (error) {
    throw new ScheduleValidationError(
      `Invalid cron expression: ${(error as Error).message}`,
      'cronExpression'
    );
  }
}

/**
 * Validate timezone
 */
function validateTimezone(tz: string): string {
  // Allow any timezone that Intl can handle
  try {
    // Test if timezone is valid by trying to format a date with it
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    throw new ScheduleValidationError(
      `Invalid timezone: ${tz}. Use an IANA timezone like "America/New_York" or "UTC"`,
      'timezone'
    );
  }
}

/**
 * Validate schedule creation input
 */
export function validateScheduleCreate(input: unknown): ScheduleCreate {
  if (!input || typeof input !== 'object') {
    throw new ScheduleValidationError('Input must be an object');
  }

  const data = input as Record<string, unknown>;

  // Name validation
  if (!data.name || typeof data.name !== 'string') {
    throw new ScheduleValidationError('name is required and must be a string', 'name');
  }

  const name = data.name.trim();
  if (name.length === 0) {
    throw new ScheduleValidationError('name cannot be empty', 'name');
  }
  if (name.length > 100) {
    throw new ScheduleValidationError('name cannot exceed 100 characters', 'name');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_\- ]*$/.test(name)) {
    throw new ScheduleValidationError('name must start with alphanumeric and contain only alphanumeric, underscore, hyphen, or space', 'name');
  }

  // Description validation (optional)
  let description: string | undefined;
  if (data.description !== undefined) {
    if (typeof data.description !== 'string') {
      throw new ScheduleValidationError('description must be a string', 'description');
    }
    description = data.description.trim() || undefined;
    if (description && description.length > 500) {
      throw new ScheduleValidationError('description cannot exceed 500 characters', 'description');
    }
  }

  // Enabled validation
  let enabled = SCHEDULE_DEFAULTS.enabled!;
  if (data.enabled !== undefined) {
    if (typeof data.enabled !== 'boolean') {
      throw new ScheduleValidationError('enabled must be a boolean', 'enabled');
    }
    enabled = data.enabled;
  }

  // Target type validation
  if (!data.targetType || typeof data.targetType !== 'string') {
    throw new ScheduleValidationError('targetType is required', 'targetType');
  }
  if (!VALID_TARGET_TYPES.includes(data.targetType as ScheduleTargetType)) {
    throw new ScheduleValidationError(
      `targetType must be one of: ${VALID_TARGET_TYPES.join(', ')}`,
      'targetType'
    );
  }
  const targetType = data.targetType as ScheduleTargetType;

  // Target ID validation
  if (!data.targetId || typeof data.targetId !== 'string') {
    throw new ScheduleValidationError('targetId is required', 'targetId');
  }
  const targetId = data.targetId.trim();
  if (targetId.length === 0) {
    throw new ScheduleValidationError('targetId cannot be empty', 'targetId');
  }

  // Action validation
  if (!data.action || typeof data.action !== 'string') {
    throw new ScheduleValidationError('action is required', 'action');
  }
  if (!VALID_ACTIONS.includes(data.action as ScheduleAction)) {
    throw new ScheduleValidationError(
      `action must be one of: ${VALID_ACTIONS.join(', ')}`,
      'action'
    );
  }
  const action = data.action as ScheduleAction;

  // Validate action compatibility with target type
  if (action === 'refresh' && targetType !== 'stream') {
    throw new ScheduleValidationError(
      'refresh action is only valid for stream targets',
      'action'
    );
  }

  // Cron expression validation
  if (!data.cronExpression || typeof data.cronExpression !== 'string') {
    throw new ScheduleValidationError('cronExpression is required', 'cronExpression');
  }
  const cronExpression = validateCronExpression(data.cronExpression.trim());

  // Timezone validation
  let timezone = SCHEDULE_DEFAULTS.timezone!;
  if (data.timezone !== undefined) {
    if (typeof data.timezone !== 'string') {
      throw new ScheduleValidationError('timezone must be a string', 'timezone');
    }
    timezone = validateTimezone(data.timezone.trim());
  }

  return {
    name,
    description,
    enabled,
    targetType,
    targetId,
    action,
    cronExpression,
    timezone
  };
}

/**
 * Validate partial schedule update input
 */
export function validateScheduleUpdate(input: unknown): ScheduleUpdate {
  if (!input || typeof input !== 'object') {
    throw new ScheduleValidationError('Input must be an object');
  }

  const data = input as Record<string, unknown>;
  const result: ScheduleUpdate = {};

  // Name validation
  if (data.name !== undefined) {
    if (typeof data.name !== 'string') {
      throw new ScheduleValidationError('name must be a string', 'name');
    }
    const name = data.name.trim();
    if (name.length === 0) {
      throw new ScheduleValidationError('name cannot be empty', 'name');
    }
    if (name.length > 100) {
      throw new ScheduleValidationError('name cannot exceed 100 characters', 'name');
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_\- ]*$/.test(name)) {
      throw new ScheduleValidationError('name must start with alphanumeric and contain only alphanumeric, underscore, hyphen, or space', 'name');
    }
    result.name = name;
  }

  // Description validation
  if (data.description !== undefined) {
    if (data.description !== null && typeof data.description !== 'string') {
      throw new ScheduleValidationError('description must be a string or null', 'description');
    }
    const desc = typeof data.description === 'string' ? data.description.trim() : undefined;
    if (desc && desc.length > 500) {
      throw new ScheduleValidationError('description cannot exceed 500 characters', 'description');
    }
    result.description = desc || undefined;
  }

  // Enabled validation
  if (data.enabled !== undefined) {
    if (typeof data.enabled !== 'boolean') {
      throw new ScheduleValidationError('enabled must be a boolean', 'enabled');
    }
    result.enabled = data.enabled;
  }

  // Target type validation
  if (data.targetType !== undefined) {
    if (typeof data.targetType !== 'string') {
      throw new ScheduleValidationError('targetType must be a string', 'targetType');
    }
    if (!VALID_TARGET_TYPES.includes(data.targetType as ScheduleTargetType)) {
      throw new ScheduleValidationError(
        `targetType must be one of: ${VALID_TARGET_TYPES.join(', ')}`,
        'targetType'
      );
    }
    result.targetType = data.targetType as ScheduleTargetType;
  }

  // Target ID validation
  if (data.targetId !== undefined) {
    if (typeof data.targetId !== 'string') {
      throw new ScheduleValidationError('targetId must be a string', 'targetId');
    }
    const targetId = data.targetId.trim();
    if (targetId.length === 0) {
      throw new ScheduleValidationError('targetId cannot be empty', 'targetId');
    }
    result.targetId = targetId;
  }

  // Action validation
  if (data.action !== undefined) {
    if (typeof data.action !== 'string') {
      throw new ScheduleValidationError('action must be a string', 'action');
    }
    if (!VALID_ACTIONS.includes(data.action as ScheduleAction)) {
      throw new ScheduleValidationError(
        `action must be one of: ${VALID_ACTIONS.join(', ')}`,
        'action'
      );
    }
    result.action = data.action as ScheduleAction;
  }

  // Cron expression validation
  if (data.cronExpression !== undefined) {
    if (typeof data.cronExpression !== 'string') {
      throw new ScheduleValidationError('cronExpression must be a string', 'cronExpression');
    }
    result.cronExpression = validateCronExpression(data.cronExpression.trim());
  }

  // Timezone validation
  if (data.timezone !== undefined) {
    if (typeof data.timezone !== 'string') {
      throw new ScheduleValidationError('timezone must be a string', 'timezone');
    }
    result.timezone = validateTimezone(data.timezone.trim());
  }

  return result;
}

/**
 * Calculate next run time from cron expression
 */
export function calculateNextRun(cronExpression: string, timezone: string): string {
  const options = {
    currentDate: new Date(),
    tz: timezone
  };
  const interval = cronParser.parseExpression(cronExpression, options);
  return interval.next().toISOString();
}

/**
 * Get list of common timezones for UI selection
 */
export function getCommonTimezones(): string[] {
  return [...COMMON_TIMEZONES];
}
