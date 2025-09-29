import { spawn } from 'node:child_process';
import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';

function waitFor(pattern: RegExp, source: () => string, timeoutMs=4000, interval=80): Promise<string> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const data = source();
      if (pattern.test(data)) return resolve(data);
      if (Date.now() - start > timeoutMs) return reject(new Error('Timeout waiting for pattern '+pattern));
      setTimeout(tick, interval);
    };
    tick();
  });
}

// Host-based lightweight readiness test without requiring real VNC stack.
// Uses entrypoint.sh with ENABLE_NOVNC=1 and LIGHTWEIGHT_NOVNC=1 plus PAGE_STREAM_TEST_MODE.

test('lightweight noVNC readiness probe', async (t) => {
  const ep = spawn('bash', ['./scripts/entrypoint.sh','--ingest','srt://dummy?streamid=test'], {
    env: { ...process.env, ENABLE_NOVNC: '1', LIGHTWEIGHT_NOVNC: '1', EXIT_AFTER_READY: '1', PAGE_STREAM_TEST_MODE: '1' },
    stdio: ['ignore','pipe','pipe']
  });
  let stdout=''; let stderr='';
  ep.stdout.on('data', d=> stdout += d.toString());
  ep.stderr.on('data', d=> stderr += d.toString());
  const allOutputGetter = () => stderr + stdout;
  await waitFor(/\[noVNC] (ready|fallback HTTP started)/, allOutputGetter, 5000);
  await waitFor(/exiting after readiness/, allOutputGetter, 5000);
  await new Promise(r=>ep.on('close',r));
  assert.equal(ep.exitCode, 0, 'Expected entrypoint to exit cleanly after readiness');
});
