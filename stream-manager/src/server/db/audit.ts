import { getDatabase } from './index.js';
import { User } from '../auth/types.js';

export interface AuditEntry {
  id: number;
  timestamp: string;
  userId: string;
  username: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  result: 'success' | 'failure';
  error?: string;
}

interface AuditRow {
  id: number;
  timestamp: string;
  user_id: string;
  username: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: string | null;
  result: string;
  error: string | null;
}

interface CountRow {
  count: number;
}

export function logAuditEvent(
  user: User,
  action: string,
  options: {
    resourceType?: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    result?: 'success' | 'failure';
    error?: string;
  } = {}
) {
  const db = getDatabase();

  db.prepare(`
    INSERT INTO audit_log (user_id, username, action, resource_type, resource_id, details, result, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    user.username,
    action,
    options.resourceType || null,
    options.resourceId || null,
    options.details ? JSON.stringify(options.details) : null,
    options.result || 'success',
    options.error || null
  );
}

export function queryAuditLog(options: {
  limit?: number;
  offset?: number;
  userId?: string;
  action?: string;
  resourceType?: string;
  since?: string;
}): { entries: AuditEntry[]; total: number } {
  const db = getDatabase();

  let where = '1=1';
  const params: (string | number)[] = [];

  if (options.userId) {
    where += ' AND user_id = ?';
    params.push(options.userId);
  }
  if (options.action) {
    where += ' AND action = ?';
    params.push(options.action);
  }
  if (options.resourceType) {
    where += ' AND resource_type = ?';
    params.push(options.resourceType);
  }
  if (options.since) {
    where += ' AND timestamp >= ?';
    params.push(options.since);
  }

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM audit_log WHERE ${where}`).get(...params) as CountRow;
  const total = countRow.count;

  const limit = options.limit || 100;
  const offset = options.offset || 0;

  const rows = db.prepare(`
    SELECT * FROM audit_log
    WHERE ${where}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as AuditRow[];

  return {
    entries: rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      userId: row.user_id,
      username: row.username,
      action: row.action,
      resourceType: row.resource_type || undefined,
      resourceId: row.resource_id || undefined,
      details: row.details ? JSON.parse(row.details) : undefined,
      result: row.result as 'success' | 'failure',
      error: row.error || undefined
    })),
    total
  };
}
