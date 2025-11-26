/**
 * Alert Storage
 * CRUD operations for alert rules and events in SQLite
 */

import { randomUUID } from 'crypto';
import { getDatabase } from '../db/index.js';
import { User } from '../auth/types.js';
import {
  AlertRule,
  AlertRuleCreate,
  AlertRuleUpdate,
  AlertEvent,
  AlertValidationError,
  AlertTargetType,
  AlertSeverity,
  AlertCondition,
  NotificationChannel
} from './schema.js';

/**
 * Database row representation for alert rules
 */
interface AlertRuleRow {
  id: string;
  name: string;
  description: string | null;
  enabled: number;
  target_type: string;
  target_id: string | null;
  condition: string;  // JSON
  severity: string;
  notifications: string;  // JSON array
  cooldown_minutes: number;
  last_triggered: string | null;
  last_notified: string | null;
  trigger_count: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string | null;
}

/**
 * Database row representation for alert events
 */
interface AlertEventRow {
  id: string;
  rule_id: string;
  rule_name: string;
  severity: string;
  target_type: string;
  target_id: string;
  target_name: string;
  condition: string;  // JSON
  message: string;
  details: string | null;  // JSON
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface CountRow {
  count: number;
}

/**
 * Convert database row to AlertRule
 */
function rowToAlertRule(row: AlertRuleRow): AlertRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    enabled: Boolean(row.enabled),
    targetType: row.target_type as AlertTargetType,
    targetId: row.target_id || undefined,
    condition: JSON.parse(row.condition) as AlertCondition,
    severity: row.severity as AlertSeverity,
    notifications: JSON.parse(row.notifications) as NotificationChannel[],
    cooldownMinutes: row.cooldown_minutes,
    lastTriggered: row.last_triggered || undefined,
    lastNotified: row.last_notified || undefined,
    triggerCount: row.trigger_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by || undefined
  };
}

/**
 * Convert database row to AlertEvent
 */
function rowToAlertEvent(row: AlertEventRow): AlertEvent {
  return {
    id: row.id,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    severity: row.severity as AlertSeverity,
    targetType: row.target_type as AlertTargetType,
    targetId: row.target_id,
    targetName: row.target_name,
    condition: JSON.parse(row.condition) as AlertCondition,
    message: row.message,
    details: row.details ? JSON.parse(row.details) : undefined,
    acknowledgedAt: row.acknowledged_at || undefined,
    acknowledgedBy: row.acknowledged_by || undefined,
    resolvedAt: row.resolved_at || undefined,
    createdAt: row.created_at
  };
}

// =============================================================================
// Alert Rules CRUD
// =============================================================================

/**
 * Create a new alert rule
 */
export function createAlertRule(
  config: AlertRuleCreate,
  user: User
): AlertRule {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();

  // Check for duplicate name
  const existing = db.prepare('SELECT id FROM alert_rules WHERE name = ?').get(config.name);
  if (existing) {
    throw new AlertValidationError(
      `An alert rule with name "${config.name}" already exists`,
      'name'
    );
  }

  const stmt = db.prepare(`
    INSERT INTO alert_rules (
      id, name, description, enabled,
      target_type, target_id,
      condition, severity, notifications, cooldown_minutes,
      trigger_count,
      created_at, updated_at, created_by
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
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
    config.targetId || null,
    JSON.stringify(config.condition),
    config.severity,
    JSON.stringify(config.notifications),
    config.cooldownMinutes,
    0,  // trigger_count starts at 0
    now,
    now,
    user.id
  );

  return {
    ...config,
    id,
    triggerCount: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: user.id
  };
}

/**
 * Get an alert rule by ID
 */
export function getAlertRule(id: string): AlertRule | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(id) as AlertRuleRow | undefined;
  return row ? rowToAlertRule(row) : null;
}

/**
 * Get an alert rule by name
 */
export function getAlertRuleByName(name: string): AlertRule | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM alert_rules WHERE name = ?').get(name) as AlertRuleRow | undefined;
  return row ? rowToAlertRule(row) : null;
}

/**
 * List alert rules with optional filters
 */
export function listAlertRules(options: {
  enabled?: boolean;
  targetType?: AlertTargetType;
  targetId?: string;
  severity?: AlertSeverity;
  limit?: number;
  offset?: number;
} = {}): { rules: AlertRule[]; total: number } {
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

  if (options.severity !== undefined) {
    where += ' AND severity = ?';
    params.push(options.severity);
  }

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM alert_rules WHERE ${where}`).get(...params) as CountRow;
  const total = countRow.count;

  const limit = options.limit || 100;
  const offset = options.offset || 0;

  const rows = db.prepare(`
    SELECT * FROM alert_rules
    WHERE ${where}
    ORDER BY name ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as AlertRuleRow[];

  return {
    rules: rows.map(rowToAlertRule),
    total
  };
}

/**
 * Get all enabled alert rules (for evaluator)
 */
export function getEnabledAlertRules(): AlertRule[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM alert_rules WHERE enabled = 1').all() as AlertRuleRow[];
  return rows.map(rowToAlertRule);
}

/**
 * Get alert rules for a specific target
 */
export function getAlertRulesForTarget(targetType: AlertTargetType, targetId: string): AlertRule[] {
  const db = getDatabase();

  // Match rules that:
  // 1. Target this specific resource OR
  // 2. Target all resources of this type (target_id is null) OR
  // 3. Target 'any' type (with null target_id)
  const rows = db.prepare(`
    SELECT * FROM alert_rules
    WHERE enabled = 1
    AND (
      (target_type = ? AND target_id = ?)
      OR (target_type = ? AND target_id IS NULL)
      OR (target_type = 'any' AND target_id IS NULL)
    )
    ORDER BY severity DESC, name ASC
  `).all(targetType, targetId, targetType) as AlertRuleRow[];

  return rows.map(rowToAlertRule);
}

/**
 * Update an alert rule
 */
export function updateAlertRule(
  id: string,
  updates: AlertRuleUpdate,
  user: User
): AlertRule {
  const db = getDatabase();

  // Check if rule exists
  const existing = getAlertRule(id);
  if (!existing) {
    throw new AlertValidationError(
      `Alert rule with ID "${id}" not found`,
      'id'
    );
  }

  // Check for duplicate name if name is being changed
  if (updates.name && updates.name !== existing.name) {
    const nameCheck = db.prepare('SELECT id FROM alert_rules WHERE name = ? AND id != ?').get(updates.name, id);
    if (nameCheck) {
      throw new AlertValidationError(
        `An alert rule with name "${updates.name}" already exists`,
        'name'
      );
    }
  }

  const now = new Date().toISOString();

  // Build UPDATE statement dynamically
  const setClauses: string[] = ['updated_at = ?', 'updated_by = ?'];
  const values: (string | number | null)[] = [now, user.id];

  if (updates.name !== undefined) {
    setClauses.push('name = ?');
    values.push(updates.name);
  }

  if (updates.description !== undefined) {
    setClauses.push('description = ?');
    values.push(updates.description || null);
  }

  if (updates.enabled !== undefined) {
    setClauses.push('enabled = ?');
    values.push(updates.enabled ? 1 : 0);
  }

  if (updates.targetType !== undefined) {
    setClauses.push('target_type = ?');
    values.push(updates.targetType);
  }

  if (updates.targetId !== undefined) {
    setClauses.push('target_id = ?');
    values.push(updates.targetId || null);
  }

  if (updates.condition !== undefined) {
    setClauses.push('condition = ?');
    values.push(JSON.stringify(updates.condition));
  }

  if (updates.severity !== undefined) {
    setClauses.push('severity = ?');
    values.push(updates.severity);
  }

  if (updates.notifications !== undefined) {
    setClauses.push('notifications = ?');
    values.push(JSON.stringify(updates.notifications));
  }

  if (updates.cooldownMinutes !== undefined) {
    setClauses.push('cooldown_minutes = ?');
    values.push(updates.cooldownMinutes);
  }

  values.push(id);

  db.prepare(`
    UPDATE alert_rules
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `).run(...values);

  return getAlertRule(id)!;
}

/**
 * Delete an alert rule
 */
export function deleteAlertRule(id: string): boolean {
  const db = getDatabase();

  // Check if rule exists
  const existing = getAlertRule(id);
  if (!existing) {
    return false;
  }

  // Delete the rule (events are kept for history)
  const result = db.prepare('DELETE FROM alert_rules WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Record that an alert was triggered
 */
export function recordAlertTriggered(
  ruleId: string,
  notified: boolean
): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const updates = notified
    ? 'last_triggered = ?, last_notified = ?, trigger_count = trigger_count + 1, updated_at = ?'
    : 'last_triggered = ?, trigger_count = trigger_count + 1, updated_at = ?';

  const values = notified ? [now, now, now, ruleId] : [now, now, ruleId];

  db.prepare(`
    UPDATE alert_rules
    SET ${updates}
    WHERE id = ?
  `).run(...values);
}

// =============================================================================
// Alert Events CRUD
// =============================================================================

/**
 * Create a new alert event
 */
export function createAlertEvent(
  event: Omit<AlertEvent, 'id' | 'createdAt'>
): AlertEvent {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO alert_events (
      id, rule_id, rule_name, severity,
      target_type, target_id, target_name,
      condition, message, details,
      acknowledged_at, acknowledged_by, resolved_at,
      created_at
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?
    )
  `);

  stmt.run(
    id,
    event.ruleId,
    event.ruleName,
    event.severity,
    event.targetType,
    event.targetId,
    event.targetName,
    JSON.stringify(event.condition),
    event.message,
    event.details ? JSON.stringify(event.details) : null,
    event.acknowledgedAt || null,
    event.acknowledgedBy || null,
    event.resolvedAt || null,
    now
  );

  return {
    ...event,
    id,
    createdAt: now
  };
}

/**
 * Get an alert event by ID
 */
export function getAlertEvent(id: string): AlertEvent | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM alert_events WHERE id = ?').get(id) as AlertEventRow | undefined;
  return row ? rowToAlertEvent(row) : null;
}

/**
 * List alert events with optional filters
 */
export function listAlertEvents(options: {
  ruleId?: string;
  targetType?: AlertTargetType;
  targetId?: string;
  severity?: AlertSeverity;
  acknowledged?: boolean;
  resolved?: boolean;
  since?: string;  // ISO timestamp
  limit?: number;
  offset?: number;
} = {}): { events: AlertEvent[]; total: number } {
  const db = getDatabase();

  let where = '1=1';
  const params: (string | number)[] = [];

  if (options.ruleId !== undefined) {
    where += ' AND rule_id = ?';
    params.push(options.ruleId);
  }

  if (options.targetType !== undefined) {
    where += ' AND target_type = ?';
    params.push(options.targetType);
  }

  if (options.targetId !== undefined) {
    where += ' AND target_id = ?';
    params.push(options.targetId);
  }

  if (options.severity !== undefined) {
    where += ' AND severity = ?';
    params.push(options.severity);
  }

  if (options.acknowledged !== undefined) {
    where += options.acknowledged
      ? ' AND acknowledged_at IS NOT NULL'
      : ' AND acknowledged_at IS NULL';
  }

  if (options.resolved !== undefined) {
    where += options.resolved
      ? ' AND resolved_at IS NOT NULL'
      : ' AND resolved_at IS NULL';
  }

  if (options.since !== undefined) {
    where += ' AND created_at >= ?';
    params.push(options.since);
  }

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM alert_events WHERE ${where}`).get(...params) as CountRow;
  const total = countRow.count;

  const limit = options.limit || 100;
  const offset = options.offset || 0;

  const rows = db.prepare(`
    SELECT * FROM alert_events
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as AlertEventRow[];

  return {
    events: rows.map(rowToAlertEvent),
    total
  };
}

/**
 * Get unacknowledged events count
 */
export function getUnacknowledgedEventCount(): number {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT COUNT(*) as count FROM alert_events WHERE acknowledged_at IS NULL'
  ).get() as CountRow;
  return row.count;
}

/**
 * Get active (unresolved) events
 */
export function getActiveEvents(): AlertEvent[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM alert_events
    WHERE resolved_at IS NULL
    ORDER BY created_at DESC
  `).all() as AlertEventRow[];
  return rows.map(rowToAlertEvent);
}

/**
 * Acknowledge an alert event
 */
export function acknowledgeAlertEvent(
  id: string,
  user: User
): AlertEvent | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const result = db.prepare(`
    UPDATE alert_events
    SET acknowledged_at = ?, acknowledged_by = ?
    WHERE id = ? AND acknowledged_at IS NULL
  `).run(now, user.id, id);

  if (result.changes === 0) {
    return null;
  }

  return getAlertEvent(id);
}

/**
 * Resolve an alert event
 */
export function resolveAlertEvent(id: string): AlertEvent | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const result = db.prepare(`
    UPDATE alert_events
    SET resolved_at = ?
    WHERE id = ? AND resolved_at IS NULL
  `).run(now, id);

  if (result.changes === 0) {
    return null;
  }

  return getAlertEvent(id);
}

/**
 * Bulk acknowledge events
 */
export function acknowledgeAllEvents(user: User): number {
  const db = getDatabase();
  const now = new Date().toISOString();

  const result = db.prepare(`
    UPDATE alert_events
    SET acknowledged_at = ?, acknowledged_by = ?
    WHERE acknowledged_at IS NULL
  `).run(now, user.id);

  return result.changes;
}

/**
 * Delete old events (for cleanup)
 */
export function deleteOldEvents(olderThan: string): number {
  const db = getDatabase();
  const result = db.prepare(`
    DELETE FROM alert_events
    WHERE created_at < ? AND resolved_at IS NOT NULL
  `).run(olderThan);
  return result.changes;
}

/**
 * Get recent events for a rule (for cooldown check)
 */
export function getRecentEventsForRule(
  ruleId: string,
  sinceTimestamp: string
): AlertEvent[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM alert_events
    WHERE rule_id = ? AND created_at >= ?
    ORDER BY created_at DESC
  `).all(ruleId, sinceTimestamp) as AlertEventRow[];
  return rows.map(rowToAlertEvent);
}

// =============================================================================
// Metrics helpers
// =============================================================================

/**
 * Get total count of alert rules
 */
export function getAlertRuleCount(): number {
  const db = getDatabase();
  const row = db.prepare('SELECT COUNT(*) as count FROM alert_rules').get() as CountRow;
  return row.count;
}

/**
 * Get alert event counts grouped by state
 */
export function getAlertEventCountByState(): Record<string, number> {
  const db = getDatabase();

  // Count by state: active (unresolved), acknowledged, resolved
  const active = db.prepare(
    'SELECT COUNT(*) as count FROM alert_events WHERE resolved_at IS NULL AND acknowledged_at IS NULL'
  ).get() as CountRow;

  const acknowledged = db.prepare(
    'SELECT COUNT(*) as count FROM alert_events WHERE resolved_at IS NULL AND acknowledged_at IS NOT NULL'
  ).get() as CountRow;

  const resolved = db.prepare(
    'SELECT COUNT(*) as count FROM alert_events WHERE resolved_at IS NOT NULL'
  ).get() as CountRow;

  return {
    active: active.count,
    acknowledged: acknowledged.count,
    resolved: resolved.count
  };
}
