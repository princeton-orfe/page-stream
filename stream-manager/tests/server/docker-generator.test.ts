import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { initDatabase, closeDatabase } from '../../src/server/db/index.js';
import { createStreamConfig } from '../../src/server/config/storage.js';
import { StreamConfigCreate, StreamConfig } from '../../src/server/config/schema.js';
import { User } from '../../src/server/auth/types.js';
import {
  generateContainerConfig,
  generateContainerConfigPreview,
  generateCommand,
  generateEnvironment,
  generateVolumeMounts,
  generateLabels,
  generateHealthcheck,
  getNetworkForStreamType,
  resolveDisplay,
  validateContainerConfig,
  DEFAULT_PAGE_STREAM_IMAGE,
  CONTAINER_LABELS,
  NETWORKS,
  ContainerCreateOptions
} from '../../src/server/docker-generator.js';

const TEST_DB_DIR = join(process.cwd(), 'tests', '.tmp');
const TEST_DB_PATH = join(TEST_DB_DIR, 'test-docker-generator.db');

const testUser: User = {
  id: 'test-user',
  username: 'Test User',
  roles: ['admin'],
  authSource: 'header'
};

// Base config for creating streams in database
const validConfigForCreate: StreamConfigCreate = {
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
  ingest: 'srt://localhost:9000?streamid=test',
  autoRefreshSeconds: 0,
  reconnectAttempts: 0,
  reconnectInitialDelayMs: 1000,
  reconnectMaxDelayMs: 30000,
  healthIntervalSeconds: 30
};

// Helper to create a test stream config (in-memory, not in database)
function createTestConfig(overrides: Partial<StreamConfig> = {}): StreamConfig {
  return {
    id: 'test-id-123',
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
    ingest: 'srt://localhost:9000?streamid=test',
    autoRefreshSeconds: 0,
    reconnectAttempts: 0,
    reconnectInitialDelayMs: 1000,
    reconnectMaxDelayMs: 30000,
    healthIntervalSeconds: 30,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'test-user',
    ...overrides
  };
}

describe('Docker Generator', () => {
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

  describe('generateCommand', () => {
    it('should generate basic command with required arguments', () => {
      const config = createTestConfig();
      const cmd = generateCommand(config);

      expect(cmd).toContain('--ingest');
      expect(cmd).toContain('srt://localhost:9000?streamid=test');
      expect(cmd).toContain('--url');
      expect(cmd).toContain('https://example.com/page');
    });

    it('should include display settings', () => {
      const config = createTestConfig({ width: 1280, height: 720, fps: 60 });
      const cmd = generateCommand(config);

      expect(cmd).toContain('--width');
      expect(cmd).toContain('1280');
      expect(cmd).toContain('--height');
      expect(cmd).toContain('720');
      expect(cmd).toContain('--fps');
      expect(cmd).toContain('60');
    });

    it('should include encoding settings', () => {
      const config = createTestConfig({
        preset: 'fast',
        videoBitrate: '5000k',
        audioBitrate: '192k',
        format: 'flv'
      });
      const cmd = generateCommand(config);

      expect(cmd).toContain('--preset');
      expect(cmd).toContain('fast');
      expect(cmd).toContain('--video-bitrate');
      expect(cmd).toContain('5000k');
      expect(cmd).toContain('--audio-bitrate');
      expect(cmd).toContain('192k');
      expect(cmd).toContain('--format');
      expect(cmd).toContain('flv');
    });

    it('should include auto-refresh when configured', () => {
      const config = createTestConfig({ autoRefreshSeconds: 3600 });
      const cmd = generateCommand(config);

      expect(cmd).toContain('--auto-refresh-seconds');
      expect(cmd).toContain('3600');
    });

    it('should not include auto-refresh when zero', () => {
      const config = createTestConfig({ autoRefreshSeconds: 0 });
      const cmd = generateCommand(config);

      expect(cmd).not.toContain('--auto-refresh-seconds');
    });

    it('should include crop-infobar when configured', () => {
      const config = createTestConfig({ cropInfobar: 64 });
      const cmd = generateCommand(config);

      expect(cmd).toContain('--crop-infobar');
      expect(cmd).toContain('64');
    });

    it('should include reconnect settings', () => {
      const config = createTestConfig({
        reconnectAttempts: 5,
        reconnectInitialDelayMs: 2000,
        reconnectMaxDelayMs: 60000
      });
      const cmd = generateCommand(config);

      expect(cmd).toContain('--reconnect-attempts');
      expect(cmd).toContain('5');
      expect(cmd).toContain('--reconnect-initial-delay-ms');
      expect(cmd).toContain('2000');
      expect(cmd).toContain('--reconnect-max-delay-ms');
      expect(cmd).toContain('60000');
    });

    it('should include health interval', () => {
      const config = createTestConfig({ healthIntervalSeconds: 60 });
      const cmd = generateCommand(config);

      expect(cmd).toContain('--health-interval-seconds');
      expect(cmd).toContain('60');
    });

    it('should include extra ffmpeg args', () => {
      const config = createTestConfig({
        extraFfmpegArgs: ['-loglevel', 'verbose', '-threads', '4']
      });
      const cmd = generateCommand(config);

      expect(cmd).toContain('--extra-ffmpeg');
      expect(cmd).toContain('-loglevel');
      expect(cmd).toContain('verbose');
      expect(cmd).toContain('-threads');
      expect(cmd).toContain('4');
    });

    it('should include inject CSS/JS paths', () => {
      const config = createTestConfig({
        injectCss: '/custom/styles.css',
        injectJs: '/custom/script.js'
      });
      const cmd = generateCommand(config);

      expect(cmd).toContain('--inject-css');
      expect(cmd).toContain('/custom/styles.css');
      expect(cmd).toContain('--inject-js');
      expect(cmd).toContain('/custom/script.js');
    });
  });

  describe('generateEnvironment', () => {
    it('should include DISPLAY variable', () => {
      const config = createTestConfig();
      const env = generateEnvironment(config, ':99');

      expect(env).toContain('DISPLAY=:99');
    });

    it('should include WIDTH and HEIGHT', () => {
      const config = createTestConfig({ width: 1280, height: 720 });
      const env = generateEnvironment(config, ':100');

      expect(env).toContain('WIDTH=1280');
      expect(env).toContain('HEIGHT=720');
    });

    it('should include INPUT_FFMPEG_FLAGS when specified', () => {
      const config = createTestConfig({
        inputFfmpegFlags: '-thread_queue_size 2048 -probesize 20M'
      });
      const env = generateEnvironment(config, ':99');

      expect(env).toContain('INPUT_FFMPEG_FLAGS=-thread_queue_size 2048 -probesize 20M');
    });

    it('should include INJECT_CSS/INJECT_JS when specified', () => {
      const config = createTestConfig({
        injectCss: '/css/custom.css',
        injectJs: '/js/custom.js'
      });
      const env = generateEnvironment(config, ':99');

      expect(env).toContain('INJECT_CSS=/css/custom.css');
      expect(env).toContain('INJECT_JS=/js/custom.js');
    });
  });

  describe('generateVolumeMounts', () => {
    it('should include standard demo and output mounts', () => {
      const config = createTestConfig();
      const binds = generateVolumeMounts(config);

      expect(binds).toContain('./demo:/app/demo:ro');
      expect(binds).toContain('./out:/out');
    });

    it('should mount local file URLs', () => {
      const config = createTestConfig({ url: '/var/www/html/page.html' });
      const binds = generateVolumeMounts(config);

      expect(binds).toContain('/var/www/html:/var/www/html:ro');
    });

    it('should mount file:// URLs', () => {
      const config = createTestConfig({ url: 'file:///data/pages/index.html' });
      const binds = generateVolumeMounts(config);

      expect(binds).toContain('/data/pages:/data/pages:ro');
    });

    it('should mount inject CSS directory', () => {
      const config = createTestConfig({ injectCss: '/custom/styles/main.css' });
      const binds = generateVolumeMounts(config);

      expect(binds).toContain('/custom/styles:/custom/styles:ro');
    });

    it('should mount inject JS directory', () => {
      const config = createTestConfig({ injectJs: '/scripts/app.js' });
      const binds = generateVolumeMounts(config);

      expect(binds).toContain('/scripts:/scripts:ro');
    });
  });

  describe('generateLabels', () => {
    it('should include managed label', () => {
      const config = createTestConfig();
      const labels = generateLabels(config);

      expect(labels[CONTAINER_LABELS.MANAGED]).toBe('true');
    });

    it('should include config ID', () => {
      const config = createTestConfig({ id: 'my-config-id' });
      const labels = generateLabels(config);

      expect(labels[CONTAINER_LABELS.CONFIG_ID]).toBe('my-config-id');
    });

    it('should include config name', () => {
      const config = createTestConfig({ name: 'my-stream' });
      const labels = generateLabels(config);

      expect(labels[CONTAINER_LABELS.CONFIG_NAME]).toBe('my-stream');
    });

    it('should include stream type', () => {
      const config = createTestConfig({ type: 'compositor-source' });
      const labels = generateLabels(config);

      expect(labels[CONTAINER_LABELS.STREAM_TYPE]).toBe('compositor-source');
    });

    it('should include created by', () => {
      const config = createTestConfig({ createdBy: 'admin-user' });
      const labels = generateLabels(config);

      expect(labels[CONTAINER_LABELS.CREATED_BY]).toBe('admin-user');
    });
  });

  describe('getNetworkForStreamType', () => {
    it('should return bridge for standard streams', () => {
      expect(getNetworkForStreamType('standard')).toBe(NETWORKS.DEFAULT);
    });

    it('should return compositor_net for compositor-source', () => {
      expect(getNetworkForStreamType('compositor-source')).toBe(NETWORKS.COMPOSITOR);
    });

    it('should return compositor_net for compositor', () => {
      expect(getNetworkForStreamType('compositor')).toBe(NETWORKS.COMPOSITOR);
    });
  });

  describe('generateHealthcheck', () => {
    it('should check all processes for standard streams', () => {
      const config = createTestConfig({ type: 'standard' });
      const healthcheck = generateHealthcheck(config);

      expect(healthcheck.Test).toContain('CMD-SHELL');
      expect(healthcheck.Test[1]).toContain('Xvfb');
      expect(healthcheck.Test[1]).toContain('chrome');
      expect(healthcheck.Test[1]).toContain('ffmpeg');
    });

    it('should only check ffmpeg for compositor sources', () => {
      const config = createTestConfig({ type: 'compositor-source' });
      const healthcheck = generateHealthcheck(config);

      expect(healthcheck.Test).toContain('CMD-SHELL');
      expect(healthcheck.Test[1]).toBe('pgrep ffmpeg');
    });

    it('should have proper intervals', () => {
      const config = createTestConfig();
      const healthcheck = generateHealthcheck(config);

      expect(healthcheck.Interval).toBe(10 * 1e9); // 10 seconds
      expect(healthcheck.Timeout).toBe(5 * 1e9);   // 5 seconds
      expect(healthcheck.Retries).toBe(3);
      expect(healthcheck.StartPeriod).toBe(15 * 1e9); // 15 seconds
    });
  });

  describe('resolveDisplay', () => {
    it('should use configured display if specified', () => {
      const config = createTestConfig({ display: ':150' });
      const display = resolveDisplay(config, { persistAssignment: false });

      expect(display).toBe(':150');
    });

    it('should auto-assign display when not specified', () => {
      const config = createTestConfig({ display: undefined });
      const display = resolveDisplay(config, { persistAssignment: false });

      expect(display).toMatch(/^:\d+$/);
    });

    it('should return same display for same config ID when not persisting', () => {
      // Without persistence, each call gets the next available display (which is same if nothing else assigned)
      const config = createTestConfig({ id: 'consistent-id', display: undefined });
      const display1 = resolveDisplay(config, { persistAssignment: false });
      const display2 = resolveDisplay(config, { persistAssignment: false });

      // Both get the same first available display since no assignment is persisted
      expect(display1).toBe(display2);
    });

    it('should track different displays when persisted to database', () => {
      // First create the stream configs in the database so FK constraint is satisfied
      const config1Data = { ...validConfigForCreate, name: 'persist-test-1' };
      const config2Data = { ...validConfigForCreate, name: 'persist-test-2' };

      const stream1 = createStreamConfig(config1Data, testUser);
      const stream2 = createStreamConfig(config2Data, testUser);

      // Now resolve displays with persistence
      const display1 = resolveDisplay(stream1, { persistAssignment: true });
      const display2 = resolveDisplay(stream2, { persistAssignment: true });

      expect(display1).not.toBe(display2);

      // Re-resolving should return the same persisted display
      const display1Again = resolveDisplay(stream1, { persistAssignment: true });
      expect(display1Again).toBe(display1);
    });
  });

  describe('generateContainerConfig', () => {
    it('should generate complete container configuration without persistence', () => {
      const config = createTestConfig();
      const containerConfig = generateContainerConfig(config, { persistDisplayAssignment: false });

      expect(containerConfig.name).toBe('test-stream');
      expect(containerConfig.Image).toBe(DEFAULT_PAGE_STREAM_IMAGE);
      expect(containerConfig.Cmd).toBeInstanceOf(Array);
      expect(containerConfig.Env).toBeInstanceOf(Array);
      expect(containerConfig.Labels).toBeDefined();
      expect(containerConfig.HostConfig).toBeDefined();
      expect(containerConfig.Healthcheck).toBeDefined();
    });

    it('should use custom image when specified', () => {
      const config = createTestConfig();
      const containerConfig = generateContainerConfig(config, {
        image: 'my-custom-image:v1',
        persistDisplayAssignment: false
      });

      expect(containerConfig.Image).toBe('my-custom-image:v1');
    });

    it('should set correct network for standard streams', () => {
      const config = createTestConfig({ type: 'standard' });
      const containerConfig = generateContainerConfig(config, { persistDisplayAssignment: false });

      expect(containerConfig.HostConfig.NetworkMode).toBe(NETWORKS.DEFAULT);
    });

    it('should set compositor network for compositor sources', () => {
      const config = createTestConfig({ type: 'compositor-source' });
      const containerConfig = generateContainerConfig(config, { persistDisplayAssignment: false });

      expect(containerConfig.HostConfig.NetworkMode).toBe(NETWORKS.COMPOSITOR);
    });

    it('should set restart policy', () => {
      const config = createTestConfig();
      const containerConfig = generateContainerConfig(config, { persistDisplayAssignment: false });

      expect(containerConfig.HostConfig.RestartPolicy.Name).toBe('on-failure');
      expect(containerConfig.HostConfig.RestartPolicy.MaximumRetryCount).toBe(3);
    });

    it('should auto-assign display', () => {
      const config = createTestConfig({ display: undefined });
      const containerConfig = generateContainerConfig(config, { persistDisplayAssignment: false });

      const displayEnv = containerConfig.Env.find(e => e.startsWith('DISPLAY='));
      expect(displayEnv).toBeDefined();
      expect(displayEnv).toMatch(/^DISPLAY=:\d+$/);
    });

    it('should persist display assignment when stream exists in database', () => {
      // Create stream in database first
      const streamData = { ...validConfigForCreate, name: 'persist-stream' };
      const stream = createStreamConfig(streamData, testUser);

      // Generate config with persistence
      const containerConfig = generateContainerConfig(stream, { persistDisplayAssignment: true });

      // Should have assigned a display
      const displayEnv = containerConfig.Env.find(e => e.startsWith('DISPLAY='));
      expect(displayEnv).toBeDefined();

      // Generate again - should get same display
      const containerConfig2 = generateContainerConfig(stream, { persistDisplayAssignment: true });
      const displayEnv2 = containerConfig2.Env.find(e => e.startsWith('DISPLAY='));
      expect(displayEnv2).toBe(displayEnv);
    });
  });

  describe('generateContainerConfigPreview', () => {
    it('should not auto-assign display', () => {
      const config = createTestConfig({ display: undefined });
      const containerConfig = generateContainerConfigPreview(config);

      const displayEnv = containerConfig.Env.find(e => e.startsWith('DISPLAY='));
      expect(displayEnv).toBe('DISPLAY=:99'); // Default fallback
    });

    it('should use configured display', () => {
      const config = createTestConfig({ display: ':200' });
      const containerConfig = generateContainerConfigPreview(config);

      const displayEnv = containerConfig.Env.find(e => e.startsWith('DISPLAY='));
      expect(displayEnv).toBe('DISPLAY=:200');
    });
  });

  describe('validateContainerConfig', () => {
    it('should pass for valid configuration', () => {
      const config = createTestConfig();
      const containerConfig = generateContainerConfig(config, { persistDisplayAssignment: false });

      expect(() => validateContainerConfig(containerConfig)).not.toThrow();
    });

    it('should throw for missing name', () => {
      const containerConfig: ContainerCreateOptions = {
        name: '',
        Image: 'test',
        Cmd: ['--ingest', 'srt://test', '--url', 'http://test'],
        Env: ['DISPLAY=:99'],
        Labels: {},
        HostConfig: { Binds: [], NetworkMode: 'bridge', RestartPolicy: { Name: 'no' } }
      };

      expect(() => validateContainerConfig(containerConfig)).toThrow('Container name is required');
    });

    it('should throw for missing image', () => {
      const containerConfig: ContainerCreateOptions = {
        name: 'test',
        Image: '',
        Cmd: ['--ingest', 'srt://test', '--url', 'http://test'],
        Env: ['DISPLAY=:99'],
        Labels: {},
        HostConfig: { Binds: [], NetworkMode: 'bridge', RestartPolicy: { Name: 'no' } }
      };

      expect(() => validateContainerConfig(containerConfig)).toThrow('Container image is required');
    });

    it('should throw for missing command', () => {
      const containerConfig: ContainerCreateOptions = {
        name: 'test',
        Image: 'test',
        Cmd: [],
        Env: ['DISPLAY=:99'],
        Labels: {},
        HostConfig: { Binds: [], NetworkMode: 'bridge', RestartPolicy: { Name: 'no' } }
      };

      expect(() => validateContainerConfig(containerConfig)).toThrow('Container command is required');
    });

    it('should throw for missing --ingest', () => {
      const containerConfig: ContainerCreateOptions = {
        name: 'test',
        Image: 'test',
        Cmd: ['--url', 'http://test'],
        Env: ['DISPLAY=:99'],
        Labels: {},
        HostConfig: { Binds: [], NetworkMode: 'bridge', RestartPolicy: { Name: 'no' } }
      };

      expect(() => validateContainerConfig(containerConfig)).toThrow('Container command must include --ingest');
    });

    it('should throw for missing --url', () => {
      const containerConfig: ContainerCreateOptions = {
        name: 'test',
        Image: 'test',
        Cmd: ['--ingest', 'srt://test'],
        Env: ['DISPLAY=:99'],
        Labels: {},
        HostConfig: { Binds: [], NetworkMode: 'bridge', RestartPolicy: { Name: 'no' } }
      };

      expect(() => validateContainerConfig(containerConfig)).toThrow('Container command must include --url');
    });

    it('should throw for missing DISPLAY', () => {
      const containerConfig: ContainerCreateOptions = {
        name: 'test',
        Image: 'test',
        Cmd: ['--ingest', 'srt://test', '--url', 'http://test'],
        Env: [],
        Labels: {},
        HostConfig: { Binds: [], NetworkMode: 'bridge', RestartPolicy: { Name: 'no' } }
      };

      expect(() => validateContainerConfig(containerConfig)).toThrow('Container environment must include DISPLAY');
    });
  });

  describe('RTMP ingest support', () => {
    it('should handle RTMP ingest URLs', () => {
      const config = createTestConfig({
        ingest: 'rtmp://live.twitch.tv/app/streamkey',
        format: 'flv'
      });
      const containerConfig = generateContainerConfig(config, { persistDisplayAssignment: false });

      expect(containerConfig.Cmd).toContain('rtmp://live.twitch.tv/app/streamkey');
      expect(containerConfig.Cmd).toContain('flv');
    });
  });

  describe('Complex configuration scenarios', () => {
    it('should handle compositor source with all options', () => {
      const config = createTestConfig({
        name: 'source-left',
        type: 'compositor-source',
        width: 960,
        height: 1080,
        ingest: 'srt://compositor:10001?streamid=left&latency=10000',
        inputFfmpegFlags: '-thread_queue_size 2048 -probesize 20M',
        cropInfobar: 64,
        autoRefreshSeconds: 3600
      });

      const containerConfig = generateContainerConfig(config, { persistDisplayAssignment: false });

      expect(containerConfig.name).toBe('source-left');
      expect(containerConfig.HostConfig.NetworkMode).toBe(NETWORKS.COMPOSITOR);
      expect(containerConfig.Cmd).toContain('--width');
      expect(containerConfig.Cmd).toContain('960');
      expect(containerConfig.Cmd).toContain('--crop-infobar');
      expect(containerConfig.Cmd).toContain('64');
      expect(containerConfig.Env).toContain('INPUT_FFMPEG_FLAGS=-thread_queue_size 2048 -probesize 20M');
    });

    it('should handle standard stream with custom injection', () => {
      const config = createTestConfig({
        name: 'custom-stream',
        type: 'standard',
        url: 'file:///app/demo/custom.html',
        injectCss: '/app/inject/styles.css',
        injectJs: '/app/inject/script.js',
        extraFfmpegArgs: ['-threads', '4', '-tune', 'animation']
      });

      const containerConfig = generateContainerConfig(config, { persistDisplayAssignment: false });

      expect(containerConfig.HostConfig.NetworkMode).toBe(NETWORKS.DEFAULT);
      expect(containerConfig.Cmd).toContain('--inject-css');
      expect(containerConfig.Cmd).toContain('/app/inject/styles.css');
      expect(containerConfig.Cmd).toContain('--extra-ffmpeg');
      expect(containerConfig.Env).toContain('INJECT_CSS=/app/inject/styles.css');
    });
  });
});
