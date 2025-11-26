import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { initDatabase, closeDatabase } from '../../../src/server/db/index.js';
import {
  createTemplate,
  getTemplate,
  getTemplateByName,
  listTemplates,
  updateTemplate,
  deleteTemplate,
  applyTemplate,
  createTemplateFromConfig,
  initializeBuiltInTemplates,
  TemplateValidationError,
  StreamTemplateCreate,
  BUILT_IN_TEMPLATES
} from '../../../src/server/config/templates.js';
import { StreamConfigCreate, STREAM_CONFIG_DEFAULTS } from '../../../src/server/config/schema.js';
import { User } from '../../../src/server/auth/types.js';

const TEST_DB_DIR = join(process.cwd(), 'tests', '.tmp');
const TEST_DB_PATH = join(TEST_DB_DIR, 'test-templates.db');

const testUser: User = {
  id: 'test-user',
  username: 'Test User',
  roles: ['admin'],
  authSource: 'header'
};

const testUser2: User = {
  id: 'other-user',
  username: 'Other User',
  roles: ['editor'],
  authSource: 'header'
};

const validTemplate: StreamTemplateCreate = {
  name: 'Test Template',
  description: 'A test template for unit tests',
  category: 'custom',
  config: {
    type: 'standard',
    width: 1920,
    height: 1080,
    fps: 30,
    preset: 'veryfast',
    videoBitrate: '2500k',
    audioBitrate: '128k',
    format: 'mpegts'
  }
};

describe('Template Storage', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DB_DIR)) {
      mkdirSync(TEST_DB_DIR, { recursive: true });
    }
    // Clean up test database files
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(TEST_DB_PATH + suffix)) {
        unlinkSync(TEST_DB_PATH + suffix);
      }
    }
    initDatabase(TEST_DB_PATH);
  });

  afterEach(() => {
    closeDatabase();
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(TEST_DB_PATH + suffix)) {
        unlinkSync(TEST_DB_PATH + suffix);
      }
    }
  });

  describe('initializeBuiltInTemplates', () => {
    it('should create built-in templates on first run', () => {
      initializeBuiltInTemplates();

      const { templates, total } = listTemplates({ builtIn: true });
      expect(total).toBe(BUILT_IN_TEMPLATES.length);
      expect(templates.every(t => t.builtIn)).toBe(true);
    });

    it('should not duplicate templates on subsequent runs', () => {
      initializeBuiltInTemplates();
      initializeBuiltInTemplates();

      const { total } = listTemplates({ builtIn: true });
      expect(total).toBe(BUILT_IN_TEMPLATES.length);
    });

    it('should include standard category templates', () => {
      initializeBuiltInTemplates();

      const { templates } = listTemplates({ category: 'standard', builtIn: true });
      expect(templates.length).toBeGreaterThan(0);
    });

    it('should include compositor category templates', () => {
      initializeBuiltInTemplates();

      const { templates } = listTemplates({ category: 'compositor', builtIn: true });
      expect(templates.length).toBeGreaterThan(0);
    });
  });

  describe('createTemplate', () => {
    it('should create a new template', () => {
      const result = createTemplate(validTemplate, testUser);

      expect(result.id).toBeDefined();
      expect(result.name).toBe('Test Template');
      expect(result.description).toBe('A test template for unit tests');
      expect(result.category).toBe('custom');
      expect(result.builtIn).toBe(false);
      expect(result.createdBy).toBe('test-user');
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should store template config', () => {
      const result = createTemplate(validTemplate, testUser);

      expect(result.config.type).toBe('standard');
      expect(result.config.width).toBe(1920);
      expect(result.config.height).toBe(1080);
      expect(result.config.preset).toBe('veryfast');
    });

    it('should reject duplicate names', () => {
      createTemplate(validTemplate, testUser);

      expect(() => createTemplate(validTemplate, testUser))
        .toThrow(TemplateValidationError);
    });

    it('should validate category', () => {
      const invalid = {
        ...validTemplate,
        name: 'invalid-category',
        category: 'invalid' as StreamTemplateCreate['category']
      };

      expect(() => createTemplate(invalid, testUser))
        .toThrow(TemplateValidationError);
    });

    it('should require name', () => {
      const invalid = {
        ...validTemplate,
        name: ''
      };

      expect(() => createTemplate(invalid, testUser))
        .toThrow(TemplateValidationError);
    });
  });

  describe('getTemplate', () => {
    it('should retrieve template by id', () => {
      const created = createTemplate(validTemplate, testUser);
      const retrieved = getTemplate(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.name).toBe('Test Template');
    });

    it('should return null for non-existent id', () => {
      const result = getTemplate('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getTemplateByName', () => {
    it('should retrieve template by name', () => {
      createTemplate(validTemplate, testUser);
      const retrieved = getTemplateByName('Test Template');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Test Template');
    });

    it('should return null for non-existent name', () => {
      const result = getTemplateByName('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('listTemplates', () => {
    beforeEach(() => {
      initializeBuiltInTemplates();
      createTemplate({ ...validTemplate, name: 'Custom A', category: 'custom' }, testUser);
      createTemplate({ ...validTemplate, name: 'Custom B', category: 'standard' }, testUser);
    });

    it('should list all templates', () => {
      const { templates, total } = listTemplates();
      expect(total).toBe(BUILT_IN_TEMPLATES.length + 2);
      expect(templates.length).toBe(BUILT_IN_TEMPLATES.length + 2);
    });

    it('should filter by category', () => {
      const { templates, total } = listTemplates({ category: 'custom' });
      expect(total).toBe(1);
      expect(templates.every(t => t.category === 'custom')).toBe(true);
    });

    it('should filter by builtIn', () => {
      const builtIn = listTemplates({ builtIn: true });
      expect(builtIn.total).toBe(BUILT_IN_TEMPLATES.length);

      const custom = listTemplates({ builtIn: false });
      expect(custom.total).toBe(2);
    });

    it('should paginate results', () => {
      const page1 = listTemplates({ limit: 3, offset: 0 });
      expect(page1.configs?.length || page1.templates.length).toBe(3);

      const page2 = listTemplates({ limit: 3, offset: 3 });
      expect(page2.templates.length).toBe(Math.min(3, BUILT_IN_TEMPLATES.length + 2 - 3));
    });

    it('should order by builtIn first, then category, then name', () => {
      const { templates } = listTemplates();

      // Built-in templates should come first
      const firstBuiltInIndex = templates.findIndex(t => t.builtIn);
      const lastBuiltInIndex = templates.map(t => t.builtIn).lastIndexOf(true);

      // All built-in should be contiguous at the start
      expect(firstBuiltInIndex).toBe(0);
      for (let i = firstBuiltInIndex; i <= lastBuiltInIndex; i++) {
        expect(templates[i].builtIn).toBe(true);
      }
    });
  });

  describe('updateTemplate', () => {
    it('should update template fields', () => {
      const created = createTemplate(validTemplate, testUser);
      const updated = updateTemplate(created.id, {
        description: 'Updated description',
        config: { ...created.config, width: 1280 }
      }, testUser);

      expect(updated.description).toBe('Updated description');
      expect(updated.config.width).toBe(1280);
    });

    it('should allow updating name to unique value', () => {
      const created = createTemplate(validTemplate, testUser);
      const updated = updateTemplate(created.id, { name: 'New Name' }, testUser);

      expect(updated.name).toBe('New Name');
    });

    it('should reject updating name to existing name', () => {
      createTemplate(validTemplate, testUser);
      const second = createTemplate({ ...validTemplate, name: 'Second Template' }, testUser);

      expect(() => updateTemplate(second.id, { name: 'Test Template' }, testUser))
        .toThrow(TemplateValidationError);
    });

    it('should throw for non-existent id', () => {
      expect(() => updateTemplate('non-existent', { description: 'test' }, testUser))
        .toThrow(TemplateValidationError);
    });

    it('should not allow updating built-in templates', () => {
      initializeBuiltInTemplates();
      const { templates } = listTemplates({ builtIn: true });
      const builtIn = templates[0];

      expect(() => updateTemplate(builtIn.id, { description: 'hacked' }, testUser))
        .toThrow(TemplateValidationError);
    });
  });

  describe('deleteTemplate', () => {
    it('should delete existing template', () => {
      const created = createTemplate(validTemplate, testUser);
      const result = deleteTemplate(created.id, testUser);

      expect(result).toBe(true);
      expect(getTemplate(created.id)).toBeNull();
    });

    it('should return false for non-existent id', () => {
      const result = deleteTemplate('non-existent', testUser);
      expect(result).toBe(false);
    });

    it('should not allow deleting built-in templates', () => {
      initializeBuiltInTemplates();
      const { templates } = listTemplates({ builtIn: true });
      const builtIn = templates[0];

      expect(() => deleteTemplate(builtIn.id, testUser))
        .toThrow(TemplateValidationError);
    });

    it('should only allow creator to delete custom template', () => {
      const created = createTemplate(validTemplate, testUser);

      // Other user should not be able to delete
      expect(() => deleteTemplate(created.id, testUser2))
        .toThrow(TemplateValidationError);
    });
  });

  describe('applyTemplate', () => {
    it('should merge template config with overrides', () => {
      const template = createTemplate(validTemplate, testUser);
      const result = applyTemplate(template.id, {
        name: 'my-stream',
        url: 'https://example.com',
        ingest: 'srt://localhost:9000'
      });

      // Should have template values
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.preset).toBe('veryfast');

      // Should have overrides
      expect(result.name).toBe('my-stream');
      expect(result.url).toBe('https://example.com');
      expect(result.ingest).toBe('srt://localhost:9000');

      // Should have defaults for missing values
      expect(result.enabled).toBe(STREAM_CONFIG_DEFAULTS.enabled);
    });

    it('should throw for non-existent template', () => {
      expect(() => applyTemplate('non-existent', {
        name: 'test',
        url: 'https://example.com',
        ingest: 'srt://localhost:9000'
      })).toThrow(TemplateValidationError);
    });

    it('should allow additional overrides', () => {
      const template = createTemplate(validTemplate, testUser);
      const result = applyTemplate(template.id, {
        name: 'my-stream',
        url: 'https://example.com',
        ingest: 'srt://localhost:9000',
        width: 1280,
        enabled: false
      });

      expect(result.width).toBe(1280);
      expect(result.enabled).toBe(false);
    });
  });

  describe('createTemplateFromConfig', () => {
    it('should create template from stream config', () => {
      const streamConfig: StreamConfigCreate = {
        name: 'my-stream',
        type: 'standard',
        enabled: true,
        url: 'https://example.com',
        width: 1920,
        height: 1080,
        fps: 30,
        cropInfobar: 0,
        preset: 'fast',
        videoBitrate: '4000k',
        audioBitrate: '192k',
        format: 'flv',
        ingest: 'rtmp://localhost/live',
        autoRefreshSeconds: 300,
        reconnectAttempts: 5,
        reconnectInitialDelayMs: 2000,
        reconnectMaxDelayMs: 60000,
        healthIntervalSeconds: 15
      };

      const template = createTemplateFromConfig(
        'From Stream',
        'Template created from my-stream',
        'standard',
        streamConfig,
        testUser
      );

      // Should have config values (except stream-specific fields)
      expect(template.config.preset).toBe('fast');
      expect(template.config.videoBitrate).toBe('4000k');
      expect(template.config.format).toBe('flv');
      expect(template.config.autoRefreshSeconds).toBe(300);

      // Should not include stream-specific fields
      expect((template.config as StreamConfigCreate).name).toBeUndefined();
      expect((template.config as StreamConfigCreate).url).toBeUndefined();
      expect((template.config as StreamConfigCreate).ingest).toBeUndefined();
    });

    it('should track creator', () => {
      const streamConfig: StreamConfigCreate = {
        ...STREAM_CONFIG_DEFAULTS,
        name: 'test',
        url: 'https://example.com',
        ingest: 'srt://localhost:9000'
      };

      const template = createTemplateFromConfig(
        'My Template',
        'Test description',
        'custom',
        streamConfig,
        testUser
      );

      expect(template.createdBy).toBe('test-user');
      expect(template.builtIn).toBe(false);
    });
  });
});
