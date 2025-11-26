/**
 * Schedule Storage
 * CRUD operations for schedules in SQLite
 */

import { randomUUID } from 'crypto';
import { getDatabase } from '../db/index.js';
import { User } from '../auth/types.js';
import {
  Schedule,
  ScheduleCreate,
  ScheduleUpdate,
  ScheduleValidationError,
  ScheduleTargetType,
  ScheduleAction,
  calculateNextRun
} from './schema.js';

/**
 * Database row representation
 */
interface ScheduleRow {
  id: string;
  name: string;
  description: string | null;
  enabled: number;
  target_type: string;
  target_id: string;
  action: string;
  cron_expression: string;
  timezone: string;
  last_run: string | null;
  next_run: string | null;
  last_run_result: string | null;
  last_run_error: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string | null;
}

interface CountRow {
  count: number;
}

/**
 * Convert database row to Schedule
 */
function rowToSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    enabled: Boolean(row.enabled),
    targetType: row.target_type as ScheduleTargetType,
    targetId: row.target_id,
    action: row.action as ScheduleAction,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    lastRun: row.last_run || undefined,
    nextRun: row.next_run || undefined,
    lastRunResult: row.last_run_result as 'success' | 'failure' | undefined,
    lastRunError: row.last_run_error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by || undefined
  };
}

/**
 * Validate that the target exists
 */
function validateTargetExists(targetType: ScheduleTargetType, targetId: string): void {
  const db = getDatabase();

  let table: string;
  switch (targetType) {
    case 'stream':
      table = 'stream_configs';
      break;
    case 'group':
      table = 'stream_groups';
      break;
    case 'compositor':
      table = 'compositors';
      break;
  }

  const exists = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(targetId);
  if (!exists) {
    throw new ScheduleValidationError(
      `${targetType} with ID "${targetId}" not found`,
      'targetId'
    );
  }
}

/**
 * Create a new schedule
 */
export function createSchedule(
  config: ScheduleCreate,
  user: User
): Schedule {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();

  // Check for duplicate name
  const existing = db.prepare('SELECT id FROM schedules WHERE name = ?').get(config.name);
  if (existing) {
    throw new ScheduleValidationError(
      `A schedule with name "${config.name}" already exists`,
      'name'
    );
  }

  // Validate target exists
  validateTargetExists(config.targetType, config.targetId);

  // Calculate next run time
  const nextRun = config.enabled ? calculateNextRun(config.cronExpression, config.timezone) : null;

  const stmt = db.prepare(`
    INSERT INTO schedules (
      id, name, description, enabled,
      target_type, target_id, action,
      cron_expression, timezone,
      next_run,
      created_at, updated_at, created_by
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?,
      ?, ?, ?
    )
  `);

  stmt.run(
    id,
    config.name,
    config.description || null,
    config.enabled ? 1 : 0,
    config.targetType,
    config.targetId,
    config.action,
    config.cronExpression,
    config.timezone,
    nextRun,
    now,
    now,
    user.id
  );

  return {
    ...config,
    id,
    nextRun: nextRun || undefined,
    createdAt: now,
    updatedAt: now,
    createdBy: user.id
  };
}

/**
 * Get a schedule by ID
 */
export function getSchedule(id: string): Schedule | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | undefined;
  return row ? rowToSchedule(row) : null;
}

/**
 * Get a schedule by name
 */
export function getScheduleByName(name: string): Schedule | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM schedules WHERE name = ?').get(name) as ScheduleRow | undefined;
  return row ? rowToSchedule(row) : null;
}

/**
 * List schedules with optional filters
 */
export function listSchedules(options: {
  enabled?: boolean;
  targetType?: ScheduleTargetType;
  targetId?: string;
  limit?: number;
  offset?: number;
} = {}): { schedules: Schedule[]; total: number } {
  const db = getDatabase();

  let where = '1=1';
  const params: (string | number)[] = [];

  if (options.enabled !== undefined) {
    where += ' AND enabled = ?';
    params.push(options.enabled ? 1 : 0);
  }

  if (options.targetType !== undefined) {
    where += ' AND target_type = ?';
    params.push(options.targetType);
  }

  if (options.targetId !== undefined) {
    where += ' AND target_id = ?';
    params.push(options.targetId);
  }

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM schedules WHERE ${where}`).get(...params) as CountRow;
  const total = countRow.count;

  const limit = options.limit || 100;
  const offset = options.offset || 0;

  const rows = db.prepare(`
    SELECT * FROM schedules
    WHERE ${where}
    ORDER BY name ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as ScheduleRow[];

  return {
    schedules: rows.map(rowToSchedule),
    total
  };
}

/**
 * Update a schedule
 */
export function updateSchedule(
  id: string,
  updates: ScheduleUpdate,
  user: User
): Schedule {
  const db = getDatabase();

  // Check if schedule exists
  const existing = getSchedule(id);
  if (!existing) {
    throw new ScheduleValidationError(
      `Schedule with ID "${id}" not found`,
      'id'
    );
  }

  // Check for duplicate name if name is being changed
  if (updates.name && updates.name !== existing.name) {
    const nameCheck = db.prepare('SELECT id FROM schedules WHERE name = ? AND id != ?').get(updates.name, id);
    if (nameCheck) {
      throw new ScheduleValidationError(
        `A schedule with name "${updates.name}" already exists`,
        'name'
      );
    }
  }

  // Validate target exists if being changed
  const newTargetType = updates.targetType ?? existing.targetType;
  const newTargetId = updates.targetId ?? existing.targetId;
  if (updates.targetType !== undefined || updates.targetId !== undefined) {
    validateTargetExists(newTargetType, newTargetId);
  }

  const now = new Date().toISOString();

  // Build UPDATE statement dynamically
  const setClauses: string[] = ['updated_at = ?', 'updated_by = ?'];
  const values: (string | number | null)[] = [now, user.id];

  const fieldMap: Record<string, string> = {
    name: 'name',
    description: 'description',
    enabled: 'enabled',
    targetType: 'target_type',
    targetId: 'target_id',
    action: 'action',
    cronExpression: 'cron_expression',
    timezone: 'timezone'
  };

  for (const [jsField, dbField] of Object.entries(fieldMap)) {
    const key = jsField as keyof ScheduleUpdate;
    if (updates[key] !== undefined) {
      setClauses.push(`${dbField} = ?`);
      const rawValue = updates[key];

      // Handle special cases
      let dbValue: string | number | null;
      if (key === 'enabled') {
        dbValue = rawValue ? 1 : 0;
      } else if (rawValue === undefined) {
        dbValue = null;
      } else {
        dbValue = rawValue as string | number;
      }

      values.push(dbValue);
    }
  }

  // Recalculate next run if cron, timezone, or enabled changed
  const newEnabled = updates.enabled ?? existing.enabled;
  const newCron = updates.cronExpression ?? existing.cronExpression;
  const newTimezone = updates.timezone ?? existing.timezone;

  if (updates.cronExpression !== undefined || updates.timezone !== undefined || updates.enabled !== undefined) {
    const nextRun = newEnabled ? calculateNextRun(newCron, newTimezone) : null;
    setClauses.push('next_run = ?');
    values.push(nextRun);
  }

  values.push(id);

  db.prepare(`
    UPDATE schedules
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `).run(...values);

  return getSchedule(id)!;
}

/**
 * Delete a schedule
 */
export function deleteSchedule(id: string): boolean {
  const db = getDatabase();

  // Check if schedule exists
  const existing = getSchedule(id);
  if (!existing) {
    return false;
  }

  // Delete the schedule
  const result = db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Get all enabled schedules that need to run
 */
export function getDueSchedules(): Schedule[] {
  const db = getDatabase();
  const now = new Date().toISOString();

  const rows = db.prepare(`
    SELECT * FROM schedules
    WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run ASC
  `).all(now) as ScheduleRow[];

  return rows.map(rowToSchedule);
}

/**
 * Update schedule after execution
 */
export function recordScheduleExecution(
  id: string,
  result: 'success' | 'failure',
  error?: string
): void {
  const db = getDatabase();
  const schedule = getSchedule(id);
  if (!schedule) return;

  const now = new Date().toISOString();
  const nextRun = schedule.enabled ? calculateNextRun(schedule.cronExpression, schedule.timezone) : null;

  db.prepare(`
    UPDATE schedules
    SET last_run = ?, next_run = ?, last_run_result = ?, last_run_error = ?, updated_at = ?
    WHERE id = ?
  `).run(now, nextRun, result, error || null, now, id);
}

/**
 * Get schedules for a specific target
 */
export function getSchedulesForTarget(targetType: ScheduleTargetType, targetId: string): Schedule[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT * FROM schedules
    WHERE target_type = ? AND target_id = ?
    ORDER BY name ASC
  `).all(targetType, targetId) as ScheduleRow[];

  return rows.map(rowToSchedule);
}

/**
 * Duplicate a schedule with a new name
 */
export function duplicateSchedule(
  id: string,
  newName: string,
  user: User
): Schedule {
  const existing = getSchedule(id);
  if (!existing) {
    throw new ScheduleValidationError(
      `Schedule with ID "${id}" not found`,
      'id'
    );
  }

  // Create a copy without the metadata fields
  const scheduleCopy: ScheduleCreate = {
    name: newName,
    description: existing.description ? `Copy of ${existing.description}` : undefined,
    enabled: false, // Duplicates start disabled
    targetType: existing.targetType,
    targetId: existing.targetId,
    action: existing.action,
    cronExpression: existing.cronExpression,
    timezone: existing.timezone
  };

  return createSchedule(scheduleCopy, user);
}

/**
 * Get schedule statistics for metrics
 */
export function getScheduleStats(): { total: number; enabled: number; disabled: number } {
  const db = getDatabase();

  const total = db.prepare('SELECT COUNT(*) as count FROM schedules').get() as CountRow;
  const enabled = db.prepare('SELECT COUNT(*) as count FROM schedules WHERE enabled = 1').get() as CountRow;

  return {
    total: total.count,
    enabled: enabled.count,
    disabled: total.count - enabled.count
  };
}
