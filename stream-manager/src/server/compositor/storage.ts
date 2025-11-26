/**
 * Compositor Configuration Storage
 * CRUD operations for compositor configurations in SQLite
 */

import { randomUUID } from 'crypto';
import { getDatabase } from '../db/index.js';
import { User } from '../auth/types.js';
import {
  CompositorConfig,
  CompositorConfigCreate,
  CompositorConfigUpdate,
  CompositorConfigValidationError,
  CompositorInput,
  CompositorLayout,
  PipConfig
} from './schema.js';
import { EncodingPreset, OutputFormat } from '../config/schema.js';

/**
 * Database row representation
 */
interface CompositorConfigRow {
  id: string;
  name: string;
  enabled: number;
  layout: string;
  inputs: string;
  custom_filter_complex: string | null;
  pip_config: string | null;
  output_width: number;
  output_height: number;
  output_fps: number;
  preset: string;
  video_bitrate: string;
  audio_bitrate: string;
  format: string;
  output_ingest: string;
  extra_ffmpeg_args: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string | null;
}

interface CountRow {
  count: number;
}

/**
 * Convert database row to CompositorConfig
 */
function rowToConfig(row: CompositorConfigRow): CompositorConfig {
  return {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    layout: row.layout as CompositorLayout,
    inputs: JSON.parse(row.inputs) as CompositorInput[],
    customFilterComplex: row.custom_filter_complex || undefined,
    pipConfig: row.pip_config ? JSON.parse(row.pip_config) as PipConfig : undefined,
    outputWidth: row.output_width,
    outputHeight: row.output_height,
    outputFps: row.output_fps,
    preset: row.preset as EncodingPreset,
    videoBitrate: row.video_bitrate,
    audioBitrate: row.audio_bitrate,
    format: row.format as OutputFormat,
    outputIngest: row.output_ingest,
    extraFfmpegArgs: row.extra_ffmpeg_args ? JSON.parse(row.extra_ffmpeg_args) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by || undefined
  };
}

/**
 * Create a new compositor configuration
 */
export function createCompositorConfig(
  config: CompositorConfigCreate,
  user: User
): CompositorConfig {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();

  // Check for duplicate name
  const existing = db.prepare('SELECT id FROM compositors WHERE name = ?').get(config.name);
  if (existing) {
    throw new CompositorConfigValidationError(
      `A compositor with name "${config.name}" already exists`,
      'name',
      config.name
    );
  }

  const stmt = db.prepare(`
    INSERT INTO compositors (
      id, name, enabled, layout, inputs,
      custom_filter_complex, pip_config,
      output_width, output_height, output_fps,
      preset, video_bitrate, audio_bitrate, format,
      output_ingest, extra_ffmpeg_args,
      created_at, updated_at, created_by
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?
    )
  `);

  stmt.run(
    id,
    config.name,
    config.enabled ? 1 : 0,
    config.layout,
    JSON.stringify(config.inputs),
    config.customFilterComplex || null,
    config.pipConfig ? JSON.stringify(config.pipConfig) : null,
    config.outputWidth,
    config.outputHeight,
    config.outputFps,
    config.preset,
    config.videoBitrate,
    config.audioBitrate,
    config.format,
    config.outputIngest,
    config.extraFfmpegArgs ? JSON.stringify(config.extraFfmpegArgs) : null,
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
 * Get a compositor configuration by ID
 */
export function getCompositorConfig(id: string): CompositorConfig | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM compositors WHERE id = ?').get(id) as CompositorConfigRow | undefined;
  return row ? rowToConfig(row) : null;
}

/**
 * Get a compositor configuration by name
 */
export function getCompositorConfigByName(name: string): CompositorConfig | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM compositors WHERE name = ?').get(name) as CompositorConfigRow | undefined;
  return row ? rowToConfig(row) : null;
}

/**
 * List compositor configurations with optional filters
 */
export function listCompositorConfigs(options: {
  enabled?: boolean;
  limit?: number;
  offset?: number;
} = {}): { configs: CompositorConfig[]; total: number } {
  const db = getDatabase();

  let where = '1=1';
  const params: (string | number)[] = [];

  if (options.enabled !== undefined) {
    where += ' AND enabled = ?';
    params.push(options.enabled ? 1 : 0);
  }

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM compositors WHERE ${where}`).get(...params) as CountRow;
  const total = countRow.count;

  const limit = options.limit || 100;
  const offset = options.offset || 0;

  const rows = db.prepare(`
    SELECT * FROM compositors
    WHERE ${where}
    ORDER BY name ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as CompositorConfigRow[];

  return {
    configs: rows.map(rowToConfig),
    total
  };
}

/**
 * Update a compositor configuration
 */
export function updateCompositorConfig(
  id: string,
  updates: CompositorConfigUpdate,
  user: User
): CompositorConfig {
  const db = getDatabase();

  // Check if compositor exists
  const existing = getCompositorConfig(id);
  if (!existing) {
    throw new CompositorConfigValidationError(
      `Compositor with ID "${id}" not found`,
      'id',
      id
    );
  }

  // Check for duplicate name if name is being changed
  if (updates.name && updates.name !== existing.name) {
    const nameCheck = db.prepare('SELECT id FROM compositors WHERE name = ? AND id != ?').get(updates.name, id);
    if (nameCheck) {
      throw new CompositorConfigValidationError(
        `A compositor with name "${updates.name}" already exists`,
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
    enabled: 'enabled',
    layout: 'layout',
    inputs: 'inputs',
    customFilterComplex: 'custom_filter_complex',
    pipConfig: 'pip_config',
    outputWidth: 'output_width',
    outputHeight: 'output_height',
    outputFps: 'output_fps',
    preset: 'preset',
    videoBitrate: 'video_bitrate',
    audioBitrate: 'audio_bitrate',
    format: 'format',
    outputIngest: 'output_ingest',
    extraFfmpegArgs: 'extra_ffmpeg_args'
  };

  for (const [jsField, dbField] of Object.entries(fieldMap)) {
    const key = jsField as keyof CompositorConfigUpdate;
    if (updates[key] !== undefined) {
      setClauses.push(`${dbField} = ?`);
      const rawValue = updates[key];

      // Handle special cases
      let dbValue: string | number | null;
      if (key === 'enabled') {
        dbValue = rawValue ? 1 : 0;
      } else if (key === 'inputs') {
        dbValue = JSON.stringify(rawValue);
      } else if (key === 'pipConfig') {
        dbValue = rawValue ? JSON.stringify(rawValue) : null;
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
    UPDATE compositors
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `).run(...values);

  return getCompositorConfig(id)!;
}

/**
 * Delete a compositor configuration
 */
export function deleteCompositorConfig(id: string): boolean {
  const db = getDatabase();

  // Check if compositor exists
  const existing = getCompositorConfig(id);
  if (!existing) {
    return false;
  }

  // Delete the configuration
  const result = db.prepare('DELETE FROM compositors WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Duplicate a compositor configuration with a new name
 */
export function duplicateCompositorConfig(
  id: string,
  newName: string,
  user: User
): CompositorConfig {
  const existing = getCompositorConfig(id);
  if (!existing) {
    throw new CompositorConfigValidationError(
      `Compositor with ID "${id}" not found`,
      'id',
      id
    );
  }

  // Create a copy without the metadata fields
  const configCopy: CompositorConfigCreate = {
    name: newName,
    enabled: false, // Duplicates start disabled
    layout: existing.layout,
    inputs: existing.inputs.map(input => ({
      ...input,
      // Increment ports to avoid conflicts
      listenPort: input.listenPort + 100
    })),
    customFilterComplex: existing.customFilterComplex,
    pipConfig: existing.pipConfig,
    outputWidth: existing.outputWidth,
    outputHeight: existing.outputHeight,
    outputFps: existing.outputFps,
    preset: existing.preset,
    videoBitrate: existing.videoBitrate,
    audioBitrate: existing.audioBitrate,
    format: existing.format,
    outputIngest: existing.outputIngest,
    extraFfmpegArgs: existing.extraFfmpegArgs
  };

  return createCompositorConfig(configCopy, user);
}
