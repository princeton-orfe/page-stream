import { describe, it, expect } from 'vitest';
import {
  validateStreamConfig,
  validatePartialStreamConfig,
  StreamConfigValidationError,
  STREAM_CONFIG_DEFAULTS
} from '../../../src/server/config/schema.js';

describe('StreamConfig Schema', () => {
  const validConfig = {
    name: 'test-stream',
    url: 'https://example.com/page',
    ingest: 'srt://localhost:9000'
  };

  describe('validateStreamConfig', () => {
    it('should accept valid minimal config', () => {
      const result = validateStreamConfig(validConfig);

      expect(result.name).toBe('test-stream');
      expect(result.url).toBe('https://example.com/page');
      expect(result.ingest).toBe('srt://localhost:9000');
    });

    it('should apply defaults for optional fields', () => {
      const result = validateStreamConfig(validConfig);

      expect(result.type).toBe(STREAM_CONFIG_DEFAULTS.type);
      expect(result.enabled).toBe(STREAM_CONFIG_DEFAULTS.enabled);
      expect(result.width).toBe(STREAM_CONFIG_DEFAULTS.width);
      expect(result.height).toBe(STREAM_CONFIG_DEFAULTS.height);
      expect(result.fps).toBe(STREAM_CONFIG_DEFAULTS.fps);
      expect(result.preset).toBe(STREAM_CONFIG_DEFAULTS.preset);
      expect(result.videoBitrate).toBe(STREAM_CONFIG_DEFAULTS.videoBitrate);
      expect(result.audioBitrate).toBe(STREAM_CONFIG_DEFAULTS.audioBitrate);
      expect(result.format).toBe(STREAM_CONFIG_DEFAULTS.format);
    });

    it('should accept full config with all fields', () => {
      const fullConfig = {
        ...validConfig,
        type: 'compositor-source',
        enabled: false,
        injectCss: '/path/to/style.css',
        injectJs: './script.js',
        width: 1280,
        height: 720,
        fps: 60,
        cropInfobar: 50,
        preset: 'fast',
        videoBitrate: '5M',
        audioBitrate: '256k',
        format: 'flv',
        autoRefreshSeconds: 3600,
        reconnectAttempts: 10,
        reconnectInitialDelayMs: 2000,
        reconnectMaxDelayMs: 60000,
        healthIntervalSeconds: 60,
        extraFfmpegArgs: ['-preset', 'veryslow'],
        inputFfmpegFlags: '-re',
        display: ':100'
      };

      const result = validateStreamConfig(fullConfig);

      expect(result.type).toBe('compositor-source');
      expect(result.enabled).toBe(false);
      expect(result.width).toBe(1280);
      expect(result.extraFfmpegArgs).toEqual(['-preset', 'veryslow']);
      expect(result.display).toBe(':100');
    });

    describe('name validation', () => {
      it('should reject empty name', () => {
        expect(() => validateStreamConfig({ ...validConfig, name: '' }))
          .toThrow(StreamConfigValidationError);
      });

      it('should reject name starting with hyphen', () => {
        expect(() => validateStreamConfig({ ...validConfig, name: '-invalid' }))
          .toThrow(StreamConfigValidationError);
      });

      it('should reject name with special characters', () => {
        expect(() => validateStreamConfig({ ...validConfig, name: 'test@stream' }))
          .toThrow(StreamConfigValidationError);
      });

      it('should accept name with hyphens and underscores', () => {
        const result = validateStreamConfig({ ...validConfig, name: 'test-stream_1' });
        expect(result.name).toBe('test-stream_1');
      });
    });

    describe('url validation', () => {
      it('should reject empty url', () => {
        expect(() => validateStreamConfig({ ...validConfig, url: '' }))
          .toThrow(StreamConfigValidationError);
      });

      it('should accept http url', () => {
        const result = validateStreamConfig({ ...validConfig, url: 'http://example.com' });
        expect(result.url).toBe('http://example.com');
      });

      it('should accept https url', () => {
        const result = validateStreamConfig({ ...validConfig, url: 'https://example.com' });
        expect(result.url).toBe('https://example.com');
      });

      it('should accept file url', () => {
        const result = validateStreamConfig({ ...validConfig, url: 'file:///path/to/file.html' });
        expect(result.url).toBe('file:///path/to/file.html');
      });

      it('should accept absolute path', () => {
        const result = validateStreamConfig({ ...validConfig, url: '/var/www/page.html' });
        expect(result.url).toBe('/var/www/page.html');
      });

      it('should reject invalid url scheme', () => {
        expect(() => validateStreamConfig({ ...validConfig, url: 'ftp://example.com' }))
          .toThrow(StreamConfigValidationError);
      });
    });

    describe('ingest validation', () => {
      it('should reject empty ingest', () => {
        expect(() => validateStreamConfig({ ...validConfig, ingest: '' }))
          .toThrow(StreamConfigValidationError);
      });

      it('should accept srt url', () => {
        const result = validateStreamConfig({ ...validConfig, ingest: 'srt://host:9000?mode=caller' });
        expect(result.ingest).toBe('srt://host:9000?mode=caller');
      });

      it('should accept rtmp url', () => {
        const result = validateStreamConfig({ ...validConfig, ingest: 'rtmp://host/app/stream' });
        expect(result.ingest).toBe('rtmp://host/app/stream');
      });

      it('should reject invalid ingest scheme', () => {
        expect(() => validateStreamConfig({ ...validConfig, ingest: 'http://example.com' }))
          .toThrow(StreamConfigValidationError);
      });
    });

    describe('type validation', () => {
      it('should accept standard type', () => {
        const result = validateStreamConfig({ ...validConfig, type: 'standard' });
        expect(result.type).toBe('standard');
      });

      it('should accept compositor-source type', () => {
        const result = validateStreamConfig({ ...validConfig, type: 'compositor-source' });
        expect(result.type).toBe('compositor-source');
      });

      it('should accept compositor type', () => {
        const result = validateStreamConfig({ ...validConfig, type: 'compositor' });
        expect(result.type).toBe('compositor');
      });

      it('should reject invalid type', () => {
        expect(() => validateStreamConfig({ ...validConfig, type: 'invalid' }))
          .toThrow(StreamConfigValidationError);
      });
    });

    describe('display settings validation', () => {
      it('should reject width below minimum', () => {
        expect(() => validateStreamConfig({ ...validConfig, width: 100 }))
          .toThrow(StreamConfigValidationError);
      });

      it('should reject width above maximum', () => {
        expect(() => validateStreamConfig({ ...validConfig, width: 10000 }))
          .toThrow(StreamConfigValidationError);
      });

      it('should reject non-numeric width', () => {
        expect(() => validateStreamConfig({ ...validConfig, width: 'wide' }))
          .toThrow(StreamConfigValidationError);
      });

      it('should accept 4K resolution', () => {
        const result = validateStreamConfig({ ...validConfig, width: 3840, height: 2160 });
        expect(result.width).toBe(3840);
        expect(result.height).toBe(2160);
      });
    });

    describe('encoding validation', () => {
      it('should reject invalid preset', () => {
        expect(() => validateStreamConfig({ ...validConfig, preset: 'slowest' }))
          .toThrow(StreamConfigValidationError);
      });

      it('should reject invalid bitrate format', () => {
        expect(() => validateStreamConfig({ ...validConfig, videoBitrate: 'high' }))
          .toThrow(StreamConfigValidationError);
      });

      it('should accept bitrate with k suffix', () => {
        const result = validateStreamConfig({ ...validConfig, videoBitrate: '2500k' });
        expect(result.videoBitrate).toBe('2500k');
      });

      it('should accept bitrate with M suffix', () => {
        const result = validateStreamConfig({ ...validConfig, videoBitrate: '5M' });
        expect(result.videoBitrate).toBe('5M');
      });

      it('should reject invalid format', () => {
        expect(() => validateStreamConfig({ ...validConfig, format: 'mp4' }))
          .toThrow(StreamConfigValidationError);
      });
    });

    describe('display format validation', () => {
      it('should accept valid display format', () => {
        const result = validateStreamConfig({ ...validConfig, display: ':99' });
        expect(result.display).toBe(':99');
      });

      it('should reject invalid display format', () => {
        expect(() => validateStreamConfig({ ...validConfig, display: 'display0' }))
          .toThrow(StreamConfigValidationError);
      });

      it('should reject display without colon', () => {
        expect(() => validateStreamConfig({ ...validConfig, display: '99' }))
          .toThrow(StreamConfigValidationError);
      });
    });

    describe('extraFfmpegArgs validation', () => {
      it('should accept array of strings', () => {
        const result = validateStreamConfig({ ...validConfig, extraFfmpegArgs: ['-b:v', '3M'] });
        expect(result.extraFfmpegArgs).toEqual(['-b:v', '3M']);
      });

      it('should reject non-array', () => {
        expect(() => validateStreamConfig({ ...validConfig, extraFfmpegArgs: '-b:v 3M' }))
          .toThrow(StreamConfigValidationError);
      });

      it('should reject array with non-strings', () => {
        expect(() => validateStreamConfig({ ...validConfig, extraFfmpegArgs: ['-b:v', 3] }))
          .toThrow(StreamConfigValidationError);
      });
    });

    describe('optional path validation', () => {
      it('should accept absolute path for injectCss', () => {
        const result = validateStreamConfig({ ...validConfig, injectCss: '/path/to/style.css' });
        expect(result.injectCss).toBe('/path/to/style.css');
      });

      it('should accept relative path starting with ./', () => {
        const result = validateStreamConfig({ ...validConfig, injectJs: './script.js' });
        expect(result.injectJs).toBe('./script.js');
      });

      it('should reject relative path not starting with ./', () => {
        expect(() => validateStreamConfig({ ...validConfig, injectCss: 'style.css' }))
          .toThrow(StreamConfigValidationError);
      });
    });

    it('should reject non-object input', () => {
      expect(() => validateStreamConfig('string')).toThrow(StreamConfigValidationError);
      expect(() => validateStreamConfig(null)).toThrow(StreamConfigValidationError);
      expect(() => validateStreamConfig(undefined)).toThrow(StreamConfigValidationError);
    });
  });

  describe('validatePartialStreamConfig', () => {
    it('should accept empty updates', () => {
      const result = validatePartialStreamConfig({});
      expect(Object.keys(result).length).toBe(0);
    });

    it('should validate only provided fields', () => {
      const result = validatePartialStreamConfig({ name: 'new-name', width: 1280 });
      expect(result.name).toBe('new-name');
      expect(result.width).toBe(1280);
      expect(result.url).toBeUndefined();
    });

    it('should allow clearing optional fields with null', () => {
      const result = validatePartialStreamConfig({
        injectCss: null,
        display: null,
        extraFfmpegArgs: null
      });
      expect(result.injectCss).toBeUndefined();
      expect(result.display).toBeUndefined();
      expect(result.extraFfmpegArgs).toBeUndefined();
    });

    it('should allow clearing optional fields with empty string', () => {
      const result = validatePartialStreamConfig({
        injectCss: '',
        display: ''
      });
      expect(result.injectCss).toBeUndefined();
      expect(result.display).toBeUndefined();
    });

    it('should still validate values when provided', () => {
      expect(() => validatePartialStreamConfig({ name: '-invalid' }))
        .toThrow(StreamConfigValidationError);

      expect(() => validatePartialStreamConfig({ width: 100 }))
        .toThrow(StreamConfigValidationError);
    });

    it('should reject non-object input', () => {
      expect(() => validatePartialStreamConfig('string')).toThrow(StreamConfigValidationError);
      expect(() => validatePartialStreamConfig(null)).toThrow(StreamConfigValidationError);
    });
  });

  describe('StreamConfigValidationError', () => {
    it('should include field name and value', () => {
      try {
        validateStreamConfig({ ...validConfig, name: '-invalid' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(StreamConfigValidationError);
        const error = err as StreamConfigValidationError;
        expect(error.field).toBe('name');
        expect(error.value).toBe('-invalid');
      }
    });
  });
});
