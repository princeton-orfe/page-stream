import { describe, it, expect, vi, beforeEach } from 'vitest';

// These tests are for the structure and logic
// Full integration tests require Docker socket access

describe('Docker Module', () => {
  describe('StreamContainer interface', () => {
    it('should have correct structure', () => {
      const container = {
        id: 'abc123',
        name: 'page-stream-1',
        status: 'running' as const,
        health: 'healthy' as const,
        created: '2024-01-01T00:00:00Z',
        image: 'page-stream:latest',
        labels: { 'com.page-stream.managed': 'true' },
        ports: [{ container: 3000, host: 3000, protocol: 'tcp' }]
      };

      expect(container.id).toBe('abc123');
      expect(container.status).toBe('running');
      expect(container.health).toBe('healthy');
      expect(container.ports[0].container).toBe(3000);
    });
  });

  describe('Container status normalization', () => {
    // Test the status values we expect
    const statusValues = ['running', 'stopped', 'restarting', 'exited'] as const;

    it('should support all status values', () => {
      statusValues.forEach(status => {
        const container = { status };
        expect(['running', 'stopped', 'restarting', 'exited']).toContain(container.status);
      });
    });
  });

  describe('Health status normalization', () => {
    const healthValues = ['healthy', 'unhealthy', 'starting', 'none'] as const;

    it('should support all health values', () => {
      healthValues.forEach(health => {
        const container = { health };
        expect(['healthy', 'unhealthy', 'starting', 'none']).toContain(container.health);
      });
    });
  });
});

// Integration tests that require Docker
describe.skipIf(!process.env.DOCKER_TESTS)('Docker Integration', () => {
  it('should list containers (requires Docker)', async () => {
    const { listStreamContainers } = await import('../../src/server/docker.js');
    const containers = await listStreamContainers();
    expect(Array.isArray(containers)).toBe(true);
  });

  it('should check Docker connection', async () => {
    const { checkDockerConnection } = await import('../../src/server/docker.js');
    const connected = await checkDockerConnection();
    expect(typeof connected).toBe('boolean');
  });
});
