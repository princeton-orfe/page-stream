import React from 'react';
import { StreamContainer, HealthStatus } from '../types';
import { StreamCard } from './StreamCard';

interface Props {
  streams: StreamContainer[];
  healthStatuses: Map<string, HealthStatus>;
  loading: boolean;
  error: string | null;
  connected: boolean;
  lastUpdated: string | null;
  onStreamClick?: (stream: StreamContainer) => void;
}

export function Dashboard({
  streams,
  healthStatuses,
  loading,
  error,
  connected,
  lastUpdated,
  onStreamClick
}: Props) {
  const stats = {
    total: streams.length,
    running: streams.filter(s => s.status === 'running').length,
    healthy: streams.filter(s => s.health === 'healthy').length,
    unhealthy: streams.filter(s => s.health === 'unhealthy').length
  };

  if (loading && streams.length === 0) {
    return (
      <div className="dashboard">
        <div className="loading-spinner">Loading streams...</div>
      </div>
    );
  }

  if (error && streams.length === 0) {
    return (
      <div className="dashboard">
        <div className="empty-state">
          <h3>Error</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="dashboard-stats">
          <div className="stat-card">
            <div className="label">Total Streams</div>
            <div className="value">{stats.total}</div>
          </div>
          <div className="stat-card">
            <div className="label">Running</div>
            <div className="value">{stats.running}</div>
          </div>
          <div className="stat-card">
            <div className="label">Healthy</div>
            <div className="value healthy">{stats.healthy}</div>
          </div>
          <div className="stat-card">
            <div className="label">Unhealthy</div>
            <div className="value unhealthy">{stats.unhealthy}</div>
          </div>
        </div>
        <div className="dashboard-meta">
          <span className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? 'Live' : 'Reconnecting...'}
          </span>
          {lastUpdated && (
            <span className="last-updated">
              Updated: {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {streams.length === 0 ? (
        <div className="empty-state">
          <h3>No Streams Found</h3>
          <p>No page-stream containers are currently running.</p>
          <p className="hint">
            Start a container with an image containing "page-stream" or with the label
            "com.page-stream.managed=true" to see it here.
          </p>
        </div>
      ) : (
        <div className="stream-grid">
          {streams.map((stream) => (
            <StreamCard
              key={stream.id}
              stream={stream}
              healthStatus={healthStatuses.get(stream.id)}
              onClick={() => onStreamClick?.(stream)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
