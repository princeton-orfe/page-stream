// All possible capabilities in the system
export type Capability =
  | 'streams:list' | 'streams:read' | 'streams:logs' | 'streams:health'
  | 'streams:start' | 'streams:stop' | 'streams:refresh' | 'streams:restart'
  | 'streams:create' | 'streams:update' | 'streams:delete'
  | 'compositors:list' | 'compositors:read' | 'compositors:create'
  | 'compositors:update' | 'compositors:delete' | 'compositors:control'
  | 'groups:list' | 'groups:read' | 'groups:create'
  | 'groups:update' | 'groups:delete' | 'groups:control'
  | 'schedules:list' | 'schedules:read' | 'schedules:create'
  | 'schedules:update' | 'schedules:delete'
  | 'alerts:list' | 'alerts:read' | 'alerts:create'
  | 'alerts:update' | 'alerts:delete'
  | 'templates:list' | 'templates:read' | 'templates:create' | 'templates:delete'
  | 'audit:read' | 'users:list' | 'users:manage' | 'system:config';

export interface User {
  id: string;
  username: string;
  email?: string;
  roles: string[];
  authSource: 'header' | 'anonymous';
}

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

export interface HealthStatus {
  timestamp: string;
  uptimeSec: number;
  ingest: string;
  protocol: 'SRT' | 'RTMP' | 'FILE' | 'UNKNOWN';
  restartAttempt: number;
  lastFfmpegExitCode: number | null;
  retrying: boolean;
  infobarDismissTried: boolean;
}

// Compositor types
export type CompositorLayout = 'side-by-side' | 'stacked' | 'grid' | 'pip' | 'custom';

export interface CompositorInput {
  name: string;
  listenPort: number;
  width?: number;
  height?: number;
  streamId?: string;
}

export interface PipConfig {
  mainInput: string;
  pipInput: string;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  pipScale: number;
  margin: number;
}

export interface CompositorConfig {
  id: string;
  name: string;
  enabled: boolean;
  layout: CompositorLayout;
  inputs: CompositorInput[];
  customFilterComplex?: string;
  pipConfig?: PipConfig;
  outputWidth: number;
  outputHeight: number;
  outputFps: number;
  preset: string;
  videoBitrate: string;
  audioBitrate: string;
  format: string;
  outputIngest: string;
  extraFfmpegArgs?: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
  // Extended fields from API
  containerStatus?: 'running' | 'stopped' | 'restarting' | 'exited';
  containerId?: string;
}
