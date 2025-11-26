import React, { useState } from 'react';
import { useCompositors, useCompositorControl, useDeleteCompositor } from '../hooks/useCompositors';
import { CapabilityGate } from '../components/CapabilityGate';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CompositorConfig } from '../types';

interface CompositorsProps {
  onBack: () => void;
  onEdit?: (id: string) => void;
  onCreate?: () => void;
}

export function Compositors({ onBack, onEdit, onCreate }: CompositorsProps) {
  const { data, isLoading, error, refetch } = useCompositors();
  const { start, stop, restart, deploy } = useCompositorControl();
  const deleteCompositor = useDeleteCompositor();
  const [confirmDelete, setConfirmDelete] = useState<CompositorConfig | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleStart = async (id: string) => {
    setActionError(null);
    try {
      await start.mutateAsync(id);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const handleStop = async (id: string) => {
    setActionError(null);
    try {
      await stop.mutateAsync(id);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const handleRestart = async (id: string) => {
    setActionError(null);
    try {
      await restart.mutateAsync(id);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const handleDeploy = async (id: string) => {
    setActionError(null);
    try {
      await deploy.mutateAsync(id);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setActionError(null);
    try {
      await deleteCompositor.mutateAsync(confirmDelete.id);
      setConfirmDelete(null);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const getStatusBadge = (config: CompositorConfig) => {
    const status = config.containerStatus || 'stopped';
    const colors: Record<string, string> = {
      running: '#22c55e',
      stopped: '#6b7280',
      exited: '#ef4444',
      restarting: '#f59e0b'
    };
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: colors[status] || '#6b7280',
          color: '#fff',
          fontSize: '12px',
          fontWeight: 500
        }}
      >
        {status}
      </span>
    );
  };

  const getLayoutLabel = (layout: string) => {
    const labels: Record<string, string> = {
      'side-by-side': 'Side by Side',
      'stacked': 'Stacked',
      'grid': 'Grid',
      'pip': 'Picture in Picture',
      'custom': 'Custom'
    };
    return labels[layout] || layout;
  };

  if (isLoading) {
    return (
      <div className="compositors-page">
        <div className="page-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>Compositors</h2>
        </div>
        <div className="loading">Loading compositors...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="compositors-page">
        <div className="page-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>Compositors</h2>
        </div>
        <div className="error-message">Failed to load compositors: {(error as Error).message}</div>
      </div>
    );
  }

  const compositors = data?.configs || [];

  return (
    <div className="compositors-page">
      <div className="page-header">
        <button className="back-button" onClick={onBack}>Back</button>
        <h2>Compositors</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button className="action-button" onClick={() => refetch()}>
            Refresh
          </button>
          <CapabilityGate require="compositors:create">
            <button className="action-button primary" onClick={onCreate}>
              New Compositor
            </button>
          </CapabilityGate>
        </div>
      </div>

      {actionError && (
        <div className="error-message" style={{ marginBottom: '16px' }}>
          {actionError}
        </div>
      )}

      {compositors.length === 0 ? (
        <div className="empty-state">
          <p>No compositors configured yet.</p>
          <CapabilityGate require="compositors:create">
            <p>Click "New Compositor" to create one.</p>
          </CapabilityGate>
        </div>
      ) : (
        <div className="compositor-list">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Layout</th>
                <th>Inputs</th>
                <th>Output</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {compositors.map((config) => (
                <tr key={config.id}>
                  <td>
                    <strong>{config.name}</strong>
                    <br />
                    <small style={{ color: '#888' }}>
                      {config.outputWidth}x{config.outputHeight}@{config.outputFps}fps
                    </small>
                  </td>
                  <td>{getLayoutLabel(config.layout)}</td>
                  <td>
                    {config.inputs.map((input, i) => (
                      <div key={i} style={{ fontSize: '12px' }}>
                        {input.name}: :{input.listenPort}
                      </div>
                    ))}
                  </td>
                  <td>
                    <div style={{ fontSize: '12px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {config.outputIngest}
                    </div>
                  </td>
                  <td>{getStatusBadge(config)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      <CapabilityGate require="compositors:control">
                        {config.containerStatus === 'running' ? (
                          <>
                            <button
                              className="action-button small"
                              onClick={() => handleStop(config.id)}
                              disabled={stop.isPending}
                            >
                              Stop
                            </button>
                            <button
                              className="action-button small"
                              onClick={() => handleRestart(config.id)}
                              disabled={restart.isPending}
                            >
                              Restart
                            </button>
                          </>
                        ) : (
                          <button
                            className="action-button small primary"
                            onClick={() => handleStart(config.id)}
                            disabled={start.isPending}
                          >
                            Start
                          </button>
                        )}
                        <button
                          className="action-button small"
                          onClick={() => handleDeploy(config.id)}
                          disabled={deploy.isPending}
                          title="Recreate container with latest config"
                        >
                          Deploy
                        </button>
                      </CapabilityGate>
                      <CapabilityGate require="compositors:update">
                        <button
                          className="action-button small"
                          onClick={() => onEdit?.(config.id)}
                        >
                          Edit
                        </button>
                      </CapabilityGate>
                      <CapabilityGate require="compositors:delete">
                        <button
                          className="action-button small danger"
                          onClick={() => setConfirmDelete(config)}
                        >
                          Delete
                        </button>
                      </CapabilityGate>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          isOpen={true}
          title="Delete Compositor"
          message={`Are you sure you want to delete "${confirmDelete.name}"? This will also stop and remove the container if running.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
