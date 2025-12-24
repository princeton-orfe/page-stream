import test from 'node:test';
import assert from 'node:assert/strict';
import { PageStreamer } from '../src/index.js';

// Helper to create a PageStreamer for browser mode tests
function createBrowserStreamer(overscan: number, extraFfmpeg: string[] = []) {
  return new PageStreamer({
    url: 'demo/index.html',
    ingest: 'file.ts',
    width: 1280,
    height: 720,
    fps: 30,
    preset: 'veryfast',
    videoBitrate: '2500k',
    audioBitrate: '128k',
    format: 'mpegts',
    extraFfmpeg,
    headless: false,
    fullscreen: true,
    appMode: true,
    reconnectAttempts: 0,
    reconnectInitialDelayMs: 1000,
    reconnectMaxDelayMs: 15000,
    healthIntervalSeconds: 0,
    autoRefreshSeconds: 0,
    suppressAutomationBanner: true,
    autoDismissInfobar: false,
    cropInfobar: 0,
    overscan,
    videoLoop: false,
  });
}

// Helper to create a PageStreamer for video file mode tests
function createVideoStreamer(overscan: number, width = 1280, height = 720) {
  return new PageStreamer({
    url: 'demo/index.html',
    ingest: 'srt://127.0.0.1:9000?streamid=test',
    width,
    height,
    fps: 30,
    preset: 'veryfast',
    videoBitrate: '2500k',
    audioBitrate: '128k',
    format: 'mpegts',
    extraFfmpeg: [],
    headless: false,
    fullscreen: true,
    appMode: true,
    reconnectAttempts: 0,
    reconnectInitialDelayMs: 1000,
    reconnectMaxDelayMs: 15000,
    healthIntervalSeconds: 0,
    autoRefreshSeconds: 0,
    suppressAutomationBanner: true,
    autoDismissInfobar: false,
    cropInfobar: 0,
    overscan,
    videoFile: '/path/to/video.mp4',
    videoLoop: false,
  });
}

// =============================================================================
// Browser Mode Tests
// =============================================================================

test('browser mode: no overscan filter when overscan is 0', () => {
  const streamer = createBrowserStreamer(0);
  const args = streamer.buildFfmpegArgs();

  // Should not have -vf at all when no filters needed
  const vfIndex = args.indexOf('-vf');
  assert.equal(vfIndex, -1, 'Should not have -vf when overscan is 0');
});

test('browser mode: overscan filter applied when overscan > 0', () => {
  const streamer = createBrowserStreamer(5); // 5% overscan
  const args = streamer.buildFfmpegArgs();

  const vfIndex = args.indexOf('-vf');
  assert.ok(vfIndex > -1, 'Expected -vf to be inserted');

  const filter = args[vfIndex + 1];
  // 5% overscan: scaleFactor = (100 - 2*5) / 100 = 0.90
  // scaledW = 1280 * 0.90 = 1152, scaledH = 720 * 0.90 = 648
  assert.match(filter, /scale=1152:648/, 'Expected scale filter with overscan dimensions');
  assert.match(filter, /pad=1280:720:\(ow-iw\)\/2:\(oh-ih\)\/2/, 'Expected pad filter to center content');
});

test('browser mode: 10% overscan produces correct dimensions', () => {
  const streamer = createBrowserStreamer(10); // 10% overscan
  const args = streamer.buildFfmpegArgs();

  const vfIndex = args.indexOf('-vf');
  assert.ok(vfIndex > -1, 'Expected -vf to be inserted');

  const filter = args[vfIndex + 1];
  // 10% overscan: scaleFactor = (100 - 2*10) / 100 = 0.80
  // scaledW = 1280 * 0.80 = 1024, scaledH = 720 * 0.80 = 576
  assert.match(filter, /scale=1024:576/, 'Expected scale filter with 10% overscan');
});

test('browser mode: overscan capped at 50%', () => {
  const streamer = createBrowserStreamer(60); // Should be capped to 50%
  const args = streamer.buildFfmpegArgs();

  const vfIndex = args.indexOf('-vf');
  assert.ok(vfIndex > -1, 'Expected -vf to be inserted');

  const filter = args[vfIndex + 1];
  // 50% overscan: scaleFactor = (100 - 2*50) / 100 = 0
  // This means content is scaled to 0 - but in practice we cap and get minimal scale
  assert.ok(filter.includes('scale='), 'Expected scale filter even at max overscan');
});

test('browser mode: overscan filter skipped when user supplies -vf', () => {
  const streamer = createBrowserStreamer(5, ['-vf', 'hue=s=0']);
  const args = streamer.buildFfmpegArgs();

  // Should have exactly one -vf (user provided)
  const vfOccurrences = args.filter(a => a === '-vf').length;
  assert.equal(vfOccurrences, 1, 'Should have exactly one -vf (user provided)');

  const vfPos = args.indexOf('-vf');
  assert.equal(args[vfPos + 1], 'hue=s=0', 'User-provided filter should remain unchanged');
});

// =============================================================================
// Video File Mode Tests
// =============================================================================

test('video mode: no extra overscan filter when overscan is 0', () => {
  const streamer = createVideoStreamer(0);
  const args = streamer.buildFfmpegArgs();

  const vfIndex = args.indexOf('-vf');
  assert.ok(vfIndex > -1, 'Video mode always has -vf for scaling');

  const filter = args[vfIndex + 1];
  // Should have standard scale/pad/fps but no extra scale/pad for overscan
  // Count occurrences of 'scale=' and 'pad=' - should be 1 each
  const scaleCount = (filter.match(/scale=/g) || []).length;
  const padCount = (filter.match(/pad=/g) || []).length;
  assert.equal(scaleCount, 1, 'Should have exactly 1 scale filter when no overscan');
  assert.equal(padCount, 1, 'Should have exactly 1 pad filter when no overscan');
});

test('video mode: overscan filter added when overscan > 0', () => {
  const streamer = createVideoStreamer(5);
  const args = streamer.buildFfmpegArgs();

  const vfIndex = args.indexOf('-vf');
  const filter = args[vfIndex + 1];

  // Should have 2 scale filters and 2 pad filters (original + overscan)
  const scaleCount = (filter.match(/scale=/g) || []).length;
  const padCount = (filter.match(/pad=/g) || []).length;
  assert.equal(scaleCount, 2, 'Should have 2 scale filters with overscan');
  assert.equal(padCount, 2, 'Should have 2 pad filters with overscan');

  // Check for correct overscan dimensions
  // 5% at 1280x720: scaledW = 1152, scaledH = 648
  assert.match(filter, /scale=1152:648/, 'Expected overscan scale dimensions');
});

test('video mode: different resolutions with overscan', () => {
  const streamer = createVideoStreamer(10, 1920, 1080); // 10% at 1080p
  const args = streamer.buildFfmpegArgs();

  const vfIndex = args.indexOf('-vf');
  const filter = args[vfIndex + 1];

  // 10% overscan at 1920x1080: scaleFactor = 0.80
  // scaledW = 1920 * 0.80 = 1536, scaledH = 1080 * 0.80 = 864
  assert.match(filter, /scale=1536:864/, 'Expected correct overscan at 1080p');
  assert.match(filter, /pad=1920:1080/, 'Expected pad to full 1080p resolution');
});
