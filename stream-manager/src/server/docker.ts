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

// For testing: reset module state
export function resetDockerState(): void {
  docker = null;
  connectionRetries = 0;
}

// Check if an error should trigger retries (only retry transient errors)
function isRetryableError(error: unknown): boolean {
  const err = error as { statusCode?: number; code?: string; noRetry?: boolean };

  // Don't retry if explicitly marked
  if (err.noRetry) return false;

  // Don't retry authorization errors (403) or not found (404)
  if (err.statusCode === 403 || err.statusCode === 404) return false;

  // Retry connection errors
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') return true;

  // By default, don't retry to avoid long delays
  return false;
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    const result = await operation();
    connectionRetries = 0; // Reset on success
    return result;
  } catch (error) {
    if (isRetryableError(error) && connectionRetries < MAX_RETRIES) {
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

// ============================================================================
// Control Functions (Phase 2)
// ============================================================================

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Verify a container is a page-stream container and exists
 * Throws if container not found or not managed
 */
async function verifyManagedContainer(id: string): Promise<Docker.Container> {
  const docker = getDocker();
  const container = docker.getContainer(id);

  const info = await container.inspect();
  const isManaged = info.Config.Image.includes('page-stream') ||
    info.Config.Labels?.['com.page-stream.managed'] === 'true';

  if (!isManaged) {
    const error = new Error(`Container ${id} is not a managed page-stream container`);
    (error as Error & { statusCode: number }).statusCode = 403;
    throw error;
  }

  return container;
}

/**
 * Start a stopped container
 */
export async function startContainer(id: string): Promise<void> {
  return withRetry(async () => {
    const container = await verifyManagedContainer(id);
    await container.start();
  });
}

/**
 * Stop a running container (sends SIGTERM, waits for graceful shutdown)
 * @param id Container ID or name
 * @param timeout Seconds to wait before killing (default 30)
 */
export async function stopContainer(id: string, timeout: number = 30): Promise<void> {
  return withRetry(async () => {
    const container = await verifyManagedContainer(id);
    await container.stop({ t: timeout });
  });
}

/**
 * Restart a container
 * @param id Container ID or name
 * @param timeout Seconds to wait for stop before killing (default 30)
 */
export async function restartContainer(id: string, timeout: number = 30): Promise<void> {
  return withRetry(async () => {
    const container = await verifyManagedContainer(id);
    await container.restart({ t: timeout });
  });
}

/**
 * Send a signal to the main process in a container
 * @param id Container ID or name
 * @param signal Signal name (e.g., 'SIGHUP', 'SIGTERM')
 */
export async function signalContainer(id: string, signal: string): Promise<void> {
  return withRetry(async () => {
    const container = await verifyManagedContainer(id);
    await container.kill({ signal });
  });
}

/**
 * Execute a command in a running container
 * @param id Container ID or name
 * @param cmd Command and arguments array
 * @returns stdout, stderr, and exit code
 */
export async function execInContainer(id: string, cmd: string[]): Promise<ExecResult> {
  return withRetry(async () => {
    const container = await verifyManagedContainer(id);

    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    return new Promise<ExecResult>((resolve, reject) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      // Docker multiplexes stdout/stderr with an 8-byte header
      let buffer = Buffer.alloc(0);

      stream.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        while (buffer.length >= 8) {
          const streamType = buffer[0]; // 1 = stdout, 2 = stderr
          const size = buffer.readUInt32BE(4);
          const totalSize = 8 + size;

          if (buffer.length < totalSize) break;

          const data = buffer.slice(8, totalSize);
          if (streamType === 1) {
            stdout.push(data);
          } else if (streamType === 2) {
            stderr.push(data);
          }

          buffer = buffer.slice(totalSize);
        }
      });

      stream.on('end', async () => {
        try {
          const execInfo = await exec.inspect();
          resolve({
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
            exitCode: execInfo.ExitCode ?? -1
          });
        } catch (err) {
          reject(err);
        }
      });

      stream.on('error', reject);
    });
  });
}

/**
 * Remove a container (stop if running, then remove)
 * @param id Container ID or name
 * @param force Force removal even if running (default: false)
 */
export async function removeContainer(id: string, force: boolean = false): Promise<void> {
  return withRetry(async () => {
    const container = await verifyManagedContainer(id);
    const info = await container.inspect();

    // Stop if running and not force-removing
    if (info.State.Running && !force) {
      await container.stop({ t: 10 });
    }

    await container.remove({ force });
  });
}

/**
 * Create and start a new container from configuration
 * @param containerConfig Docker container creation options
 * @returns Container ID
 */
export async function createAndStartContainer(
  containerConfig: {
    name: string;
    Image: string;
    Cmd: string[];
    Env: string[];
    Labels: Record<string, string>;
    HostConfig: {
      Binds: string[];
      NetworkMode: string;
      RestartPolicy: {
        Name: 'no' | 'always' | 'unless-stopped' | 'on-failure';
        MaximumRetryCount?: number;
      };
    };
    Healthcheck?: {
      Test: string[];
      Interval: number;
      Timeout: number;
      Retries: number;
      StartPeriod: number;
    };
  }
): Promise<string> {
  const docker = getDocker();

  // Check if container with same name already exists
  const containers = await docker.listContainers({ all: true });
  const existingContainer = containers.find(
    c => c.Names.some(n => n === `/${containerConfig.name}` || n === containerConfig.name)
  );

  if (existingContainer) {
    const error = new Error(`Container with name "${containerConfig.name}" already exists`);
    (error as Error & { statusCode: number }).statusCode = 409;
    throw error;
  }

  // Create the container
  const container = await docker.createContainer(containerConfig);

  // Start the container
  await container.start();

  return container.id;
}

/**
 * Get a container by name (not ID)
 * @param name Container name
 * @returns Container info or null if not found
 */
export async function getContainerByName(name: string): Promise<StreamContainer | null> {
  const docker = getDocker();

  return withRetry(async () => {
    try {
      // Docker API allows getting by name with a leading slash
      const container = docker.getContainer(name);
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

/**
 * Refresh a page-stream container by writing to the FIFO
 * Falls back to SIGHUP if FIFO refresh fails
 * @param id Container ID or name
 * @returns Result indicating which method was used
 */
export async function refreshContainer(id: string): Promise<{ method: 'fifo' | 'signal'; success: boolean }> {
  // Try FIFO first (primary method)
  try {
    const result = await execInContainer(id, [
      'sh', '-c', 'echo refresh > /tmp/page_refresh_fifo'
    ]);

    if (result.exitCode === 0) {
      return { method: 'fifo', success: true };
    }
  } catch {
    // FIFO failed, try signal fallback
  }

  // Fallback to SIGHUP
  try {
    await signalContainer(id, 'SIGHUP');
    return { method: 'signal', success: true };
  } catch {
    return { method: 'signal', success: false };
  }
}
