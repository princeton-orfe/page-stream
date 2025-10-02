import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

test('docker-compose.compositor.yml exists and contains expected services', async () => {
  const p = path.join(root, 'docker-compose.compositor.yml');
  assert.ok(fs.existsSync(p), 'docker-compose.compositor.yml should exist');
  const content = await fs.promises.readFile(p, 'utf8');
  assert.match(content, /page1:/, 'Should contain page1 service');
  assert.match(content, /page2:/, 'Should contain page2 service');
  assert.match(content, /compositor:/, 'Should contain compositor service');
  // ensure ports or SRT listener strings present
  assert.match(content, /10001/, 'Should reference port 10001');
  assert.match(content, /10002/, 'Should reference port 10002');
});

test('README contains multi-container compositor section', async () => {
  const p = path.join(root, 'README.md');
  const content = await fs.promises.readFile(p, 'utf8');
  assert.match(content, /Multi-container compositor example/i, 'README should mention Multi-container compositor');
  assert.match(content, /docker-compose.compositor.yml/, 'README should reference the compose file');
});
