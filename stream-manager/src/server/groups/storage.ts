/**
 * Stream Group Storage
 * CRUD operations for stream groups in SQLite
 */

import { randomUUID } from 'crypto';
import { getDatabase } from '../db/index.js';
import { User } from '../auth/types.js';
import {
  StreamGroup,
  StreamGroupCreate,
  StreamGroupUpdate,
  StreamGroupValidationError,
  GroupMember,
  GroupStartOrder,
  GroupStopOrder
} from './schema.js';

/**
 * Database row representation
 */
interface StreamGroupRow {
  id: string;
  name: string;
  description: string | null;
  enabled: number;
  members: string;
  start_order: string;
  stop_order: string;
  start_delay_ms: number;
  stop_delay_ms: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string | null;
}

interface CountRow {
  count: number;
}

/**
 * Convert database row to StreamGroup
 */
function rowToGroup(row: StreamGroupRow): StreamGroup {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    enabled: Boolean(row.enabled),
    members: JSON.parse(row.members) as GroupMember[],
    startOrder: row.start_order as GroupStartOrder,
    stopOrder: row.stop_order as GroupStopOrder,
    startDelayMs: row.start_delay_ms,
    stopDelayMs: row.stop_delay_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by || undefined
  };
}

/**
 * Create a new stream group
 */
export function createStreamGroup(
  config: StreamGroupCreate,
  user: User
): StreamGroup {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();

  // Check for duplicate name
  const existing = db.prepare('SELECT id FROM stream_groups WHERE name = ?').get(config.name);
  if (existing) {
    throw new StreamGroupValidationError(
      `A stream group with name "${config.name}" already exists`,
      'name'
    );
  }

  // Validate all stream IDs exist
  for (const member of config.members) {
    const stream = db.prepare('SELECT id FROM stream_configs WHERE id = ?').get(member.streamId);
    if (!stream) {
      throw new StreamGroupValidationError(
        `Stream with ID "${member.streamId}" not found`,
        'members'
      );
    }
  }

  const stmt = db.prepare(`
    INSERT INTO stream_groups (
      id, name, description, enabled, members,
      start_order, stop_order, start_delay_ms, stop_delay_ms,
      created_at, updated_at, created_by
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  stmt.run(
    id,
    config.name,
    config.description || null,
    config.enabled ? 1 : 0,
    JSON.stringify(config.members),
    config.startOrder,
    config.stopOrder,
    config.startDelayMs,
    config.stopDelayMs,
    now,
    now,
    user.id
  );

  return {
    ...config,
    id,
    createdAt: now,
    updatedAt: now,
    createdBy: user.id
  };
}

/**
 * Get a stream group by ID
 */
export function getStreamGroup(id: string): StreamGroup | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM stream_groups WHERE id = ?').get(id) as StreamGroupRow | undefined;
  return row ? rowToGroup(row) : null;
}

/**
 * Get a stream group by name
 */
export function getStreamGroupByName(name: string): StreamGroup | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM stream_groups WHERE name = ?').get(name) as StreamGroupRow | undefined;
  return row ? rowToGroup(row) : null;
}

/**
 * List stream groups with optional filters
 */
export function listStreamGroups(options: {
  enabled?: boolean;
  limit?: number;
  offset?: number;
} = {}): { groups: StreamGroup[]; total: number } {
  const db = getDatabase();

  let where = '1=1';
  const params: (string | number)[] = [];

  if (options.enabled !== undefined) {
    where += ' AND enabled = ?';
    params.push(options.enabled ? 1 : 0);
  }

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM stream_groups WHERE ${where}`).get(...params) as CountRow;
  const total = countRow.count;

  const limit = options.limit || 100;
  const offset = options.offset || 0;

  const rows = db.prepare(`
    SELECT * FROM stream_groups
    WHERE ${where}
    ORDER BY name ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as StreamGroupRow[];

  return {
    groups: rows.map(rowToGroup),
    total
  };
}

/**
 * Update a stream group
 */
export function updateStreamGroup(
  id: string,
  updates: StreamGroupUpdate,
  user: User
): StreamGroup {
  const db = getDatabase();

  // Check if group exists
  const existing = getStreamGroup(id);
  if (!existing) {
    throw new StreamGroupValidationError(
      `Stream group with ID "${id}" not found`,
      'id'
    );
  }

  // Check for duplicate name if name is being changed
  if (updates.name && updates.name !== existing.name) {
    const nameCheck = db.prepare('SELECT id FROM stream_groups WHERE name = ? AND id != ?').get(updates.name, id);
    if (nameCheck) {
      throw new StreamGroupValidationError(
        `A stream group with name "${updates.name}" already exists`,
        'name'
      );
    }
  }

  // Validate all stream IDs exist if members are being updated
  if (updates.members) {
    for (const member of updates.members) {
      const stream = db.prepare('SELECT id FROM stream_configs WHERE id = ?').get(member.streamId);
      if (!stream) {
        throw new StreamGroupValidationError(
          `Stream with ID "${member.streamId}" not found`,
          'members'
        );
      }
    }
  }

  const now = new Date().toISOString();

  // Build UPDATE statement dynamically
  const setClauses: string[] = ['updated_at = ?', 'updated_by = ?'];
  const values: (string | number | null)[] = [now, user.id];

  const fieldMap: Record<string, string> = {
    name: 'name',
    description: 'description',
    enabled: 'enabled',
    members: 'members',
    startOrder: 'start_order',
    stopOrder: 'stop_order',
    startDelayMs: 'start_delay_ms',
    stopDelayMs: 'stop_delay_ms'
  };

  for (const [jsField, dbField] of Object.entries(fieldMap)) {
    const key = jsField as keyof StreamGroupUpdate;
    if (updates[key] !== undefined) {
      setClauses.push(`${dbField} = ?`);
      const rawValue = updates[key];

      // Handle special cases
      let dbValue: string | number | null;
      if (key === 'enabled') {
        dbValue = rawValue ? 1 : 0;
      } else if (key === 'members') {
        dbValue = JSON.stringify(rawValue);
      } else if (rawValue === undefined) {
        dbValue = null;
      } else {
        dbValue = rawValue as string | number;
      }

      values.push(dbValue);
    }
  }

  values.push(id);

  db.prepare(`
    UPDATE stream_groups
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `).run(...values);

  return getStreamGroup(id)!;
}

/**
 * Delete a stream group
 */
export function deleteStreamGroup(id: string): boolean {
  const db = getDatabase();

  // Check if group exists
  const existing = getStreamGroup(id);
  if (!existing) {
    return false;
  }

  // Delete the group
  const result = db.prepare('DELETE FROM stream_groups WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Get all groups containing a specific stream
 */
export function getGroupsContainingStream(streamId: string): StreamGroup[] {
  const db = getDatabase();

  // Get all groups and filter those containing the stream
  const rows = db.prepare('SELECT * FROM stream_groups').all() as StreamGroupRow[];

  return rows
    .map(rowToGroup)
    .filter(group => group.members.some(m => m.streamId === streamId));
}

/**
 * Duplicate a stream group with a new name
 */
export function duplicateStreamGroup(
  id: string,
  newName: string,
  user: User
): StreamGroup {
  const existing = getStreamGroup(id);
  if (!existing) {
    throw new StreamGroupValidationError(
      `Stream group with ID "${id}" not found`,
      'id'
    );
  }

  // Create a copy without the metadata fields
  const groupCopy: StreamGroupCreate = {
    name: newName,
    description: existing.description ? `Copy of ${existing.description}` : undefined,
    enabled: false, // Duplicates start disabled
    members: [...existing.members],
    startOrder: existing.startOrder,
    stopOrder: existing.stopOrder,
    startDelayMs: existing.startDelayMs,
    stopDelayMs: existing.stopDelayMs
  };

  return createStreamGroup(groupCopy, user);
}
