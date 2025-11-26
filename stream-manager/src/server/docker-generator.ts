/**
 * Docker Container Generator
 * Converts StreamConfig to Docker container configuration
 */

import { StreamConfig } from './config/schema.js';
import { getNextAvailableDisplay, assignDisplay, getAssignedDisplay } from './config/storage.js';

/**
 * Docker container create options interface
 * Matches the dockerode ContainerCreateOptions structure
 */
export interface ContainerCreateOptions {
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

/**
 * Default Docker image for page-stream containers
 */
export const DEFAULT_PAGE_STREAM_IMAGE = 'page-stream:latest';

/**
 * Label keys used for container identification
 */
export const CONTAINER_LABELS = {
  MANAGED: 'com.page-stream.managed',
  CONFIG_ID: 'com.page-stream.config-id',
  CONFIG_NAME: 'com.page-stream.config-name',
  STREAM_TYPE: 'com.page-stream.stream-type',
  CREATED_BY: 'com.page-stream.created-by'
} as const;

/**
 * Network names
 */
export const NETWORKS = {
  DEFAULT: 'bridge',
  COMPOSITOR: 'compositor_net'
} as const;

/**
 * Generate the command array (CLI arguments) for a page-stream container
 */
export function generateCommand(config: StreamConfig): string[] {
  const cmd: string[] = [];

  // Required: ingest URL
  cmd.push('--ingest', config.ingest);

  // Required: page URL
  cmd.push('--url', config.url);

  // Display settings (only add if non-default)
  cmd.push('--width', String(config.width));
  cmd.push('--height', String(config.height));
  cmd.push('--fps', String(config.fps));

  // Encoding settings
  cmd.push('--preset', config.preset);
  cmd.push('--video-bitrate', config.videoBitrate);
  cmd.push('--audio-bitrate', config.audioBitrate);
  cmd.push('--format', config.format);

  // Behavior settings (only add non-zero values)
  if (config.autoRefreshSeconds > 0) {
    cmd.push('--auto-refresh-seconds', String(config.autoRefreshSeconds));
  }

  if (config.cropInfobar > 0) {
    cmd.push('--crop-infobar', String(config.cropInfobar));
  }

  // Reconnect settings (only add if non-default)
  cmd.push('--reconnect-attempts', String(config.reconnectAttempts));
  cmd.push('--reconnect-initial-delay-ms', String(config.reconnectInitialDelayMs));
  cmd.push('--reconnect-max-delay-ms', String(config.reconnectMaxDelayMs));

  // Health interval
  cmd.push('--health-interval-seconds', String(config.healthIntervalSeconds));

  // Extra FFmpeg args
  if (config.extraFfmpegArgs && config.extraFfmpegArgs.length > 0) {
    cmd.push('--extra-ffmpeg', ...config.extraFfmpegArgs);
  }

  // CSS/JS injection (handled via env vars, not CLI - but can be added here too)
  if (config.injectCss) {
    cmd.push('--inject-css', config.injectCss);
  }

  if (config.injectJs) {
    cmd.push('--inject-js', config.injectJs);
  }

  return cmd;
}

/**
 * Generate environment variables for a page-stream container
 */
export function generateEnvironment(config: StreamConfig, display: string): string[] {
  const env: string[] = [];

  // Display configuration (required for X11)
  env.push(`DISPLAY=${display}`);

  // Width/Height as environment variables (for Xvfb sizing)
  env.push(`WIDTH=${config.width}`);
  env.push(`HEIGHT=${config.height}`);

  // Input FFmpeg flags (if specified)
  if (config.inputFfmpegFlags) {
    env.push(`INPUT_FFMPEG_FLAGS=${config.inputFfmpegFlags}`);
  }

  // CSS/JS injection paths (alternative to CLI args)
  if (config.injectCss) {
    env.push(`INJECT_CSS=${config.injectCss}`);
  }

  if (config.injectJs) {
    env.push(`INJECT_JS=${config.injectJs}`);
  }

  return env;
}

/**
 * Generate volume mounts for a container
 */
export function generateVolumeMounts(config: StreamConfig): string[] {
  const binds: string[] = [];

  // Standard mounts for demo pages and output
  binds.push('./demo:/app/demo:ro');
  binds.push('./out:/out');

  // If URL is a local file path, mount the parent directory
  if (config.url.startsWith('file://') || config.url.startsWith('/')) {
    const filePath = config.url.replace('file://', '');
    // Extract directory from file path
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash > 0) {
      const dir = filePath.substring(0, lastSlash);
      // Only add if not already covered by demo mount
      if (!dir.includes('/app/demo') && !dir.includes('./demo')) {
        binds.push(`${dir}:${dir}:ro`);
      }
    }
  }

  // Mount inject files directories if specified
  if (config.injectCss) {
    const cssDir = config.injectCss.substring(0, config.injectCss.lastIndexOf('/'));
    if (cssDir && !binds.some(b => b.startsWith(cssDir))) {
      binds.push(`${cssDir}:${cssDir}:ro`);
    }
  }

  if (config.injectJs) {
    const jsDir = config.injectJs.substring(0, config.injectJs.lastIndexOf('/'));
    if (jsDir && !binds.some(b => b.startsWith(jsDir))) {
      binds.push(`${jsDir}:${jsDir}:ro`);
    }
  }

  return binds;
}

/**
 * Generate labels for container identification and metadata
 */
export function generateLabels(config: StreamConfig): Record<string, string> {
  return {
    [CONTAINER_LABELS.MANAGED]: 'true',
    [CONTAINER_LABELS.CONFIG_ID]: config.id,
    [CONTAINER_LABELS.CONFIG_NAME]: config.name,
    [CONTAINER_LABELS.STREAM_TYPE]: config.type,
    [CONTAINER_LABELS.CREATED_BY]: config.createdBy
  };
}

/**
 * Determine the appropriate network for a stream type
 */
export function getNetworkForStreamType(type: StreamConfig['type']): string {
  switch (type) {
    case 'compositor-source':
    case 'compositor':
      return NETWORKS.COMPOSITOR;
    case 'standard':
    default:
      return NETWORKS.DEFAULT;
  }
}

/**
 * Generate the Docker healthcheck configuration
 */
export function generateHealthcheck(config: StreamConfig): ContainerCreateOptions['Healthcheck'] {
  // Standard health check: verify Xvfb, Chrome, and FFmpeg are all running
  const test = config.type === 'standard'
    ? ['CMD-SHELL', 'pgrep Xvfb && pgrep chrome && pgrep ffmpeg']
    : ['CMD-SHELL', 'pgrep ffmpeg']; // Compositor sources may not need browser

  return {
    Test: test,
    Interval: 10 * 1e9, // 10 seconds in nanoseconds
    Timeout: 5 * 1e9,   // 5 seconds in nanoseconds
    Retries: 3,
    StartPeriod: 15 * 1e9 // 15 seconds in nanoseconds
  };
}

/**
 * Resolve the display for a stream configuration
 * Uses the configured display if specified, otherwise assigns the next available
 *
 * @param config Stream configuration
 * @param options.persistAssignment If true, saves the display assignment to database (requires stream to exist in DB)
 */
export function resolveDisplay(
  config: StreamConfig,
  options: { persistAssignment?: boolean } = {}
): string {
  const { persistAssignment = true } = options;

  // Check if config already has a display assigned
  if (config.display) {
    return config.display;
  }

  // Check if this config already has a display assignment in the database
  const existingAssignment = getAssignedDisplay(config.id);
  if (existingAssignment) {
    return existingAssignment;
  }

  // Get the next available display
  const nextDisplay = getNextAvailableDisplay();

  // Only persist if requested (stream must exist in database for this to work)
  if (persistAssignment) {
    assignDisplay(config.id, nextDisplay);
  }

  return nextDisplay;
}

/**
 * Generate a complete Docker container configuration from a StreamConfig
 *
 * @param config Stream configuration
 * @param options.image Docker image to use (default: page-stream:latest)
 * @param options.autoAssignDisplay If true, auto-assigns a display (default: true)
 * @param options.persistDisplayAssignment If true, persists display assignment to DB (default: true, requires stream to exist)
 */
export function generateContainerConfig(
  config: StreamConfig,
  options: {
    image?: string;
    autoAssignDisplay?: boolean;
    persistDisplayAssignment?: boolean;
  } = {}
): ContainerCreateOptions {
  const image = options.image || DEFAULT_PAGE_STREAM_IMAGE;
  const autoAssignDisplay = options.autoAssignDisplay !== false;
  const persistDisplayAssignment = options.persistDisplayAssignment !== false;

  // Resolve the X11 display
  let display: string;
  if (autoAssignDisplay) {
    display = resolveDisplay(config, { persistAssignment: persistDisplayAssignment });
  } else if (config.display) {
    display = config.display;
  } else {
    display = ':99'; // Default fallback
  }

  return {
    name: config.name,
    Image: image,
    Cmd: generateCommand(config),
    Env: generateEnvironment(config, display),
    Labels: generateLabels(config),
    HostConfig: {
      Binds: generateVolumeMounts(config),
      NetworkMode: getNetworkForStreamType(config.type),
      RestartPolicy: {
        Name: 'on-failure',
        MaximumRetryCount: 3
      }
    },
    Healthcheck: generateHealthcheck(config)
  };
}

/**
 * Generate container config without auto-assigning display (for previews/validation)
 */
export function generateContainerConfigPreview(
  config: StreamConfig,
  options: { image?: string } = {}
): ContainerCreateOptions {
  return generateContainerConfig(config, { ...options, autoAssignDisplay: false });
}

/**
 * Validate that a container configuration is valid for creation
 * Throws an error if the configuration is invalid
 */
export function validateContainerConfig(containerConfig: ContainerCreateOptions): void {
  if (!containerConfig.name || containerConfig.name.length === 0) {
    throw new Error('Container name is required');
  }

  if (!containerConfig.Image || containerConfig.Image.length === 0) {
    throw new Error('Container image is required');
  }

  if (!containerConfig.Cmd || containerConfig.Cmd.length === 0) {
    throw new Error('Container command is required');
  }

  // Check for required --ingest and --url in command
  const hasIngest = containerConfig.Cmd.includes('--ingest');
  const hasUrl = containerConfig.Cmd.includes('--url');

  if (!hasIngest) {
    throw new Error('Container command must include --ingest');
  }

  if (!hasUrl) {
    throw new Error('Container command must include --url');
  }

  // Check for DISPLAY in environment
  const hasDisplay = containerConfig.Env.some(e => e.startsWith('DISPLAY='));
  if (!hasDisplay) {
    throw new Error('Container environment must include DISPLAY');
  }
}
