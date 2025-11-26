/**
 * Stream Template Storage
 * CRUD operations for stream templates in SQLite
 */

import { randomUUID } from 'crypto';
import { getDatabase } from '../db/index.js';
import { User } from '../auth/types.js';
import { StreamConfigCreate, STREAM_CONFIG_DEFAULTS } from './schema.js';

/**
 * Template category types
 */
export type TemplateCategory = 'standard' | 'compositor' | 'custom';

/**
 * Stream template interface
 */
export interface StreamTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  config: Partial<StreamConfigCreate>;
  builtIn: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Template creation input (excludes auto-generated fields)
 */
export interface StreamTemplateCreate {
  name: string;
  description: string;
  category: TemplateCategory;
  config: Partial<StreamConfigCreate>;
}

/**
 * Template update input
 */
export interface StreamTemplateUpdate {
  name?: string;
  description?: string;
  category?: TemplateCategory;
  config?: Partial<StreamConfigCreate>;
}

/**
 * Database row representation
 */
interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  config: string;
  built_in: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface CountRow {
  count: number;
}

/**
 * Template validation error
 */
export class TemplateValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public value: unknown
  ) {
    super(message);
    this.name = 'TemplateValidationError';
  }
}

/**
 * Convert database row to StreamTemplate
 */
function rowToTemplate(row: TemplateRow): StreamTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    category: row.category as TemplateCategory,
    config: JSON.parse(row.config),
    builtIn: Boolean(row.built_in),
    createdBy: row.created_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Validate template name
 */
function validateTemplateName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new TemplateValidationError('Name is required', 'name', name);
  }
  if (name.length < 1 || name.length > 100) {
    throw new TemplateValidationError('Name must be 1-100 characters', 'name', name);
  }
}

/**
 * Validate template category
 */
function validateTemplateCategory(category: string): asserts category is TemplateCategory {
  const validCategories: TemplateCategory[] = ['standard', 'compositor', 'custom'];
  if (!validCategories.includes(category as TemplateCategory)) {
    throw new TemplateValidationError(
      `Category must be one of: ${validCategories.join(', ')}`,
      'category',
      category
    );
  }
}

/**
 * Built-in templates - inserted on first run
 */
export const BUILT_IN_TEMPLATES: StreamTemplateCreate[] = [
  {
    name: 'Basic Web Page',
    description: 'Standard web page streaming with sensible defaults',
    category: 'standard',
    config: {
      type: 'standard',
      width: 1920,
      height: 1080,
      fps: 30,
      preset: 'veryfast',
      videoBitrate: '2500k',
      audioBitrate: '128k',
      format: 'mpegts',
      autoRefreshSeconds: 0,
      reconnectAttempts: 0,
      reconnectInitialDelayMs: 1000,
      reconnectMaxDelayMs: 30000,
      healthIntervalSeconds: 30
    }
  },
  {
    name: 'High Quality Stream',
    description: 'Higher bitrate for quality-sensitive content (4K-ready)',
    category: 'standard',
    config: {
      type: 'standard',
      width: 3840,
      height: 2160,
      fps: 30,
      preset: 'fast',
      videoBitrate: '8000k',
      audioBitrate: '192k',
      format: 'mpegts',
      autoRefreshSeconds: 0,
      reconnectAttempts: 0,
      healthIntervalSeconds: 30
    }
  },
  {
    name: 'Low Bandwidth',
    description: 'Optimized for limited bandwidth connections',
    category: 'standard',
    config: {
      type: 'standard',
      width: 1280,
      height: 720,
      fps: 24,
      preset: 'ultrafast',
      videoBitrate: '1000k',
      audioBitrate: '64k',
      format: 'mpegts',
      autoRefreshSeconds: 0,
      reconnectAttempts: 0,
      healthIntervalSeconds: 30
    }
  },
  {
    name: 'Auto-Refresh Dashboard',
    description: 'Web dashboard with automatic page refresh',
    category: 'standard',
    config: {
      type: 'standard',
      width: 1920,
      height: 1080,
      fps: 30,
      preset: 'veryfast',
      videoBitrate: '2500k',
      audioBitrate: '128k',
      format: 'mpegts',
      autoRefreshSeconds: 300,
      reconnectAttempts: 10,
      reconnectInitialDelayMs: 2000,
      reconnectMaxDelayMs: 60000,
      healthIntervalSeconds: 30
    }
  },
  {
    name: 'RTMP Output',
    description: 'Configured for RTMP output (Twitch, YouTube, etc.)',
    category: 'standard',
    config: {
      type: 'standard',
      width: 1920,
      height: 1080,
      fps: 30,
      preset: 'veryfast',
      videoBitrate: '4500k',
      audioBitrate: '160k',
      format: 'flv',
      autoRefreshSeconds: 0,
      reconnectAttempts: 5,
      healthIntervalSeconds: 30
    }
  },
  {
    name: 'Compositor Source',
    description: 'Source stream for compositor input',
    category: 'compositor',
    config: {
      type: 'compositor-source',
      width: 1920,
      height: 1080,
      fps: 30,
      preset: 'ultrafast',
      videoBitrate: '3000k',
      audioBitrate: '128k',
      format: 'mpegts',
      autoRefreshSeconds: 0,
      reconnectAttempts: 0,
      healthIntervalSeconds: 15
    }
  },
  {
    name: 'Compositor Output',
    description: 'Main compositor stream combining multiple sources',
    category: 'compositor',
    config: {
      type: 'compositor',
      width: 1920,
      height: 1080,
      fps: 30,
      preset: 'fast',
      videoBitrate: '5000k',
      audioBitrate: '192k',
      format: 'mpegts',
      autoRefreshSeconds: 0,
      reconnectAttempts: 3,
      healthIntervalSeconds: 15
    }
  }
];

/**
 * Initialize built-in templates (called on database init)
 */
export function initializeBuiltInTemplates(): void {
  const db = getDatabase();

  // Check if built-in templates already exist
  const existing = db.prepare('SELECT COUNT(*) as count FROM templates WHERE built_in = 1').get() as CountRow;
  if (existing.count > 0) {
    return; // Already initialized
  }

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO templates (id, name, description, category, config, built_in, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `);

  for (const template of BUILT_IN_TEMPLATES) {
    stmt.run(
      randomUUID(),
      template.name,
      template.description,
      template.category,
      JSON.stringify(template.config),
      now,
      now
    );
  }
}

/**
 * Create a new template
 */
export function createTemplate(
  input: StreamTemplateCreate,
  user: User
): StreamTemplate {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();

  // Validate
  validateTemplateName(input.name);
  validateTemplateCategory(input.category);

  // Check for duplicate name
  const existing = db.prepare('SELECT id FROM templates WHERE name = ?').get(input.name);
  if (existing) {
    throw new TemplateValidationError(
      `A template with name "${input.name}" already exists`,
      'name',
      input.name
    );
  }

  const stmt = db.prepare(`
    INSERT INTO templates (id, name, description, category, config, built_in, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.name,
    input.description || '',
    input.category,
    JSON.stringify(input.config),
    user.id,
    now,
    now
  );

  return {
    id,
    name: input.name,
    description: input.description || '',
    category: input.category,
    config: input.config,
    builtIn: false,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Get a template by ID
 */
export function getTemplate(id: string): StreamTemplate | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as TemplateRow | undefined;
  return row ? rowToTemplate(row) : null;
}

/**
 * Get a template by name
 */
export function getTemplateByName(name: string): StreamTemplate | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM templates WHERE name = ?').get(name) as TemplateRow | undefined;
  return row ? rowToTemplate(row) : null;
}

/**
 * List templates with optional filters
 */
export function listTemplates(options: {
  category?: TemplateCategory;
  builtIn?: boolean;
  limit?: number;
  offset?: number;
} = {}): { templates: StreamTemplate[]; total: number } {
  const db = getDatabase();

  let where = '1=1';
  const params: (string | number)[] = [];

  if (options.category) {
    where += ' AND category = ?';
    params.push(options.category);
  }

  if (options.builtIn !== undefined) {
    where += ' AND built_in = ?';
    params.push(options.builtIn ? 1 : 0);
  }

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM templates WHERE ${where}`).get(...params) as CountRow;
  const total = countRow.count;

  const limit = options.limit || 100;
  const offset = options.offset || 0;

  const rows = db.prepare(`
    SELECT * FROM templates
    WHERE ${where}
    ORDER BY built_in DESC, category ASC, name ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as TemplateRow[];

  return {
    templates: rows.map(rowToTemplate),
    total
  };
}

/**
 * Update a template
 */
export function updateTemplate(
  id: string,
  updates: StreamTemplateUpdate,
  user: User
): StreamTemplate {
  const db = getDatabase();

  // Check if template exists
  const existing = getTemplate(id);
  if (!existing) {
    throw new TemplateValidationError(
      `Template with ID "${id}" not found`,
      'id',
      id
    );
  }

  // Cannot update built-in templates
  if (existing.builtIn) {
    throw new TemplateValidationError(
      'Cannot modify built-in templates',
      'id',
      id
    );
  }

  // Validate updates
  if (updates.name !== undefined) {
    validateTemplateName(updates.name);

    // Check for duplicate name if name is being changed
    if (updates.name !== existing.name) {
      const nameCheck = db.prepare('SELECT id FROM templates WHERE name = ? AND id != ?').get(updates.name, id);
      if (nameCheck) {
        throw new TemplateValidationError(
          `A template with name "${updates.name}" already exists`,
          'name',
          updates.name
        );
      }
    }
  }

  if (updates.category !== undefined) {
    validateTemplateCategory(updates.category);
  }

  const now = new Date().toISOString();

  // Build UPDATE statement dynamically
  const setClauses: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];

  if (updates.name !== undefined) {
    setClauses.push('name = ?');
    values.push(updates.name);
  }

  if (updates.description !== undefined) {
    setClauses.push('description = ?');
    values.push(updates.description);
  }

  if (updates.category !== undefined) {
    setClauses.push('category = ?');
    values.push(updates.category);
  }

  if (updates.config !== undefined) {
    setClauses.push('config = ?');
    values.push(JSON.stringify(updates.config));
  }

  values.push(id);

  db.prepare(`
    UPDATE templates
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `).run(...values);

  return getTemplate(id)!;
}

/**
 * Delete a template
 */
export function deleteTemplate(id: string, user: User): boolean {
  const db = getDatabase();

  // Check if template exists
  const existing = getTemplate(id);
  if (!existing) {
    return false;
  }

  // Cannot delete built-in templates
  if (existing.builtIn) {
    throw new TemplateValidationError(
      'Cannot delete built-in templates',
      'id',
      id
    );
  }

  // Only allow creator or admin to delete
  // Note: Admin check should be done at route level via capabilities
  if (existing.createdBy && existing.createdBy !== user.id) {
    throw new TemplateValidationError(
      'Only the template creator can delete this template',
      'id',
      id
    );
  }

  const result = db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Apply a template to create a stream configuration
 * Merges template config with user-provided overrides
 */
export function applyTemplate(
  templateId: string,
  overrides: {
    name: string;
    url: string;
    ingest: string;
    [key: string]: unknown;
  }
): StreamConfigCreate {
  const template = getTemplate(templateId);
  if (!template) {
    throw new TemplateValidationError(
      `Template with ID "${templateId}" not found`,
      'templateId',
      templateId
    );
  }

  // Merge: defaults < template config < user overrides
  return {
    ...STREAM_CONFIG_DEFAULTS,
    ...template.config,
    ...overrides,
    // Ensure required fields are present
    name: overrides.name,
    url: overrides.url,
    ingest: overrides.ingest
  } as StreamConfigCreate;
}

/**
 * Create a template from an existing stream configuration
 */
export function createTemplateFromConfig(
  name: string,
  description: string,
  category: TemplateCategory,
  config: StreamConfigCreate,
  user: User
): StreamTemplate {
  // Extract only the template-relevant parts of the config
  // (exclude name, url, ingest as those are stream-specific)
  const { name: _name, url: _url, ingest: _ingest, ...templateConfig } = config;

  return createTemplate(
    {
      name,
      description,
      category,
      config: templateConfig
    },
    user
  );
}
