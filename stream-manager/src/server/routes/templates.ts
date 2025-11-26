/**
 * Template API Routes
 * CRUD operations for stream templates with capability-based access control
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireCapability } from '../auth/index.js';
import { logAuditEvent } from '../db/audit.js';
import {
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  deleteTemplate,
  applyTemplate,
  createTemplateFromConfig,
  TemplateValidationError,
  StreamTemplateCreate,
  StreamTemplateUpdate,
  TemplateCategory
} from '../config/templates.js';
import { getStreamConfig } from '../config/storage.js';

const router = Router();

// Async handler wrapper for cleaner error handling
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Validate template create input
 */
function validateTemplateInput(body: unknown): StreamTemplateCreate {
  if (!body || typeof body !== 'object') {
    throw new TemplateValidationError('Request body must be an object', 'body', body);
  }

  const b = body as Record<string, unknown>;

  if (!b.name || typeof b.name !== 'string') {
    throw new TemplateValidationError('Name is required', 'name', b.name);
  }

  const description = typeof b.description === 'string' ? b.description : '';

  const validCategories: TemplateCategory[] = ['standard', 'compositor', 'custom'];
  const category = (b.category as string) || 'custom';
  if (!validCategories.includes(category as TemplateCategory)) {
    throw new TemplateValidationError(
      `Category must be one of: ${validCategories.join(', ')}`,
      'category',
      category
    );
  }

  if (!b.config || typeof b.config !== 'object') {
    throw new TemplateValidationError('Config must be an object', 'config', b.config);
  }

  return {
    name: b.name,
    description,
    category: category as TemplateCategory,
    config: b.config as Record<string, unknown>
  };
}

/**
 * Validate template update input
 */
function validateTemplateUpdate(body: unknown): StreamTemplateUpdate {
  if (!body || typeof body !== 'object') {
    throw new TemplateValidationError('Request body must be an object', 'body', body);
  }

  const b = body as Record<string, unknown>;
  const updates: StreamTemplateUpdate = {};

  if (b.name !== undefined) {
    if (typeof b.name !== 'string') {
      throw new TemplateValidationError('Name must be a string', 'name', b.name);
    }
    updates.name = b.name;
  }

  if (b.description !== undefined) {
    if (typeof b.description !== 'string') {
      throw new TemplateValidationError('Description must be a string', 'description', b.description);
    }
    updates.description = b.description;
  }

  if (b.category !== undefined) {
    const validCategories: TemplateCategory[] = ['standard', 'compositor', 'custom'];
    if (!validCategories.includes(b.category as TemplateCategory)) {
      throw new TemplateValidationError(
        `Category must be one of: ${validCategories.join(', ')}`,
        'category',
        b.category
      );
    }
    updates.category = b.category as TemplateCategory;
  }

  if (b.config !== undefined) {
    if (typeof b.config !== 'object') {
      throw new TemplateValidationError('Config must be an object', 'config', b.config);
    }
    updates.config = b.config as Record<string, unknown>;
  }

  return updates;
}

// GET /api/templates - List all templates
router.get(
  '/',
  requireCapability('templates:list'),
  asyncHandler(async (req, res) => {
    const category = req.query.category as TemplateCategory | undefined;
    const builtIn = req.query.builtIn !== undefined
      ? req.query.builtIn === 'true'
      : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;

    const result = listTemplates({ category, builtIn, limit, offset });
    res.json(result);
  })
);

// GET /api/templates/:id - Get a template by ID
router.get(
  '/:id',
  requireCapability('templates:read'),
  asyncHandler(async (req, res) => {
    const template = getTemplate(req.params.id);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.json({ template });
  })
);

// POST /api/templates - Create a new template
router.post(
  '/',
  requireCapability('templates:create'),
  asyncHandler(async (req, res) => {
    // Validate input
    let validatedInput;
    try {
      validatedInput = validateTemplateInput(req.body);
    } catch (error) {
      if (error instanceof TemplateValidationError) {
        res.status(400).json({
          error: 'Validation error',
          field: error.field,
          message: error.message
        });
        return;
      }
      throw error;
    }

    // Create the template
    let template;
    try {
      template = createTemplate(validatedInput, req.ctx.user);
    } catch (error) {
      if (error instanceof TemplateValidationError) {
        res.status(409).json({
          error: 'Conflict',
          field: error.field,
          message: error.message
        });
        return;
      }
      throw error;
    }

    // Audit log
    logAuditEvent(req.ctx.user, 'template:create', {
      resourceType: 'template',
      resourceId: template.id,
      details: { name: template.name, category: template.category }
    });

    res.status(201).json({ template });
  })
);

// POST /api/templates/from-stream/:streamId - Create template from existing stream
router.post(
  '/from-stream/:streamId',
  requireCapability('templates:create'),
  asyncHandler(async (req, res) => {
    const { streamId } = req.params;

    // Get the stream configuration
    const config = getStreamConfig(streamId);
    if (!config) {
      res.status(404).json({ error: 'Stream not found' });
      return;
    }

    // Validate name and description from body
    const body = req.body as Record<string, unknown>;
    if (!body.name || typeof body.name !== 'string') {
      res.status(400).json({
        error: 'Validation error',
        field: 'name',
        message: 'Template name is required'
      });
      return;
    }

    const description = typeof body.description === 'string'
      ? body.description
      : `Created from stream "${config.name}"`;

    const validCategories: TemplateCategory[] = ['standard', 'compositor', 'custom'];
    const category = (body.category as string) || 'custom';
    if (!validCategories.includes(category as TemplateCategory)) {
      res.status(400).json({
        error: 'Validation error',
        field: 'category',
        message: `Category must be one of: ${validCategories.join(', ')}`
      });
      return;
    }

    // Create template from config
    let template;
    try {
      template = createTemplateFromConfig(
        body.name,
        description,
        category as TemplateCategory,
        config,
        req.ctx.user
      );
    } catch (error) {
      if (error instanceof TemplateValidationError) {
        res.status(409).json({
          error: 'Conflict',
          field: error.field,
          message: error.message
        });
        return;
      }
      throw error;
    }

    // Audit log
    logAuditEvent(req.ctx.user, 'template:create', {
      resourceType: 'template',
      resourceId: template.id,
      details: {
        name: template.name,
        category: template.category,
        sourceStream: config.name
      }
    });

    res.status(201).json({ template });
  })
);

// PUT /api/templates/:id - Update a template
router.put(
  '/:id',
  requireCapability('templates:create'), // templates:create includes update for own templates
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Check if template exists
    const existing = getTemplate(id);
    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    // Validate updates
    let validatedUpdates;
    try {
      validatedUpdates = validateTemplateUpdate(req.body);
    } catch (error) {
      if (error instanceof TemplateValidationError) {
        res.status(400).json({
          error: 'Validation error',
          field: error.field,
          message: error.message
        });
        return;
      }
      throw error;
    }

    // Update the template
    let template;
    try {
      template = updateTemplate(id, validatedUpdates, req.ctx.user);
    } catch (error) {
      if (error instanceof TemplateValidationError) {
        if (error.message.includes('built-in')) {
          res.status(403).json({
            error: 'Forbidden',
            message: error.message
          });
          return;
        }
        res.status(409).json({
          error: 'Conflict',
          field: error.field,
          message: error.message
        });
        return;
      }
      throw error;
    }

    // Audit log
    logAuditEvent(req.ctx.user, 'template:update', {
      resourceType: 'template',
      resourceId: template.id,
      details: { changes: Object.keys(validatedUpdates) }
    });

    res.json({ template });
  })
);

// DELETE /api/templates/:id - Delete a template
router.delete(
  '/:id',
  requireCapability('templates:delete'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Get the template first for audit log
    const template = getTemplate(id);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    // Delete the template
    try {
      const deleted = deleteTemplate(id, req.ctx.user);
      if (!deleted) {
        res.status(404).json({ error: 'Template not found' });
        return;
      }
    } catch (error) {
      if (error instanceof TemplateValidationError) {
        if (error.message.includes('built-in') || error.message.includes('creator')) {
          res.status(403).json({
            error: 'Forbidden',
            message: error.message
          });
          return;
        }
        throw error;
      }
      throw error;
    }

    // Audit log
    logAuditEvent(req.ctx.user, 'template:delete', {
      resourceType: 'template',
      resourceId: id,
      details: { name: template.name }
    });

    res.json({ success: true });
  })
);

// POST /api/templates/:id/apply - Apply a template to create stream config values
router.post(
  '/:id/apply',
  requireCapability('templates:read'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Validate required overrides
    const body = req.body as Record<string, unknown>;
    const requiredFields = ['name', 'url', 'ingest'];
    const missing = requiredFields.filter(f => !body[f]);
    if (missing.length > 0) {
      res.status(400).json({
        error: 'Validation error',
        message: `Required fields missing: ${missing.join(', ')}`
      });
      return;
    }

    // Apply template
    let config;
    try {
      config = applyTemplate(id, body as { name: string; url: string; ingest: string });
    } catch (error) {
      if (error instanceof TemplateValidationError) {
        res.status(404).json({ error: 'Template not found' });
        return;
      }
      throw error;
    }

    res.json({ config });
  })
);

export default router;
