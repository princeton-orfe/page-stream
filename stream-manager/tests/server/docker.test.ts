import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock dockerode before importing docker module
const mockContainer = {
  inspect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  kill: vi.fn(),
  exec: vi.fn(),
  logs: vi.fn(),
  remove: vi.fn()
};

const mockCreatedContainer = {
  id: 'new-container-123',
  start: vi.fn()
};

const mockDocker = {
  getContainer: vi.fn(() => mockContainer),
  listContainers: vi.fn(),
  ping: vi.fn(),
  createContainer: vi.fn(() => mockCreatedContainer)
};

vi.mock('dockerode', () => ({
  default: vi.fn(() => mockDocker)
}));

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

// Control function tests with mocks
describe('Docker Control Functions', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset module state to clear retry counters
    vi.resetModules();
    // Re-import to reset state
    const docker = await import('../../src/server/docker.js');
    docker.resetDockerState();

    // Default: container is a managed page-stream container
    mockContainer.inspect.mockResolvedValue({
      Id: 'container123',
      Name: '/test-page-stream',
      Config: {
        Image: 'page-stream:latest',
        Labels: { 'com.page-stream.managed': 'true' }
      },
      State: { Status: 'running' }
    });
  });

  describe('startContainer', () => {
    it('should start a managed container', async () => {
      mockContainer.start.mockResolvedValue(undefined);

      const { startContainer } = await import('../../src/server/docker.js');
      await startContainer('container123');

      expect(mockDocker.getContainer).toHaveBeenCalledWith('container123');
      expect(mockContainer.start).toHaveBeenCalled();
    });

    it('should reject starting non-managed containers', async () => {
      mockContainer.inspect.mockResolvedValue({
        Id: 'other123',
        Name: '/nginx',
        Config: {
          Image: 'nginx:latest',
          Labels: {}
        },
        State: { Status: 'stopped' }
      });

      const { startContainer } = await import('../../src/server/docker.js');

      await expect(startContainer('other123')).rejects.toThrow('not a managed page-stream container');
    });
  });

  describe('stopContainer', () => {
    it('should stop a managed container with default timeout', async () => {
      mockContainer.stop.mockResolvedValue(undefined);

      const { stopContainer } = await import('../../src/server/docker.js');
      await stopContainer('container123');

      expect(mockContainer.stop).toHaveBeenCalledWith({ t: 30 });
    });

    it('should stop with custom timeout', async () => {
      mockContainer.stop.mockResolvedValue(undefined);

      const { stopContainer } = await import('../../src/server/docker.js');
      await stopContainer('container123', 10);

      expect(mockContainer.stop).toHaveBeenCalledWith({ t: 10 });
    });
  });

  describe('restartContainer', () => {
    it('should restart a managed container', async () => {
      mockContainer.restart.mockResolvedValue(undefined);

      const { restartContainer } = await import('../../src/server/docker.js');
      await restartContainer('container123');

      expect(mockContainer.restart).toHaveBeenCalledWith({ t: 30 });
    });

    it('should restart with custom timeout', async () => {
      mockContainer.restart.mockResolvedValue(undefined);

      const { restartContainer } = await import('../../src/server/docker.js');
      await restartContainer('container123', 5);

      expect(mockContainer.restart).toHaveBeenCalledWith({ t: 5 });
    });
  });

  describe('signalContainer', () => {
    it('should send SIGHUP signal', async () => {
      mockContainer.kill.mockResolvedValue(undefined);

      const { signalContainer } = await import('../../src/server/docker.js');
      await signalContainer('container123', 'SIGHUP');

      expect(mockContainer.kill).toHaveBeenCalledWith({ signal: 'SIGHUP' });
    });

    it('should send SIGTERM signal', async () => {
      mockContainer.kill.mockResolvedValue(undefined);

      const { signalContainer } = await import('../../src/server/docker.js');
      await signalContainer('container123', 'SIGTERM');

      expect(mockContainer.kill).toHaveBeenCalledWith({ signal: 'SIGTERM' });
    });
  });

  describe('execInContainer', () => {
    it('should execute command and return result', async () => {
      const mockStream = new EventEmitter() as EventEmitter & { destroy: () => void };
      mockStream.destroy = vi.fn();

      const mockExec = {
        start: vi.fn().mockResolvedValue(mockStream),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 })
      };

      mockContainer.exec.mockResolvedValue(mockExec);

      const { execInContainer } = await import('../../src/server/docker.js');
      const resultPromise = execInContainer('container123', ['echo', 'hello']);

      // Simulate Docker stdout with 8-byte header
      // Header: [streamType(1), 0, 0, 0, size(4 bytes BE)]
      const message = Buffer.from('hello\n');
      const header = Buffer.alloc(8);
      header[0] = 1; // stdout
      header.writeUInt32BE(message.length, 4);
      const packet = Buffer.concat([header, message]);

      // Emit the packet
      setTimeout(() => {
        mockStream.emit('data', packet);
        mockStream.emit('end');
      }, 10);

      const result = await resultPromise;

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello\n');
      expect(result.stderr).toBe('');
    });

    it('should capture stderr separately', async () => {
      const mockStream = new EventEmitter() as EventEmitter & { destroy: () => void };
      mockStream.destroy = vi.fn();

      const mockExec = {
        start: vi.fn().mockResolvedValue(mockStream),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 1 })
      };

      mockContainer.exec.mockResolvedValue(mockExec);

      const { execInContainer } = await import('../../src/server/docker.js');
      const resultPromise = execInContainer('container123', ['ls', '/nonexistent']);

      // Simulate stderr output
      const message = Buffer.from('No such file or directory\n');
      const header = Buffer.alloc(8);
      header[0] = 2; // stderr
      header.writeUInt32BE(message.length, 4);
      const packet = Buffer.concat([header, message]);

      setTimeout(() => {
        mockStream.emit('data', packet);
        mockStream.emit('end');
      }, 10);

      const result = await resultPromise;

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('No such file or directory\n');
    });
  });

  describe('refreshContainer', () => {
    it('should refresh via FIFO when available', async () => {
      const mockStream = new EventEmitter() as EventEmitter & { destroy: () => void };
      mockStream.destroy = vi.fn();

      const mockExec = {
        start: vi.fn().mockResolvedValue(mockStream),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 })
      };

      mockContainer.exec.mockResolvedValue(mockExec);

      const { refreshContainer } = await import('../../src/server/docker.js');
      const resultPromise = refreshContainer('container123');

      // Simulate successful FIFO write
      setTimeout(() => {
        mockStream.emit('end');
      }, 10);

      const result = await resultPromise;

      expect(result.method).toBe('fifo');
      expect(result.success).toBe(true);
    });

    it('should fall back to SIGHUP when FIFO fails', async () => {
      // FIFO exec fails
      mockContainer.exec.mockRejectedValue(new Error('FIFO not found'));
      // But signal works
      mockContainer.kill.mockResolvedValue(undefined);

      const { refreshContainer, resetDockerState } = await import('../../src/server/docker.js');
      resetDockerState();
      const result = await refreshContainer('container123');

      expect(result.method).toBe('signal');
      expect(result.success).toBe(true);
      expect(mockContainer.kill).toHaveBeenCalledWith({ signal: 'SIGHUP' });
    });

    it('should return failure when both methods fail', async () => {
      mockContainer.exec.mockRejectedValue(new Error('FIFO not found'));
      mockContainer.kill.mockRejectedValue(new Error('Container not running'));

      const { refreshContainer, resetDockerState } = await import('../../src/server/docker.js');
      resetDockerState();
      const result = await refreshContainer('container123');

      expect(result.success).toBe(false);
    });
  });

  describe('ExecResult interface', () => {
    it('should have correct structure', () => {
      const result = {
        stdout: 'output',
        stderr: 'error',
        exitCode: 0
      };

      expect(result.stdout).toBe('output');
      expect(result.stderr).toBe('error');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('removeContainer', () => {
    it('should stop and remove a running container', async () => {
      mockContainer.inspect.mockResolvedValue({
        Id: 'container123',
        Name: '/test-page-stream',
        Config: {
          Image: 'page-stream:latest',
          Labels: { 'com.page-stream.managed': 'true' }
        },
        State: { Status: 'running', Running: true }
      });
      mockContainer.stop.mockResolvedValue(undefined);
      mockContainer.remove.mockResolvedValue(undefined);

      const { removeContainer } = await import('../../src/server/docker.js');
      await removeContainer('container123');

      expect(mockContainer.stop).toHaveBeenCalledWith({ t: 10 });
      expect(mockContainer.remove).toHaveBeenCalledWith({ force: false });
    });

    it('should remove stopped container without stopping first', async () => {
      mockContainer.inspect.mockResolvedValue({
        Id: 'container123',
        Name: '/test-page-stream',
        Config: {
          Image: 'page-stream:latest',
          Labels: { 'com.page-stream.managed': 'true' }
        },
        State: { Status: 'exited', Running: false }
      });
      mockContainer.remove.mockResolvedValue(undefined);

      const { removeContainer } = await import('../../src/server/docker.js');
      await removeContainer('container123');

      expect(mockContainer.stop).not.toHaveBeenCalled();
      expect(mockContainer.remove).toHaveBeenCalledWith({ force: false });
    });

    it('should force remove running container when force=true', async () => {
      mockContainer.inspect.mockResolvedValue({
        Id: 'container123',
        Name: '/test-page-stream',
        Config: {
          Image: 'page-stream:latest',
          Labels: { 'com.page-stream.managed': 'true' }
        },
        State: { Status: 'running', Running: true }
      });
      mockContainer.remove.mockResolvedValue(undefined);

      const { removeContainer } = await import('../../src/server/docker.js');
      await removeContainer('container123', true);

      expect(mockContainer.stop).not.toHaveBeenCalled();
      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
    });

    it('should reject removing non-managed containers', async () => {
      mockContainer.inspect.mockResolvedValue({
        Id: 'other123',
        Name: '/nginx',
        Config: {
          Image: 'nginx:latest',
          Labels: {}
        },
        State: { Status: 'running', Running: true }
      });

      const { removeContainer } = await import('../../src/server/docker.js');

      await expect(removeContainer('other123')).rejects.toThrow('not a managed page-stream container');
    });
  });

  describe('createAndStartContainer', () => {
    beforeEach(() => {
      mockDocker.listContainers.mockResolvedValue([]);
      mockDocker.createContainer.mockResolvedValue(mockCreatedContainer);
      mockCreatedContainer.start.mockResolvedValue(undefined);
    });

    it('should create and start a new container', async () => {
      const containerConfig = {
        name: 'test-stream',
        Image: 'page-stream:latest',
        Cmd: ['--ingest', 'srt://localhost:9000', '--url', 'https://example.com'],
        Env: ['DISPLAY=:99'],
        Labels: { 'com.page-stream.managed': 'true' },
        HostConfig: {
          Binds: ['./demo:/app/demo:ro'],
          NetworkMode: 'bridge',
          RestartPolicy: { Name: 'on-failure' as const, MaximumRetryCount: 3 }
        }
      };

      const { createAndStartContainer } = await import('../../src/server/docker.js');
      const containerId = await createAndStartContainer(containerConfig);

      expect(mockDocker.createContainer).toHaveBeenCalledWith(containerConfig);
      expect(mockCreatedContainer.start).toHaveBeenCalled();
      expect(containerId).toBe('new-container-123');
    });

    it('should reject if container with same name exists', async () => {
      mockDocker.listContainers.mockResolvedValue([
        { Names: ['/test-stream'], Id: 'existing-123' }
      ]);

      const containerConfig = {
        name: 'test-stream',
        Image: 'page-stream:latest',
        Cmd: ['--ingest', 'srt://localhost:9000', '--url', 'https://example.com'],
        Env: ['DISPLAY=:99'],
        Labels: {},
        HostConfig: {
          Binds: [],
          NetworkMode: 'bridge',
          RestartPolicy: { Name: 'on-failure' as const }
        }
      };

      const { createAndStartContainer } = await import('../../src/server/docker.js');

      await expect(createAndStartContainer(containerConfig)).rejects.toThrow(
        'Container with name "test-stream" already exists'
      );
    });

    it('should set 409 status code on conflict error', async () => {
      mockDocker.listContainers.mockResolvedValue([
        { Names: ['/test-stream'], Id: 'existing-123' }
      ]);

      const containerConfig = {
        name: 'test-stream',
        Image: 'page-stream:latest',
        Cmd: [],
        Env: [],
        Labels: {},
        HostConfig: {
          Binds: [],
          NetworkMode: 'bridge',
          RestartPolicy: { Name: 'on-failure' as const }
        }
      };

      const { createAndStartContainer } = await import('../../src/server/docker.js');

      try {
        await createAndStartContainer(containerConfig);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error & { statusCode: number }).statusCode).toBe(409);
      }
    });
  });

  describe('getContainerByName', () => {
    it('should get a container by name', async () => {
      mockContainer.inspect.mockResolvedValue({
        Id: 'container123',
        Name: '/my-stream',
        Config: {
          Image: 'page-stream:latest',
          Labels: { 'com.page-stream.managed': 'true' }
        },
        State: { Status: 'running', Health: { Status: 'healthy' } },
        Created: '2024-01-01T00:00:00Z',
        NetworkSettings: { Ports: {} }
      });

      const { getContainerByName } = await import('../../src/server/docker.js');
      const container = await getContainerByName('my-stream');

      expect(container).not.toBeNull();
      expect(container!.name).toBe('my-stream');
      expect(container!.status).toBe('running');
    });

    it('should return null for non-managed containers', async () => {
      mockContainer.inspect.mockResolvedValue({
        Id: 'nginx123',
        Name: '/nginx',
        Config: {
          Image: 'nginx:latest',
          Labels: {}
        },
        State: { Status: 'running' },
        Created: '2024-01-01T00:00:00Z',
        NetworkSettings: { Ports: {} }
      });

      const { getContainerByName } = await import('../../src/server/docker.js');
      const container = await getContainerByName('nginx');

      expect(container).toBeNull();
    });

    it('should return null for non-existent containers', async () => {
      const notFoundError = new Error('Container not found');
      (notFoundError as Error & { statusCode: number }).statusCode = 404;
      mockContainer.inspect.mockRejectedValue(notFoundError);

      const { getContainerByName } = await import('../../src/server/docker.js');
      const container = await getContainerByName('nonexistent');

      expect(container).toBeNull();
    });
  });
});
