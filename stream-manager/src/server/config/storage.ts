/**
 * Stream Configuration Storage
 * CRUD operations for stream configurations in SQLite
 */

import { randomUUID } from 'crypto';
import { getDatabase } from '../db/index.js';
import { User } from '../auth/types.js';
import {
  StreamConfig,
  StreamConfigCreate,
  StreamConfigUpdate,
  StreamConfigValidationError
} from './schema.js';

/**
 * Database row representation
 */
interface StreamConfigRow {
  id: string;
  name: string;
  type: string;
  enabled: number;
  url: string;
  inject_css: string | null;
  inject_js: string | null;
  width: number;
  height: number;
  fps: number;
  crop_infobar: number;
  preset: string;
  video_bitrate: string;
  audio_bitrate: string;
  format: string;
  ingest: string;
  auto_refresh_seconds: number;
  reconnect_attempts: number;
  reconnect_initial_delay_ms: number;
  reconnect_max_delay_ms: number;
  health_interval_seconds: number;
  extra_ffmpeg_args: string | null;
  input_ffmpeg_flags: string | null;
  display: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string | null;
}

interface CountRow {
  count: number;
}

interface DisplayRow {
  display: string;
}

/**
 * Convert database row to StreamConfig
 */
function rowToConfig(row: StreamConfigRow): StreamConfig {
  return {
    id: row.id,
    name: row.name,
    type: row.type as StreamConfig['type'],
    enabled: Boolean(row.enabled),
    url: row.url,
    injectCss: row.inject_css || undefined,
    injectJs: row.inject_js || undefined,
    width: row.width,
    height: row.height,
    fps: row.fps,
    cropInfobar: row.crop_infobar,
    preset: row.preset as StreamConfig['preset'],
    videoBitrate: row.video_bitrate,
    audioBitrate: row.audio_bitrate,
    format: row.format as StreamConfig['format'],
    ingest: row.ingest,
    autoRefreshSeconds: row.auto_refresh_seconds,
    reconnectAttempts: row.reconnect_attempts,
    reconnectInitialDelayMs: row.reconnect_initial_delay_ms,
    reconnectMaxDelayMs: row.reconnect_max_delay_ms,
    healthIntervalSeconds: row.health_interval_seconds,
    extraFfmpegArgs: row.extra_ffmpeg_args ? JSON.parse(row.extra_ffmpeg_args) : undefined,
    inputFfmpegFlags: row.input_ffmpeg_flags || undefined,
    display: row.display || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by || undefined
  };
}

/**
 * Create a new stream configuration
 */
export function createStreamConfig(
  config: StreamConfigCreate,
  user: User
): StreamConfig {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();

  // Check for duplicate name
  const existing = db.prepare('SELECT id FROM stream_configs WHERE name = ?').get(config.name);
  if (existing) {
    throw new StreamConfigValidationError(
      `A stream with name "${config.name}" already exists`,
      'name',
      config.name
    );
  }

  const stmt = db.prepare(`
    INSERT INTO stream_configs (
      id, name, type, enabled, url, inject_css, inject_js,
      width, height, fps, crop_infobar,
      preset, video_bitrate, audio_bitrate, format, ingest,
      auto_refresh_seconds, reconnect_attempts,
      reconnect_initial_delay_ms, reconnect_max_delay_ms,
      health_interval_seconds,
      extra_ffmpeg_args, input_ffmpeg_flags, display,
      created_at, updated_at, created_by
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?,
      ?, ?, ?,
      ?, ?, ?
    )
  `);

  stmt.run(
    id,
    config.name,
    config.type,
    config.enabled ? 1 : 0,
    config.url,
    config.injectCss || null,
    config.injectJs || null,
    config.width,
    config.height,
    config.fps,
    config.cropInfobar,
    config.preset,
    config.videoBitrate,
    config.audioBitrate,
    config.format,
    config.ingest,
    config.autoRefreshSeconds,
    config.reconnectAttempts,
    config.reconnectInitialDelayMs,
    config.reconnectMaxDelayMs,
    config.healthIntervalSeconds,
    config.extraFfmpegArgs ? JSON.stringify(config.extraFfmpegArgs) : null,
    config.inputFfmpegFlags || null,
    config.display || null,
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
 * Get a stream configuration by ID
 */
export function getStreamConfig(id: string): StreamConfig | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM stream_configs WHERE id = ?').get(id) as StreamConfigRow | undefined;
  return row ? rowToConfig(row) : null;
}

/**
 * Get a stream configuration by name
 */
export function getStreamConfigByName(name: string): StreamConfig | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM stream_configs WHERE name = ?').get(name) as StreamConfigRow | undefined;
  return row ? rowToConfig(row) : null;
}

/**
 * List stream configurations with optional filters
 */
export function listStreamConfigs(options: {
  type?: StreamConfig['type'];
  enabled?: boolean;
  limit?: number;
  offset?: number;
} = {}): { configs: StreamConfig[]; total: number } {
  const db = getDatabase();

  let where = '1=1';
  const params: (string | number)[] = [];

  if (options.type) {
    where += ' AND type = ?';
    params.push(options.type);
  }

  if (options.enabled !== undefined) {
    where += ' AND enabled = ?';
    params.push(options.enabled ? 1 : 0);
  }

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM stream_configs WHERE ${where}`).get(...params) as CountRow;
  const total = countRow.count;

  const limit = options.limit || 100;
  const offset = options.offset || 0;

  const rows = db.prepare(`
    SELECT * FROM stream_configs
    WHERE ${where}
    ORDER BY name ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as StreamConfigRow[];

  return {
    configs: rows.map(rowToConfig),
    total
  };
}

/**
 * Update a stream configuration
 */
export function updateStreamConfig(
  id: string,
  updates: StreamConfigUpdate,
  user: User
): StreamConfig {
  const db = getDatabase();

  // Check if stream exists
  const existing = getStreamConfig(id);
  if (!existing) {
    throw new StreamConfigValidationError(
      `Stream with ID "${id}" not found`,
      'id',
      id
    );
  }

  // Check for duplicate name if name is being changed
  if (updates.name && updates.name !== existing.name) {
    const nameCheck = db.prepare('SELECT id FROM stream_configs WHERE name = ? AND id != ?').get(updates.name, id);
    if (nameCheck) {
      throw new StreamConfigValidationError(
        `A stream with name "${updates.name}" already exists`,
        'name',
        updates.name
      );
    }
  }

  const now = new Date().toISOString();

  // Build UPDATE statement dynamically
  const setClauses: string[] = ['updated_at = ?', 'updated_by = ?'];
  const values: (string | number | null)[] = [now, user.id];

  const fieldMap: Record<string, string> = {
    name: 'name',
    type: 'type',
    enabled: 'enabled',
    url: 'url',
    injectCss: 'inject_css',
    injectJs: 'inject_js',
    width: 'width',
    height: 'height',
    fps: 'fps',
    cropInfobar: 'crop_infobar',
    preset: 'preset',
    videoBitrate: 'video_bitrate',
    audioBitrate: 'audio_bitrate',
    format: 'format',
    ingest: 'ingest',
    autoRefreshSeconds: 'auto_refresh_seconds',
    reconnectAttempts: 'reconnect_attempts',
    reconnectInitialDelayMs: 'reconnect_initial_delay_ms',
    reconnectMaxDelayMs: 'reconnect_max_delay_ms',
    healthIntervalSeconds: 'health_interval_seconds',
    extraFfmpegArgs: 'extra_ffmpeg_args',
    inputFfmpegFlags: 'input_ffmpeg_flags',
    display: 'display'
  };

  for (const [jsField, dbField] of Object.entries(fieldMap)) {
    const key = jsField as keyof StreamConfigUpdate;
    if (updates[key] !== undefined) {
      setClauses.push(`${dbField} = ?`);
      const rawValue = updates[key];

      // Handle special cases
      let dbValue: string | number | null;
      if (key === 'enabled') {
        dbValue = rawValue ? 1 : 0;
      } else if (key === 'extraFfmpegArgs') {
        dbValue = rawValue ? JSON.stringify(rawValue) : null;
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
    UPDATE stream_configs
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `).run(...values);

  return getStreamConfig(id)!;
}

/**
 * Delete a stream configuration
 */
export function deleteStreamConfig(id: string): boolean {
  const db = getDatabase();

  // Check if stream exists
  const existing = getStreamConfig(id);
  if (!existing) {
    return false;
  }

  // Release any display assignment
  db.prepare('DELETE FROM display_assignments WHERE stream_id = ?').run(id);

  // Delete the configuration
  const result = db.prepare('DELETE FROM stream_configs WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Duplicate a stream configuration with a new name
 */
export function duplicateStreamConfig(
  id: string,
  newName: string,
  user: User
): StreamConfig {
  const existing = getStreamConfig(id);
  if (!existing) {
    throw new StreamConfigValidationError(
      `Stream with ID "${id}" not found`,
      'id',
      id
    );
  }

  // Create a copy without the metadata fields
  const configCopy: StreamConfigCreate = {
    name: newName,
    type: existing.type,
    enabled: false, // Duplicates start disabled
    url: existing.url,
    injectCss: existing.injectCss,
    injectJs: existing.injectJs,
    width: existing.width,
    height: existing.height,
    fps: existing.fps,
    cropInfobar: existing.cropInfobar,
    preset: existing.preset,
    videoBitrate: existing.videoBitrate,
    audioBitrate: existing.audioBitrate,
    format: existing.format,
    ingest: existing.ingest,
    autoRefreshSeconds: existing.autoRefreshSeconds,
    reconnectAttempts: existing.reconnectAttempts,
    reconnectInitialDelayMs: existing.reconnectInitialDelayMs,
    reconnectMaxDelayMs: existing.reconnectMaxDelayMs,
    healthIntervalSeconds: existing.healthIntervalSeconds,
    extraFfmpegArgs: existing.extraFfmpegArgs,
    inputFfmpegFlags: existing.inputFfmpegFlags
    // Note: display is not copied - will be auto-assigned
  };

  return createStreamConfig(configCopy, user);
}

// ============================================================================
// Display Management
// ============================================================================

const DISPLAY_START = 99; // First available display number
const DISPLAY_MAX = 199;  // Maximum display number

/**
 * Get the next available X11 display
 */
export function getNextAvailableDisplay(): string {
  const db = getDatabase();

  // Get all assigned displays
  const assigned = db.prepare('SELECT display FROM display_assignments ORDER BY display').all() as DisplayRow[];
  const assignedSet = new Set(assigned.map(r => r.display));

  // Also check for displays manually specified in configs
  const manualDisplays = db.prepare('SELECT DISTINCT display FROM stream_configs WHERE display IS NOT NULL').all() as DisplayRow[];
  for (const row of manualDisplays) {
    assignedSet.add(row.display);
  }

  // Find first available
  for (let n = DISPLAY_START; n <= DISPLAY_MAX; n++) {
    const display = `:${n}`;
    if (!assignedSet.has(display)) {
      return display;
    }
  }

  throw new Error('No available displays (all displays from :99 to :199 are in use)');
}

/**
 * Assign a display to a stream
 */
export function assignDisplay(streamId: string, display: string): void {
  const db = getDatabase();

  // Check if display is already assigned
  const existing = db.prepare('SELECT stream_id FROM display_assignments WHERE display = ?').get(display) as { stream_id: string } | undefined;
  if (existing && existing.stream_id !== streamId) {
    throw new Error(`Display ${display} is already assigned to another stream`);
  }

  // Upsert the assignment
  db.prepare(`
    INSERT INTO display_assignments (display, stream_id)
    VALUES (?, ?)
    ON CONFLICT(display) DO UPDATE SET stream_id = ?, assigned_at = CURRENT_TIMESTAMP
  `).run(display, streamId, streamId);
}

/**
 * Release a display assignment
 */
export function releaseDisplay(streamId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM display_assignments WHERE stream_id = ?').run(streamId);
}

/**
 * Get the display assigned to a stream
 */
export function getAssignedDisplay(streamId: string): string | null {
  const db = getDatabase();
  const row = db.prepare('SELECT display FROM display_assignments WHERE stream_id = ?').get(streamId) as DisplayRow | undefined;
  return row?.display || null;
}

// ============================================================================
// Import/Export
// ============================================================================

export interface ExportData {
  version: number;
  exportedAt: string;
  configs: StreamConfigCreate[];
}

/**
 * Export all stream configurations to JSON
 */
export function exportConfigs(): ExportData {
  const { configs } = listStreamConfigs({ limit: 10000 });

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    configs: configs.map(config => ({
      name: config.name,
      type: config.type,
      enabled: config.enabled,
      url: config.url,
      injectCss: config.injectCss,
      injectJs: config.injectJs,
      width: config.width,
      height: config.height,
      fps: config.fps,
      cropInfobar: config.cropInfobar,
      preset: config.preset,
      videoBitrate: config.videoBitrate,
      audioBitrate: config.audioBitrate,
      format: config.format,
      ingest: config.ingest,
      autoRefreshSeconds: config.autoRefreshSeconds,
      reconnectAttempts: config.reconnectAttempts,
      reconnectInitialDelayMs: config.reconnectInitialDelayMs,
      reconnectMaxDelayMs: config.reconnectMaxDelayMs,
      healthIntervalSeconds: config.healthIntervalSeconds,
      extraFfmpegArgs: config.extraFfmpegArgs,
      inputFfmpegFlags: config.inputFfmpegFlags,
      display: config.display
    }))
  };
}

/**
 * Import stream configurations from JSON
 * @param data Export data to import
 * @param user User performing the import
 * @param options Import options
 * @returns Results of the import
 */
export function importConfigs(
  data: ExportData,
  user: User,
  options: {
    skipExisting?: boolean;  // Skip configs that already exist by name
    overwrite?: boolean;     // Overwrite existing configs
  } = {}
): { imported: number; skipped: number; errors: Array<{ name: string; error: string }> } {
  const db = getDatabase();
  const results = { imported: 0, skipped: 0, errors: [] as Array<{ name: string; error: string }> };

  if (data.version !== 1) {
    throw new Error(`Unsupported export version: ${data.version}`);
  }

  // Use a transaction for atomicity
  const importFn = db.transaction(() => {
    for (const config of data.configs) {
      try {
        const existing = getStreamConfigByName(config.name);

        if (existing) {
          if (options.skipExisting) {
            results.skipped++;
            continue;
          }

          if (options.overwrite) {
            // Update existing
            const { name, ...updates } = config;
            updateStreamConfig(existing.id, updates, user);
            results.imported++;
          } else {
            results.errors.push({
              name: config.name,
              error: 'Stream already exists (use skipExisting or overwrite)'
            });
          }
        } else {
          // Create new
          createStreamConfig(config, user);
          results.imported++;
        }
      } catch (err) {
        results.errors.push({
          name: config.name,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  });

  importFn();
  return results;
}
