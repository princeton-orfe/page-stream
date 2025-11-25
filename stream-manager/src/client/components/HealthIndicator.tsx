import React from 'react';
import { HealthStatus } from '../types';

interface Props {
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  healthStatus?: HealthStatus | null;
  showLabel?: boolean;
}

export function HealthIndicator({ health, healthStatus, showLabel = false }: Props) {
  const getHealthClass = () => {
    if (healthStatus?.retrying) return 'retrying';
    return health;
  };

  const getTooltip = () => {
    if (!healthStatus) return `Status: ${health}`;

    const parts = [
      `Status: ${health}`,
      `Uptime: ${formatUptime(healthStatus.uptimeSec)}`,
      `Protocol: ${healthStatus.protocol}`,
      `Restarts: ${healthStatus.restartAttempt}`
    ];

    if (healthStatus.lastFfmpegExitCode !== null) {
      parts.push(`Last exit code: ${healthStatus.lastFfmpegExitCode}`);
    }

    return parts.join('\n');
  };

  return (
    <div className="health-indicator" title={getTooltip()}>
      <span className={`health-dot ${getHealthClass()}`} />
      {showLabel && (
        <span className="health-label">
          {healthStatus?.retrying ? 'Retrying' : health}
        </span>
      )}
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
