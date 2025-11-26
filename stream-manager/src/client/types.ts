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

// Stream Group types
export type GroupStartOrder = 'parallel' | 'sequential';
export type GroupStopOrder = 'parallel' | 'sequential' | 'reverse';

export interface GroupMember {
  streamId: string;
  position: number;
  delayMs?: number;
}

export interface StreamGroup {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  members: GroupMember[];
  startOrder: GroupStartOrder;
  stopOrder: GroupStopOrder;
  startDelayMs: number;
  stopDelayMs: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
}

export interface StreamGroupWithStatus extends StreamGroup {
  streamStatuses: Array<{
    streamId: string;
    name: string;
    containerId?: string;
    status: 'running' | 'stopped' | 'restarting' | 'exited' | 'unknown';
  }>;
  runningCount: number;
  totalCount: number;
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

// Schedule types
export type ScheduleTargetType = 'stream' | 'group' | 'compositor';
export type ScheduleAction = 'start' | 'stop' | 'refresh';

export interface Schedule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  targetType: ScheduleTargetType;
  targetId: string;
  action: ScheduleAction;
  cronExpression: string;
  timezone: string;
  lastRun?: string;
  nextRun?: string;
  lastRunResult?: 'success' | 'failure';
  lastRunError?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
}

// Alert types
export type AlertTargetType = 'stream' | 'group' | 'compositor' | 'any';
export type AlertConditionType =
  | 'status_changed'
  | 'status_is'
  | 'health_unhealthy'
  | 'restart_count'
  | 'offline_duration'
  | 'schedule_failed';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type NotificationChannelType = 'webhook' | 'email';

export interface WebhookNotification {
  type: 'webhook';
  url: string;
  headers?: Record<string, string>;
  method?: 'POST' | 'PUT';
}

export interface EmailNotification {
  type: 'email';
  recipients: string[];
  subject?: string;
}

export type NotificationChannel = WebhookNotification | EmailNotification;

export interface AlertCondition {
  type: AlertConditionType;
  statusFrom?: string;
  statusTo?: string;
  status?: string;
  durationSeconds?: number;
  threshold?: number;
  timeWindowSeconds?: number;
}

export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  targetType: AlertTargetType;
  targetId?: string;
  condition: AlertCondition;
  severity: AlertSeverity;
  notifications: NotificationChannel[];
  cooldownMinutes: number;
  lastTriggered?: string;
  lastNotified?: string;
  triggerCount: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  targetType: AlertTargetType;
  targetId: string;
  targetName: string;
  condition: AlertCondition;
  message: string;
  details?: Record<string, unknown>;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  resolvedAt?: string;
  createdAt: string;
}
