import React from 'react';
import { StreamContainer, HealthStatus } from '../types';
import { HealthIndicator } from './HealthIndicator';
import { CapabilityGate } from './CapabilityGate';

interface Props {
  stream: StreamContainer;
  healthStatus?: HealthStatus | null;
  onClick?: () => void;
}

export function StreamCard({ stream, healthStatus, onClick }: Props) {
  const ingestUrl = stream.labels['com.page-stream.ingest'] || 'N/A';
  const resolution = stream.labels['com.page-stream.resolution'] || '';

  const formatUptime = () => {
    if (!healthStatus) return 'N/A';
    const sec = healthStatus.uptimeSec;
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  };

  return (
    <div className="stream-card" onClick={onClick} role="button" tabIndex={0}>
      <div className="stream-card-header">
        <span className="stream-card-name" title={stream.name}>
          {stream.name.replace(/^\//, '')}
        </span>
        <HealthIndicator health={stream.health} healthStatus={healthStatus} />
      </div>

      <div className="stream-card-info">
        <div>
          <span className="label">Status:</span>
          <span className={`status-badge ${stream.status}`}>{stream.status}</span>
        </div>
        <div>
          <span className="label">Uptime:</span>
          <span>{formatUptime()}</span>
        </div>
        {resolution && (
          <div>
            <span className="label">Resolution:</span>
            <span>{resolution}</span>
          </div>
        )}
        <div>
          <span className="label">Ingest:</span>
          <span className="ingest-url" title={ingestUrl}>
            {truncateUrl(ingestUrl, 30)}
          </span>
        </div>
      </div>

      <CapabilityGate
        require={['streams:start', 'streams:stop']}
        mode="any"
      >
        <div className="stream-card-actions">
          {/* Placeholder for control buttons - Phase 2 */}
        </div>
      </CapabilityGate>
    </div>
  );
}

function truncateUrl(url: string, maxLength: number): string {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength - 3) + '...';
}
