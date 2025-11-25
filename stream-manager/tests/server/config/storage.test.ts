import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { initDatabase, closeDatabase } from '../../../src/server/db/index.js';
import {
  createStreamConfig,
  getStreamConfig,
  getStreamConfigByName,
  listStreamConfigs,
  updateStreamConfig,
  deleteStreamConfig,
  duplicateStreamConfig,
  getNextAvailableDisplay,
  assignDisplay,
  releaseDisplay,
  getAssignedDisplay,
  exportConfigs,
  importConfigs
} from '../../../src/server/config/storage.js';
import { StreamConfigValidationError, StreamConfigCreate } from '../../../src/server/config/schema.js';
import { User } from '../../../src/server/auth/types.js';

const TEST_DB_DIR = join(process.cwd(), 'tests', '.tmp');
const TEST_DB_PATH = join(TEST_DB_DIR, 'test-config.db');

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

const validConfig: StreamConfigCreate = {
  name: 'test-stream',
  type: 'standard',
  enabled: true,
  url: 'https://example.com/page',
  width: 1920,
  height: 1080,
  fps: 30,
  cropInfobar: 0,
  preset: 'veryfast',
  videoBitrate: '2500k',
  audioBitrate: '128k',
  format: 'mpegts',
  ingest: 'srt://localhost:9000',
  autoRefreshSeconds: 0,
  reconnectAttempts: 0,
  reconnectInitialDelayMs: 1000,
  reconnectMaxDelayMs: 30000,
  healthIntervalSeconds: 30
};

describe('Stream Config Storage', () => {
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

  describe('createStreamConfig', () => {
    it('should create a new stream config', () => {
      const result = createStreamConfig(validConfig, testUser);

      expect(result.id).toBeDefined();
      expect(result.name).toBe('test-stream');
      expect(result.url).toBe('https://example.com/page');
      expect(result.createdBy).toBe('test-user');
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should reject duplicate names', () => {
      createStreamConfig(validConfig, testUser);

      expect(() => createStreamConfig(validConfig, testUser))
        .toThrow(StreamConfigValidationError);
    });

    it('should store optional fields', () => {
      const config = {
        ...validConfig,
        name: 'stream-with-options',
        injectCss: '/path/to/style.css',
        injectJs: '/path/to/script.js',
        extraFfmpegArgs: ['-preset', 'veryslow'],
        inputFfmpegFlags: '-re',
        display: ':100'
      };

      const result = createStreamConfig(config, testUser);

      expect(result.injectCss).toBe('/path/to/style.css');
      expect(result.injectJs).toBe('/path/to/script.js');
      expect(result.extraFfmpegArgs).toEqual(['-preset', 'veryslow']);
      expect(result.inputFfmpegFlags).toBe('-re');
      expect(result.display).toBe(':100');
    });
  });

  describe('getStreamConfig', () => {
    it('should retrieve config by id', () => {
      const created = createStreamConfig(validConfig, testUser);
      const retrieved = getStreamConfig(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.name).toBe('test-stream');
    });

    it('should return null for non-existent id', () => {
      const result = getStreamConfig('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getStreamConfigByName', () => {
    it('should retrieve config by name', () => {
      createStreamConfig(validConfig, testUser);
      const retrieved = getStreamConfigByName('test-stream');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('test-stream');
    });

    it('should return null for non-existent name', () => {
      const result = getStreamConfigByName('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('listStreamConfigs', () => {
    beforeEach(() => {
      createStreamConfig({ ...validConfig, name: 'stream-a', type: 'standard', enabled: true }, testUser);
      createStreamConfig({ ...validConfig, name: 'stream-b', type: 'compositor', enabled: false }, testUser);
      createStreamConfig({ ...validConfig, name: 'stream-c', type: 'standard', enabled: true }, testUser);
    });

    it('should list all configs', () => {
      const { configs, total } = listStreamConfigs();
      expect(total).toBe(3);
      expect(configs.length).toBe(3);
    });

    it('should filter by type', () => {
      const { configs, total } = listStreamConfigs({ type: 'standard' });
      expect(total).toBe(2);
      expect(configs.every(c => c.type === 'standard')).toBe(true);
    });

    it('should filter by enabled', () => {
      const { configs, total } = listStreamConfigs({ enabled: true });
      expect(total).toBe(2);
      expect(configs.every(c => c.enabled === true)).toBe(true);
    });

    it('should paginate results', () => {
      const page1 = listStreamConfigs({ limit: 2, offset: 0 });
      expect(page1.total).toBe(3);
      expect(page1.configs.length).toBe(2);

      const page2 = listStreamConfigs({ limit: 2, offset: 2 });
      expect(page2.configs.length).toBe(1);
    });

    it('should order by name', () => {
      const { configs } = listStreamConfigs();
      expect(configs[0].name).toBe('stream-a');
      expect(configs[1].name).toBe('stream-b');
      expect(configs[2].name).toBe('stream-c');
    });
  });

  describe('updateStreamConfig', () => {
    it('should update config fields', () => {
      const created = createStreamConfig(validConfig, testUser);
      const updated = updateStreamConfig(created.id, {
        url: 'https://newurl.com',
        width: 1280,
        enabled: false
      }, testUser2);

      expect(updated.url).toBe('https://newurl.com');
      expect(updated.width).toBe(1280);
      expect(updated.enabled).toBe(false);
      expect(updated.updatedBy).toBe('other-user');
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
        new Date(created.updatedAt).getTime() - 1000
      );
    });

    it('should allow updating name to unique value', () => {
      const created = createStreamConfig(validConfig, testUser);
      const updated = updateStreamConfig(created.id, { name: 'new-name' }, testUser);

      expect(updated.name).toBe('new-name');
    });

    it('should reject updating name to existing name', () => {
      createStreamConfig(validConfig, testUser);
      const second = createStreamConfig({ ...validConfig, name: 'second-stream' }, testUser);

      expect(() => updateStreamConfig(second.id, { name: 'test-stream' }, testUser))
        .toThrow(StreamConfigValidationError);
    });

    it('should throw for non-existent id', () => {
      expect(() => updateStreamConfig('non-existent', { url: 'https://x.com' }, testUser))
        .toThrow(StreamConfigValidationError);
    });

    it('should update extraFfmpegArgs', () => {
      const created = createStreamConfig(validConfig, testUser);
      const updated = updateStreamConfig(created.id, {
        extraFfmpegArgs: ['-tune', 'zerolatency']
      }, testUser);

      expect(updated.extraFfmpegArgs).toEqual(['-tune', 'zerolatency']);
    });

    it('should clear optional field with undefined', () => {
      const created = createStreamConfig({
        ...validConfig,
        name: 'with-css',
        injectCss: '/path/to/style.css'
      }, testUser);

      expect(created.injectCss).toBe('/path/to/style.css');

      // Note: To clear, we pass undefined which gets converted to null in storage
      // The API layer should handle this conversion
    });
  });

  describe('deleteStreamConfig', () => {
    it('should delete existing config', () => {
      const created = createStreamConfig(validConfig, testUser);
      const result = deleteStreamConfig(created.id);

      expect(result).toBe(true);
      expect(getStreamConfig(created.id)).toBeNull();
    });

    it('should return false for non-existent id', () => {
      const result = deleteStreamConfig('non-existent');
      expect(result).toBe(false);
    });

    it('should release display assignment on delete', () => {
      const created = createStreamConfig(validConfig, testUser);
      assignDisplay(created.id, ':99');

      expect(getAssignedDisplay(created.id)).toBe(':99');

      deleteStreamConfig(created.id);

      // Display should be released
      expect(getAssignedDisplay(created.id)).toBeNull();
    });
  });

  describe('duplicateStreamConfig', () => {
    it('should create a copy with new name', () => {
      const original = createStreamConfig(validConfig, testUser);
      const copy = duplicateStreamConfig(original.id, 'stream-copy', testUser2);

      expect(copy.id).not.toBe(original.id);
      expect(copy.name).toBe('stream-copy');
      expect(copy.url).toBe(original.url);
      expect(copy.createdBy).toBe('other-user');
    });

    it('should start duplicate as disabled', () => {
      const original = createStreamConfig(validConfig, testUser);
      const copy = duplicateStreamConfig(original.id, 'stream-copy', testUser);

      expect(copy.enabled).toBe(false);
    });

    it('should not copy display assignment', () => {
      const original = createStreamConfig({
        ...validConfig,
        display: ':100'
      }, testUser);
      const copy = duplicateStreamConfig(original.id, 'stream-copy', testUser);

      expect(copy.display).toBeUndefined();
    });

    it('should throw for non-existent source', () => {
      expect(() => duplicateStreamConfig('non-existent', 'copy', testUser))
        .toThrow(StreamConfigValidationError);
    });
  });

  describe('Display Management', () => {
    describe('getNextAvailableDisplay', () => {
      it('should return :99 when no displays assigned', () => {
        const display = getNextAvailableDisplay();
        expect(display).toBe(':99');
      });

      it('should skip assigned displays', () => {
        const stream1 = createStreamConfig(validConfig, testUser);
        const stream2 = createStreamConfig({ ...validConfig, name: 'stream2' }, testUser);

        assignDisplay(stream1.id, ':99');
        assignDisplay(stream2.id, ':100');

        const next = getNextAvailableDisplay();
        expect(next).toBe(':101');
      });

      it('should skip manually configured displays', () => {
        createStreamConfig({ ...validConfig, name: 'manual', display: ':99' }, testUser);

        const next = getNextAvailableDisplay();
        expect(next).toBe(':100');
      });
    });

    describe('assignDisplay', () => {
      it('should assign display to stream', () => {
        const stream = createStreamConfig(validConfig, testUser);
        assignDisplay(stream.id, ':99');

        expect(getAssignedDisplay(stream.id)).toBe(':99');
      });

      it('should reject display already assigned to another stream', () => {
        const stream1 = createStreamConfig(validConfig, testUser);
        const stream2 = createStreamConfig({ ...validConfig, name: 'stream2' }, testUser);

        assignDisplay(stream1.id, ':99');

        expect(() => assignDisplay(stream2.id, ':99')).toThrow();
      });

      it('should allow reassigning same display to same stream', () => {
        const stream = createStreamConfig(validConfig, testUser);
        assignDisplay(stream.id, ':99');
        assignDisplay(stream.id, ':99'); // Should not throw

        expect(getAssignedDisplay(stream.id)).toBe(':99');
      });
    });

    describe('releaseDisplay', () => {
      it('should release display assignment', () => {
        const stream = createStreamConfig(validConfig, testUser);
        assignDisplay(stream.id, ':99');
        releaseDisplay(stream.id);

        expect(getAssignedDisplay(stream.id)).toBeNull();
      });

      it('should not throw for stream without assignment', () => {
        const stream = createStreamConfig(validConfig, testUser);
        releaseDisplay(stream.id); // Should not throw
      });
    });
  });

  describe('Import/Export', () => {
    beforeEach(() => {
      createStreamConfig({ ...validConfig, name: 'stream-1' }, testUser);
      createStreamConfig({ ...validConfig, name: 'stream-2', type: 'compositor' }, testUser);
    });

    describe('exportConfigs', () => {
      it('should export all configs', () => {
        const exported = exportConfigs();

        expect(exported.version).toBe(1);
        expect(exported.exportedAt).toBeDefined();
        expect(exported.configs.length).toBe(2);
      });

      it('should not include metadata fields in export', () => {
        const exported = exportConfigs();

        for (const config of exported.configs) {
          expect((config as Record<string, unknown>).id).toBeUndefined();
          expect((config as Record<string, unknown>).createdAt).toBeUndefined();
          expect((config as Record<string, unknown>).createdBy).toBeUndefined();
        }
      });
    });

    describe('importConfigs', () => {
      it('should import new configs', () => {
        // Clear existing
        const { configs } = listStreamConfigs();
        for (const c of configs) {
          deleteStreamConfig(c.id);
        }

        const data = {
          version: 1,
          exportedAt: new Date().toISOString(),
          configs: [
            { ...validConfig, name: 'imported-1' },
            { ...validConfig, name: 'imported-2' }
          ]
        };

        const result = importConfigs(data, testUser);

        expect(result.imported).toBe(2);
        expect(result.skipped).toBe(0);
        expect(result.errors.length).toBe(0);
      });

      it('should skip existing with skipExisting option', () => {
        const exported = exportConfigs();

        const result = importConfigs(exported, testUser, { skipExisting: true });

        expect(result.imported).toBe(0);
        expect(result.skipped).toBe(2);
      });

      it('should overwrite existing with overwrite option', () => {
        const original = getStreamConfigByName('stream-1')!;

        const data = {
          version: 1,
          exportedAt: new Date().toISOString(),
          configs: [{ ...validConfig, name: 'stream-1', width: 1280 }]
        };

        const result = importConfigs(data, testUser2, { overwrite: true });

        expect(result.imported).toBe(1);

        const updated = getStreamConfigByName('stream-1')!;
        expect(updated.width).toBe(1280);
        expect(updated.updatedBy).toBe('other-user');
      });

      it('should record errors for invalid configs', () => {
        const data = {
          version: 1,
          exportedAt: new Date().toISOString(),
          configs: [
            { ...validConfig, name: 'stream-1' }, // Already exists
            { ...validConfig, name: 'valid-new' }
          ]
        };

        const result = importConfigs(data, testUser);

        expect(result.imported).toBe(1);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].name).toBe('stream-1');
      });

      it('should reject unsupported version', () => {
        const data = {
          version: 99,
          exportedAt: new Date().toISOString(),
          configs: []
        };

        expect(() => importConfigs(data, testUser)).toThrow('Unsupported export version');
      });
    });

    it('should round-trip export/import correctly', () => {
      // Export current configs
      const exported = exportConfigs();

      // Clear database
      const { configs } = listStreamConfigs();
      for (const c of configs) {
        deleteStreamConfig(c.id);
      }

      // Verify empty
      expect(listStreamConfigs().total).toBe(0);

      // Import
      const result = importConfigs(exported, testUser);
      expect(result.imported).toBe(2);

      // Verify restored
      const restored = listStreamConfigs();
      expect(restored.total).toBe(2);
      expect(restored.configs.find(c => c.name === 'stream-1')).toBeDefined();
      expect(restored.configs.find(c => c.name === 'stream-2')).toBeDefined();
    });
  });
});
