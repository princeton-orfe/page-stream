import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import {
  validateCompositorConfig,
  validatePartialCompositorConfig,
  CompositorConfigValidationError,
  generateFilterComplex,
  CompositorConfigCreate
} from '../../src/server/compositor/schema.js';

// Test database setup
let testDb: Database.Database;

function setupTestDb() {
  testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');

  // Create compositors table
  testDb.exec(`
    CREATE TABLE compositors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      layout TEXT NOT NULL DEFAULT 'side-by-side',
      inputs TEXT NOT NULL,
      custom_filter_complex TEXT,
      pip_config TEXT,
      output_width INTEGER NOT NULL DEFAULT 1920,
      output_height INTEGER NOT NULL DEFAULT 1080,
      output_fps INTEGER NOT NULL DEFAULT 30,
      preset TEXT NOT NULL DEFAULT 'ultrafast',
      video_bitrate TEXT NOT NULL DEFAULT '3000k',
      audio_bitrate TEXT NOT NULL DEFAULT '128k',
      format TEXT NOT NULL DEFAULT 'mpegts',
      output_ingest TEXT NOT NULL,
      extra_ffmpeg_args TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT NOT NULL,
      updated_by TEXT
    )
  `);

  return testDb;
}

describe('Compositor Schema Validation', () => {
  describe('validateCompositorConfig', () => {
    it('should validate a minimal valid config', () => {
      const config = {
        name: 'test-compositor',
        inputs: [
          { name: 'left', listenPort: 10001 },
          { name: 'right', listenPort: 10002 }
        ],
        outputIngest: 'srt://localhost:9000'
      };

      const validated = validateCompositorConfig(config);
      expect(validated.name).toBe('test-compositor');
      expect(validated.layout).toBe('side-by-side');
      expect(validated.enabled).toBe(true);
      expect(validated.outputWidth).toBe(1920);
      expect(validated.outputHeight).toBe(1080);
      expect(validated.inputs.length).toBe(2);
    });

    it('should validate a full config with all fields', () => {
      const config = {
        name: 'full-compositor',
        enabled: false,
        layout: 'stacked',
        inputs: [
          { name: 'top', listenPort: 10001, width: 1920, height: 540 },
          { name: 'bottom', listenPort: 10002, width: 1920, height: 540 }
        ],
        outputWidth: 1920,
        outputHeight: 1080,
        outputFps: 60,
        preset: 'superfast',
        videoBitrate: '5M',
        audioBitrate: '192k',
        format: 'flv',
        outputIngest: 'rtmp://localhost/live/stream',
        extraFfmpegArgs: ['-tune', 'zerolatency']
      };

      const validated = validateCompositorConfig(config);
      expect(validated.layout).toBe('stacked');
      expect(validated.enabled).toBe(false);
      expect(validated.outputFps).toBe(60);
      expect(validated.preset).toBe('superfast');
      expect(validated.extraFfmpegArgs).toEqual(['-tune', 'zerolatency']);
    });

    it('should reject missing name', () => {
      const config = {
        inputs: [
          { name: 'left', listenPort: 10001 },
          { name: 'right', listenPort: 10002 }
        ],
        outputIngest: 'srt://localhost:9000'
      };

      expect(() => validateCompositorConfig(config)).toThrow(CompositorConfigValidationError);
    });

    it('should reject invalid name format', () => {
      const config = {
        name: 'invalid name with spaces',
        inputs: [
          { name: 'left', listenPort: 10001 },
          { name: 'right', listenPort: 10002 }
        ],
        outputIngest: 'srt://localhost:9000'
      };

      expect(() => validateCompositorConfig(config)).toThrow(/must start with alphanumeric/);
    });

    it('should reject less than 2 inputs', () => {
      const config = {
        name: 'test',
        inputs: [
          { name: 'single', listenPort: 10001 }
        ],
        outputIngest: 'srt://localhost:9000'
      };

      expect(() => validateCompositorConfig(config)).toThrow(/At least 2 inputs/);
    });

    it('should reject more than 4 inputs', () => {
      const config = {
        name: 'test',
        inputs: [
          { name: 'a', listenPort: 10001 },
          { name: 'b', listenPort: 10002 },
          { name: 'c', listenPort: 10003 },
          { name: 'd', listenPort: 10004 },
          { name: 'e', listenPort: 10005 }
        ],
        outputIngest: 'srt://localhost:9000'
      };

      expect(() => validateCompositorConfig(config)).toThrow(/Maximum 4 inputs/);
    });

    it('should reject duplicate input names', () => {
      const config = {
        name: 'test',
        inputs: [
          { name: 'left', listenPort: 10001 },
          { name: 'left', listenPort: 10002 }
        ],
        outputIngest: 'srt://localhost:9000'
      };

      expect(() => validateCompositorConfig(config)).toThrow(/Duplicate input name/);
    });

    it('should reject duplicate listen ports', () => {
      const config = {
        name: 'test',
        inputs: [
          { name: 'left', listenPort: 10001 },
          { name: 'right', listenPort: 10001 }
        ],
        outputIngest: 'srt://localhost:9000'
      };

      expect(() => validateCompositorConfig(config)).toThrow(/Duplicate listen port/);
    });

    it('should reject invalid listen port range', () => {
      const config = {
        name: 'test',
        inputs: [
          { name: 'left', listenPort: 9999 },
          { name: 'right', listenPort: 10002 }
        ],
        outputIngest: 'srt://localhost:9000'
      };

      expect(() => validateCompositorConfig(config)).toThrow(/listenPort must be between/);
    });

    it('should reject invalid ingest URL', () => {
      const config = {
        name: 'test',
        inputs: [
          { name: 'left', listenPort: 10001 },
          { name: 'right', listenPort: 10002 }
        ],
        outputIngest: 'http://localhost:9000'
      };

      expect(() => validateCompositorConfig(config)).toThrow(/must be srt:\/\/ or rtmp:\/\//);
    });

    it('should validate PIP layout with pipConfig', () => {
      const config = {
        name: 'pip-compositor',
        layout: 'pip',
        inputs: [
          { name: 'main', listenPort: 10001 },
          { name: 'overlay', listenPort: 10002 }
        ],
        pipConfig: {
          mainInput: 'main',
          pipInput: 'overlay',
          position: 'bottom-right',
          pipScale: 0.25,
          margin: 20
        },
        outputIngest: 'srt://localhost:9000'
      };

      const validated = validateCompositorConfig(config);
      expect(validated.layout).toBe('pip');
      expect(validated.pipConfig).toBeDefined();
      expect(validated.pipConfig?.position).toBe('bottom-right');
    });

    it('should reject PIP layout without pipConfig', () => {
      const config = {
        name: 'pip-compositor',
        layout: 'pip',
        inputs: [
          { name: 'main', listenPort: 10001 },
          { name: 'overlay', listenPort: 10002 }
        ],
        outputIngest: 'srt://localhost:9000'
      };

      expect(() => validateCompositorConfig(config)).toThrow(/PIP layout requires pipConfig/);
    });

    it('should reject PIP with invalid input references', () => {
      const config = {
        name: 'pip-compositor',
        layout: 'pip',
        inputs: [
          { name: 'main', listenPort: 10001 },
          { name: 'overlay', listenPort: 10002 }
        ],
        pipConfig: {
          mainInput: 'main',
          pipInput: 'invalid',
          position: 'bottom-right',
          pipScale: 0.25,
          margin: 20
        },
        outputIngest: 'srt://localhost:9000'
      };

      expect(() => validateCompositorConfig(config)).toThrow(/must match an input name/);
    });

    it('should require customFilterComplex for custom layout', () => {
      const config = {
        name: 'custom-compositor',
        layout: 'custom',
        inputs: [
          { name: 'a', listenPort: 10001 },
          { name: 'b', listenPort: 10002 }
        ],
        outputIngest: 'srt://localhost:9000'
      };

      expect(() => validateCompositorConfig(config)).toThrow(/Custom layout requires customFilterComplex/);
    });

    it('should validate custom layout with customFilterComplex', () => {
      const config = {
        name: 'custom-compositor',
        layout: 'custom',
        inputs: [
          { name: 'a', listenPort: 10001 },
          { name: 'b', listenPort: 10002 }
        ],
        customFilterComplex: '[0:v][1:v]overlay=10:10[outv]',
        outputIngest: 'srt://localhost:9000'
      };

      const validated = validateCompositorConfig(config);
      expect(validated.layout).toBe('custom');
      expect(validated.customFilterComplex).toBe('[0:v][1:v]overlay=10:10[outv]');
    });
  });

  describe('validatePartialCompositorConfig', () => {
    it('should validate partial updates', () => {
      const updates = {
        name: 'new-name',
        enabled: false
      };

      const validated = validatePartialCompositorConfig(updates);
      expect(validated.name).toBe('new-name');
      expect(validated.enabled).toBe(false);
    });

    it('should validate output dimension changes', () => {
      const updates = {
        outputWidth: 3840,
        outputHeight: 2160
      };

      const validated = validatePartialCompositorConfig(updates);
      expect(validated.outputWidth).toBe(3840);
      expect(validated.outputHeight).toBe(2160);
    });

    it('should reject invalid values in updates', () => {
      const updates = {
        outputWidth: 100 // Below minimum
      };

      expect(() => validatePartialCompositorConfig(updates)).toThrow(/must be between/);
    });
  });

  describe('generateFilterComplex', () => {
    it('should generate side-by-side filter', () => {
      const config: CompositorConfigCreate = {
        name: 'test',
        layout: 'side-by-side',
        inputs: [
          { name: 'left', listenPort: 10001 },
          { name: 'right', listenPort: 10002 }
        ],
        outputWidth: 1920,
        outputHeight: 1080,
        outputFps: 30,
        preset: 'ultrafast',
        videoBitrate: '3000k',
        audioBitrate: '128k',
        format: 'mpegts',
        outputIngest: 'srt://localhost:9000',
        enabled: true
      };

      const filter = generateFilterComplex(config);
      expect(filter).toContain('hstack');
      expect(filter).toContain('960');
      expect(filter).toContain('1080');
    });

    it('should generate stacked filter', () => {
      const config: CompositorConfigCreate = {
        name: 'test',
        layout: 'stacked',
        inputs: [
          { name: 'top', listenPort: 10001 },
          { name: 'bottom', listenPort: 10002 }
        ],
        outputWidth: 1920,
        outputHeight: 1080,
        outputFps: 30,
        preset: 'ultrafast',
        videoBitrate: '3000k',
        audioBitrate: '128k',
        format: 'mpegts',
        outputIngest: 'srt://localhost:9000',
        enabled: true
      };

      const filter = generateFilterComplex(config);
      expect(filter).toContain('vstack');
      expect(filter).toContain('1920');
      expect(filter).toContain('540');
    });

    it('should generate grid filter for 4 inputs', () => {
      const config: CompositorConfigCreate = {
        name: 'test',
        layout: 'grid',
        inputs: [
          { name: 'tl', listenPort: 10001 },
          { name: 'tr', listenPort: 10002 },
          { name: 'bl', listenPort: 10003 },
          { name: 'br', listenPort: 10004 }
        ],
        outputWidth: 1920,
        outputHeight: 1080,
        outputFps: 30,
        preset: 'ultrafast',
        videoBitrate: '3000k',
        audioBitrate: '128k',
        format: 'mpegts',
        outputIngest: 'srt://localhost:9000',
        enabled: true
      };

      const filter = generateFilterComplex(config);
      expect(filter).toContain('hstack');
      expect(filter).toContain('vstack');
      expect(filter).toContain('960');
      expect(filter).toContain('540');
    });

    it('should generate PIP filter', () => {
      const config: CompositorConfigCreate = {
        name: 'test',
        layout: 'pip',
        inputs: [
          { name: 'main', listenPort: 10001 },
          { name: 'pip', listenPort: 10002 }
        ],
        pipConfig: {
          mainInput: 'main',
          pipInput: 'pip',
          position: 'bottom-right',
          pipScale: 0.25,
          margin: 20
        },
        outputWidth: 1920,
        outputHeight: 1080,
        outputFps: 30,
        preset: 'ultrafast',
        videoBitrate: '3000k',
        audioBitrate: '128k',
        format: 'mpegts',
        outputIngest: 'srt://localhost:9000',
        enabled: true
      };

      const filter = generateFilterComplex(config);
      expect(filter).toContain('overlay');
      expect(filter).toContain('W-w-20');
      expect(filter).toContain('H-h-20');
    });

    it('should return custom filter for custom layout', () => {
      const config: CompositorConfigCreate = {
        name: 'test',
        layout: 'custom',
        inputs: [
          { name: 'a', listenPort: 10001 },
          { name: 'b', listenPort: 10002 }
        ],
        customFilterComplex: '[0:v][1:v]blend=all_mode=average[outv]',
        outputWidth: 1920,
        outputHeight: 1080,
        outputFps: 30,
        preset: 'ultrafast',
        videoBitrate: '3000k',
        audioBitrate: '128k',
        format: 'mpegts',
        outputIngest: 'srt://localhost:9000',
        enabled: true
      };

      const filter = generateFilterComplex(config);
      expect(filter).toBe('[0:v][1:v]blend=all_mode=average[outv]');
    });
  });
});

describe('Compositor Layout Validation', () => {
  it('should require exactly 2 inputs for side-by-side', () => {
    const config = {
      name: 'test',
      layout: 'side-by-side',
      inputs: [
        { name: 'a', listenPort: 10001 },
        { name: 'b', listenPort: 10002 },
        { name: 'c', listenPort: 10003 }
      ],
      outputIngest: 'srt://localhost:9000'
    };

    expect(() => validateCompositorConfig(config)).toThrow(/requires exactly 2 inputs/);
  });

  it('should require exactly 2 inputs for stacked', () => {
    const config = {
      name: 'test',
      layout: 'stacked',
      inputs: [
        { name: 'a', listenPort: 10001 },
        { name: 'b', listenPort: 10002 },
        { name: 'c', listenPort: 10003 }
      ],
      outputIngest: 'srt://localhost:9000'
    };

    expect(() => validateCompositorConfig(config)).toThrow(/requires exactly 2 inputs/);
  });

  it('should require exactly 2 inputs for PIP', () => {
    const config = {
      name: 'test',
      layout: 'pip',
      inputs: [
        { name: 'a', listenPort: 10001 },
        { name: 'b', listenPort: 10002 },
        { name: 'c', listenPort: 10003 }
      ],
      pipConfig: {
        mainInput: 'a',
        pipInput: 'b',
        position: 'top-left',
        pipScale: 0.25,
        margin: 20
      },
      outputIngest: 'srt://localhost:9000'
    };

    expect(() => validateCompositorConfig(config)).toThrow(/requires exactly 2 inputs/);
  });

  it('should allow 2-4 inputs for grid layout', () => {
    // 2 inputs - should work
    const config2 = {
      name: 'test',
      layout: 'grid',
      inputs: [
        { name: 'a', listenPort: 10001 },
        { name: 'b', listenPort: 10002 }
      ],
      outputIngest: 'srt://localhost:9000'
    };
    expect(() => validateCompositorConfig(config2)).not.toThrow();

    // 3 inputs - should work
    const config3 = {
      name: 'test',
      layout: 'grid',
      inputs: [
        { name: 'a', listenPort: 10001 },
        { name: 'b', listenPort: 10002 },
        { name: 'c', listenPort: 10003 }
      ],
      outputIngest: 'srt://localhost:9000'
    };
    expect(() => validateCompositorConfig(config3)).not.toThrow();

    // 4 inputs - should work
    const config4 = {
      name: 'test',
      layout: 'grid',
      inputs: [
        { name: 'a', listenPort: 10001 },
        { name: 'b', listenPort: 10002 },
        { name: 'c', listenPort: 10003 },
        { name: 'd', listenPort: 10004 }
      ],
      outputIngest: 'srt://localhost:9000'
    };
    expect(() => validateCompositorConfig(config4)).not.toThrow();
  });
});
