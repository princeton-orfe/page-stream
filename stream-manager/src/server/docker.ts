import Docker from 'dockerode';
import { Readable } from 'stream';

export interface StreamContainer {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'restarting' | 'exited';
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  created: string;
  image: string;
  labels: Record<string, string>;
  ports: Array<{ container: number; host?: number; protocol: string }>;
}

let docker: Docker | null = null;
let connectionRetries = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY_BASE = 1000; // 1 second base

export function initDocker(socketPath?: string): Docker {
  docker = new Docker({
    socketPath: socketPath || process.env.DOCKER_SOCKET || '/var/run/docker.sock'
  });
  connectionRetries = 0;
  return docker;
}

export function getDocker(): Docker {
  if (!docker) {
    docker = initDocker();
  }
  return docker;
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    const result = await operation();
    connectionRetries = 0; // Reset on success
    return result;
  } catch (error) {
    if (connectionRetries < MAX_RETRIES) {
      connectionRetries++;
      const delay = RETRY_DELAY_BASE * Math.pow(2, connectionRetries - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(operation);
    }
    throw error;
  }
}

function normalizeContainerStatus(state: string): StreamContainer['status'] {
  const lowerState = state.toLowerCase();
  if (lowerState === 'running') return 'running';
  if (lowerState === 'restarting') return 'restarting';
  if (lowerState === 'exited' || lowerState === 'dead') return 'exited';
  return 'stopped';
}

function normalizeHealthStatus(health?: { Status?: string }): StreamContainer['health'] {
  if (!health || !health.Status) return 'none';
  const status = health.Status.toLowerCase();
  if (status === 'healthy') return 'healthy';
  if (status === 'unhealthy') return 'unhealthy';
  if (status === 'starting') return 'starting';
  return 'none';
}

function isPageStreamContainer(container: Docker.ContainerInfo): boolean {
  // Check if image name contains page-stream
  if (container.Image.includes('page-stream')) {
    return true;
  }

  // Check for managed label
  if (container.Labels?.['com.page-stream.managed'] === 'true') {
    return true;
  }

  return false;
}

export async function listStreamContainers(): Promise<StreamContainer[]> {
  const docker = getDocker();

  return withRetry(async () => {
    const containers = await docker.listContainers({ all: true });

    const streamContainers = containers
      .filter(isPageStreamContainer)
      .map(container => ({
        id: container.Id,
        name: container.Names[0]?.replace(/^\//, '') || container.Id.slice(0, 12),
        status: normalizeContainerStatus(container.State),
        health: normalizeHealthStatus((container as Docker.ContainerInfo & { Status?: string }).Status?.includes('(healthy)')
          ? { Status: 'healthy' }
          : (container as Docker.ContainerInfo & { Status?: string }).Status?.includes('(unhealthy)')
            ? { Status: 'unhealthy' }
            : (container as Docker.ContainerInfo & { Status?: string }).Status?.includes('(starting)')
              ? { Status: 'starting' }
              : undefined),
        created: new Date(container.Created * 1000).toISOString(),
        image: container.Image,
        labels: container.Labels || {},
        ports: (container.Ports || []).map(port => ({
          container: port.PrivatePort,
          host: port.PublicPort,
          protocol: port.Type || 'tcp'
        }))
      }));

    return streamContainers;
  });
}

export async function getContainer(id: string): Promise<StreamContainer | null> {
  const docker = getDocker();

  return withRetry(async () => {
    try {
      const container = docker.getContainer(id);
      const info = await container.inspect();

      // Verify it's a page-stream container
      const isManaged = info.Config.Image.includes('page-stream') ||
        info.Config.Labels?.['com.page-stream.managed'] === 'true';

      if (!isManaged) {
        return null;
      }

      return {
        id: info.Id,
        name: info.Name.replace(/^\//, ''),
        status: normalizeContainerStatus(info.State.Status),
        health: normalizeHealthStatus(info.State.Health),
        created: info.Created,
        image: info.Config.Image,
        labels: info.Config.Labels || {},
        ports: Object.entries(info.NetworkSettings.Ports || {}).flatMap(([portProto, bindings]) => {
          const [port, protocol] = portProto.split('/');
          if (!bindings) {
            return [{ container: parseInt(port), protocol }];
          }
          return bindings.map(binding => ({
            container: parseInt(port),
            host: binding.HostPort ? parseInt(binding.HostPort) : undefined,
            protocol
          }));
        })
      };
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) {
        return null;
      }
      throw error;
    }
  });
}

export async function getRecentLogs(id: string, lines: number = 100): Promise<string[]> {
  const docker = getDocker();

  return withRetry(async () => {
    const container = docker.getContainer(id);

    const logStream = await container.logs({
      stdout: true,
      stderr: true,
      tail: lines,
      timestamps: true
    });

    // Docker logs come with a header for each line
    // We need to strip the 8-byte header
    const buffer = logStream as unknown as Buffer;
    const logLines: string[] = [];

    // Convert buffer to string and split by newlines
    // Each log line from the Docker API has an 8-byte header
    let offset = 0;
    while (offset < buffer.length) {
      // Read the 8-byte header
      if (offset + 8 > buffer.length) break;

      const size = buffer.readUInt32BE(offset + 4);
      offset += 8;

      if (offset + size > buffer.length) break;

      const line = buffer.slice(offset, offset + size).toString('utf8').trim();
      if (line) {
        logLines.push(line);
      }
      offset += size;
    }

    // If the parsing above didn't work (e.g., TTY mode), fall back to simple split
    if (logLines.length === 0 && buffer.length > 0) {
      return buffer.toString('utf8').split('\n').filter(line => line.trim());
    }

    return logLines;
  });
}

export async function* streamLogs(
  id: string,
  since?: number
): AsyncGenerator<string> {
  const docker = getDocker();
  const container = docker.getContainer(id);

  const logStream = await container.logs({
    stdout: true,
    stderr: true,
    follow: true,
    since: since || Math.floor(Date.now() / 1000),
    timestamps: true
  }) as Readable;

  let buffer = Buffer.alloc(0);

  for await (const chunk of logStream) {
    buffer = Buffer.concat([buffer, chunk as Buffer]);

    // Process complete log entries
    while (buffer.length >= 8) {
      const size = buffer.readUInt32BE(4);
      const totalSize = 8 + size;

      if (buffer.length < totalSize) break;

      const line = buffer.slice(8, totalSize).toString('utf8').trim();
      buffer = buffer.slice(totalSize);

      if (line) {
        yield line;
      }
    }
  }
}

// Check if Docker is available
export async function checkDockerConnection(): Promise<boolean> {
  try {
    const docker = getDocker();
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}
