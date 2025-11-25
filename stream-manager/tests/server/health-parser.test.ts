import { describe, it, expect } from 'vitest';
import {
  parseHealthLine,
  extractHealthHistory,
  getLatestHealth,
  classifyLogLine
} from '../../src/server/health-parser.js';

describe('Health Parser', () => {
  describe('parseHealthLine', () => {
    it('should parse valid [health] prefixed line', () => {
      const line = '[health] {"type":"health","ts":"2024-01-01T00:00:00.000Z","uptimeSec":30.1,"ingest":"srt://example.com:9000?streamid=test","protocol":"SRT","restartAttempt":2,"lastFfmpegExitCode":1,"retrying":true}';

      const result = parseHealthLine(line);

      expect(result).not.toBeNull();
      expect(result?.timestamp).toBe('2024-01-01T00:00:00.000Z');
      expect(result?.uptimeSec).toBe(30.1);
      expect(result?.ingest).toBe('srt://example.com:9000?streamid=test');
      expect(result?.protocol).toBe('SRT');
      expect(result?.restartAttempt).toBe(2);
      expect(result?.lastFfmpegExitCode).toBe(1);
      expect(result?.retrying).toBe(true);
    });

    it('should parse line with timestamp prefix', () => {
      const line = '2024-01-01T12:00:00.000Z [health] {"type":"health","ts":"2024-01-01T12:00:00.000Z","uptimeSec":60,"ingest":"rtmp://localhost/live/test","protocol":"RTMP","restartAttempt":0,"lastFfmpegExitCode":null,"retrying":false}';

      const result = parseHealthLine(line);

      expect(result).not.toBeNull();
      expect(result?.protocol).toBe('RTMP');
      expect(result?.lastFfmpegExitCode).toBeNull();
    });

    it('should parse raw JSON health line', () => {
      const line = '{"type":"health","ts":"2024-01-01T00:00:00.000Z","uptimeSec":10,"ingest":"file.mp4","protocol":"FILE","restartAttempt":0,"lastFfmpegExitCode":null,"retrying":false}';

      const result = parseHealthLine(line);

      expect(result).not.toBeNull();
      expect(result?.protocol).toBe('FILE');
    });

    it('should return null for non-health line', () => {
      const line = 'Starting page-stream...';
      expect(parseHealthLine(line)).toBeNull();
    });

    it('should return null for malformed JSON', () => {
      const line = '[health] {not valid json}';
      expect(parseHealthLine(line)).toBeNull();
    });

    it('should return null for JSON without health type or uptimeSec', () => {
      const line = '{"type":"other","data":"something"}';
      expect(parseHealthLine(line)).toBeNull();
    });

    it('should normalize unknown protocols to UNKNOWN', () => {
      const line = '[health] {"type":"health","uptimeSec":10,"protocol":"custom"}';
      const result = parseHealthLine(line);
      expect(result?.protocol).toBe('UNKNOWN');
    });

    it('should handle missing optional fields with defaults', () => {
      const line = '[health] {"type":"health","uptimeSec":10}';
      const result = parseHealthLine(line);

      expect(result).not.toBeNull();
      expect(result?.ingest).toBe('');
      expect(result?.protocol).toBe('UNKNOWN');
      expect(result?.restartAttempt).toBe(0);
      expect(result?.lastFfmpegExitCode).toBeNull();
      expect(result?.retrying).toBe(false);
    });

    it('should handle infobarDismissTried field', () => {
      const line = '[health] {"type":"health","uptimeSec":10,"infobarDismissTried":true}';
      const result = parseHealthLine(line);
      expect(result?.infobarDismissTried).toBe(true);
    });
  });

  describe('extractHealthHistory', () => {
    it('should extract multiple health entries', () => {
      const lines = [
        'Starting stream...',
        '[health] {"type":"health","ts":"2024-01-01T00:00:00.000Z","uptimeSec":10}',
        'Some other log line',
        '[health] {"type":"health","ts":"2024-01-01T00:00:30.000Z","uptimeSec":40}',
        '[health] {"type":"health","ts":"2024-01-01T00:00:10.000Z","uptimeSec":20}'
      ];

      const history = extractHealthHistory(lines);

      expect(history.length).toBe(3);
    });

    it('should sort entries chronologically (oldest first)', () => {
      const lines = [
        '[health] {"type":"health","ts":"2024-01-01T00:00:30.000Z","uptimeSec":30}',
        '[health] {"type":"health","ts":"2024-01-01T00:00:10.000Z","uptimeSec":10}',
        '[health] {"type":"health","ts":"2024-01-01T00:00:20.000Z","uptimeSec":20}'
      ];

      const history = extractHealthHistory(lines);

      expect(history[0].uptimeSec).toBe(10);
      expect(history[1].uptimeSec).toBe(20);
      expect(history[2].uptimeSec).toBe(30);
    });

    it('should return empty array when no health lines', () => {
      const lines = ['log line 1', 'log line 2'];
      expect(extractHealthHistory(lines)).toEqual([]);
    });

    it('should skip malformed health lines', () => {
      const lines = [
        '[health] {"type":"health","ts":"2024-01-01T00:00:00.000Z","uptimeSec":10}',
        '[health] {invalid json}',
        '[health] {"type":"health","ts":"2024-01-01T00:00:10.000Z","uptimeSec":20}'
      ];

      const history = extractHealthHistory(lines);
      expect(history.length).toBe(2);
    });
  });

  describe('getLatestHealth', () => {
    it('should return the most recent health status', () => {
      const lines = [
        '[health] {"type":"health","ts":"2024-01-01T00:00:00.000Z","uptimeSec":10}',
        '[health] {"type":"health","ts":"2024-01-01T00:00:30.000Z","uptimeSec":40}',
        '[health] {"type":"health","ts":"2024-01-01T00:00:10.000Z","uptimeSec":20}'
      ];

      const latest = getLatestHealth(lines);

      expect(latest?.uptimeSec).toBe(40);
      expect(latest?.timestamp).toBe('2024-01-01T00:00:30.000Z');
    });

    it('should return null when no health lines', () => {
      const lines = ['log line 1', 'log line 2'];
      expect(getLatestHealth(lines)).toBeNull();
    });
  });

  describe('classifyLogLine', () => {
    it('should classify health lines', () => {
      expect(classifyLogLine('[health] {"type":"health"}')).toBe('health');
    });

    it('should classify error lines', () => {
      expect(classifyLogLine('Error: Connection failed')).toBe('error');
      expect(classifyLogLine('EXCEPTION occurred')).toBe('error');
      expect(classifyLogLine('Process failed to start')).toBe('error');
      expect(classifyLogLine('FATAL: Cannot continue')).toBe('error');
    });

    it('should classify warning lines', () => {
      expect(classifyLogLine('Warning: Deprecated option')).toBe('warn');
      expect(classifyLogLine('WARN: Low memory')).toBe('warn');
      expect(classifyLogLine('deprecated feature used')).toBe('warn');
    });

    it('should classify info lines', () => {
      expect(classifyLogLine('INFO: Server started')).toBe('info');
      expect(classifyLogLine('Starting stream...')).toBe('info');
      expect(classifyLogLine('Connected to server')).toBe('info');
      expect(classifyLogLine('Service ready')).toBe('info');
    });

    it('should classify normal lines', () => {
      expect(classifyLogLine('Just a regular log line')).toBe('normal');
      expect(classifyLogLine('Processing frame 123')).toBe('normal');
    });
  });
});
