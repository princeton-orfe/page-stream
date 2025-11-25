import React, { useEffect, useMemo, useState } from 'react';
import { StreamContainer, HealthStatus } from '../types';
import { HealthIndicator } from './HealthIndicator';
import { LogViewer } from './LogViewer';
import { CapabilityGate } from './CapabilityGate';
import { ConfirmDialog } from './ConfirmDialog';
import { useStream, useHealthHistory } from '../hooks/useStreams';
import { useStreamControl } from '../hooks/useStreamControl';

interface Props {
  streamId: string;
  wsLogs?: string[];
  wsHealth?: HealthStatus;
  onSubscribe?: () => void;
  onUnsubscribe?: () => void;
  onBack?: () => void;
}

export function StreamDetail({
  streamId,
  wsLogs = [],
  wsHealth,
  onSubscribe,
  onUnsubscribe,
  onBack
}: Props) {
  const { data, isLoading, error } = useStream(streamId);
  const { data: historyData } = useHealthHistory(streamId);
  const {
    start,
    stop,
    restart,
    refresh,
    isPending,
    pendingAction,
    error: controlError,
    reset: resetControlError
  } = useStreamControl(streamId);

  const [showStopConfirm, setShowStopConfirm] = useState(false);

  // Subscribe to logs when component mounts
  useEffect(() => {
    onSubscribe?.();
    return () => onUnsubscribe?.();
  }, [streamId, onSubscribe, onUnsubscribe]);

  // Combine initial logs from REST with live WebSocket logs
  const logs = useMemo(() => {
    const initial = data?.recentLogs || [];
    // Dedupe by taking the longer list if WebSocket has caught up
    if (wsLogs.length >= initial.length) {
      return wsLogs;
    }
    // Otherwise merge: initial logs + new ws logs not in initial
    const lastInitial = initial[initial.length - 1];
    const newWsLogsIdx = wsLogs.findIndex(l => l === lastInitial);
    if (newWsLogsIdx >= 0 && newWsLogsIdx < wsLogs.length - 1) {
      return [...initial, ...wsLogs.slice(newWsLogsIdx + 1)];
    }
    return initial;
  }, [data?.recentLogs, wsLogs]);

  // Use WebSocket health if available, otherwise REST health
  const health = wsHealth || data?.health;

  if (isLoading) {
    return (
      <div className="stream-detail">
        <div className="loading-spinner">Loading stream details...</div>
      </div>
    );
  }

  if (error || !data?.stream) {
    return (
      <div className="stream-detail">
        <div className="stream-detail-header">
          <button className="btn btn-secondary" onClick={onBack}>
            Back
          </button>
        </div>
        <div className="empty-state">
          <h3>Error</h3>
          <p>{error?.message || 'Stream not found'}</p>
        </div>
      </div>
    );
  }

  const { stream } = data;
  const noVncPort = stream.ports.find(p => p.container === 6080)?.host;

  return (
    <div className="stream-detail">
      <div className="stream-detail-header">
        <button className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <h2>{stream.name.replace(/^\//, '')}</h2>
        <HealthIndicator health={stream.health} healthStatus={health} showLabel />
      </div>

      <div className="stream-detail-content">
        <div className="stream-info-section">
          <h3>Container Info</h3>
          <dl className="info-grid">
            <dt>Container ID</dt>
            <dd className="monospace">{stream.id.substring(0, 12)}</dd>

            <dt>Status</dt>
            <dd>
              <span className={`status-badge ${stream.status}`}>{stream.status}</span>
            </dd>

            <dt>Image</dt>
            <dd className="monospace">{stream.image}</dd>

            <dt>Created</dt>
            <dd>{new Date(stream.created).toLocaleString()}</dd>

            {health && (
              <>
                <dt>Uptime</dt>
                <dd>{formatUptime(health.uptimeSec)}</dd>

                <dt>Protocol</dt>
                <dd>{health.protocol}</dd>

                <dt>Ingest</dt>
                <dd className="monospace">{health.ingest || 'N/A'}</dd>

                <dt>Restarts</dt>
                <dd>{health.restartAttempt}</dd>
              </>
            )}

            {noVncPort && (
              <>
                <dt>noVNC</dt>
                <dd>
                  <a
                    href={`http://${window.location.hostname}:${noVncPort}/vnc.html`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link"
                  >
                    Open in new tab
                  </a>
                </dd>
              </>
            )}
          </dl>
        </div>

        <CapabilityGate require={['streams:start', 'streams:stop']} mode="any">
          <div className="stream-control-section">
            <h3>Controls</h3>
            <div className="control-buttons">
              {stream.status === 'running' ? (
                <>
                  <CapabilityGate require="streams:stop">
                    <button
                      className="btn btn-danger"
                      onClick={() => {
                        resetControlError();
                        setShowStopConfirm(true);
                      }}
                      disabled={isPending}
                    >
                      {pendingAction === 'stop' ? 'Stopping...' : 'Stop'}
                    </button>
                  </CapabilityGate>
                  <CapabilityGate require="streams:restart">
                    <button
                      className="btn btn-warning"
                      onClick={() => {
                        resetControlError();
                        restart();
                      }}
                      disabled={isPending}
                    >
                      {pendingAction === 'restart' ? 'Restarting...' : 'Restart'}
                    </button>
                  </CapabilityGate>
                  <CapabilityGate require="streams:refresh">
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        resetControlError();
                        refresh();
                      }}
                      disabled={isPending}
                    >
                      {pendingAction === 'refresh' ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </CapabilityGate>
                </>
              ) : (
                <CapabilityGate require="streams:start">
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      resetControlError();
                      start();
                    }}
                    disabled={isPending}
                  >
                    {pendingAction === 'start' ? 'Starting...' : 'Start'}
                  </button>
                </CapabilityGate>
              )}
            </div>
            {controlError && (
              <div className="control-error">
                {controlError.message}
              </div>
            )}
          </div>
        </CapabilityGate>

        <ConfirmDialog
          isOpen={showStopConfirm}
          title="Stop Stream"
          message={`Are you sure you want to stop "${stream.name.replace(/^\//, '')}"? The stream will stop broadcasting immediately.`}
          confirmLabel="Stop"
          variant="danger"
          onConfirm={() => {
            setShowStopConfirm(false);
            stop();
          }}
          onCancel={() => setShowStopConfirm(false)}
        />

        {historyData && historyData.history.length > 0 && (
          <div className="health-history-section">
            <h3>Health History</h3>
            <div className="health-history">
              {historyData.history.slice(-10).map((h, idx) => (
                <div key={idx} className="history-entry">
                  <span className="timestamp">
                    {new Date(h.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="uptime">{formatUptime(h.uptimeSec)}</span>
                  <span className={`restart-count ${h.restartAttempt > 0 ? 'has-restarts' : ''}`}>
                    {h.restartAttempt} restarts
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="stream-logs-section">
          <h3>Logs</h3>
          <LogViewer logs={logs} containerId={streamId} />
        </div>
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}m ${sec}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
