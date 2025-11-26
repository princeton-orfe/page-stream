import React, { useCallback, useState } from 'react';
import { CapabilityGate } from '../components/CapabilityGate';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StreamForm, StreamFormData } from '../components/StreamForm';
import { useStreamConfig, useUpdateStream, useDeleteStream, useDeployStream } from '../hooks/useStreamConfig';
import { useAuth } from '../hooks/useAuth';

interface Props {
  configId: string;
  onBack: () => void;
  onDeleted: () => void;
  onDeployed: (containerId: string) => void;
}

export function EditStream({ configId, onBack, onDeleted, onDeployed }: Props) {
  const { data, isLoading, error: loadError } = useStreamConfig(configId);
  const updateStream = useUpdateStream(configId);
  const deleteStream = useDeleteStream(configId);
  const deployStream = useDeployStream(configId);
  const { hasCapability } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const canUpdate = hasCapability('streams:update');
  const canDelete = hasCapability('streams:delete');

  const handleSubmit = useCallback((formData: StreamFormData) => {
    setError(null);
    updateStream.mutate(formData, {
      onSuccess: () => {
        // Show success feedback - stay on page
      },
      onError: (err) => {
        setError(err.message);
      }
    });
  }, [updateStream]);

  const handleDelete = useCallback(() => {
    setError(null);
    deleteStream.mutate(undefined, {
      onSuccess: () => {
        onDeleted();
      },
      onError: (err) => {
        setError(err.message);
        setShowDeleteConfirm(false);
      }
    });
  }, [deleteStream, onDeleted]);

  const handleDeploy = useCallback(() => {
    setError(null);
    deployStream.mutate(undefined, {
      onSuccess: (response) => {
        onDeployed(response.container.id);
      },
      onError: (err) => {
        setError(err.message);
      }
    });
  }, [deployStream, onDeployed]);

  if (isLoading) {
    return (
      <div className="edit-stream">
        <div className="page-header">
          <button className="btn btn-secondary" onClick={onBack}>Back</button>
          <h2>Edit Stream</h2>
        </div>
        <div className="loading-spinner">Loading stream configuration...</div>
      </div>
    );
  }

  if (loadError || !data?.config) {
    return (
      <div className="edit-stream">
        <div className="page-header">
          <button className="btn btn-secondary" onClick={onBack}>Back</button>
          <h2>Edit Stream</h2>
        </div>
        <div className="empty-state">
          <h3>Error</h3>
          <p>{loadError?.message || 'Stream configuration not found'}</p>
        </div>
      </div>
    );
  }

  const config = data.config;

  return (
    <div className="edit-stream">
      <div className="page-header">
        <button className="btn btn-secondary" onClick={onBack}>Back</button>
        <h2>Edit Stream: {config.name}</h2>
        <div className="page-actions">
          <CapabilityGate require="streams:start">
            <button
              className="btn btn-primary"
              onClick={handleDeploy}
              disabled={deployStream.isPending}
            >
              {deployStream.isPending ? 'Deploying...' : 'Deploy'}
            </button>
          </CapabilityGate>
          <CapabilityGate require="streams:delete">
            <button
              className="btn btn-danger"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleteStream.isPending}
            >
              Delete
            </button>
          </CapabilityGate>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button className="error-dismiss" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {updateStream.isSuccess && (
        <div className="success-banner">
          Stream configuration updated successfully.
        </div>
      )}

      <StreamForm
        initialData={config}
        onSubmit={handleSubmit}
        onCancel={onBack}
        isSubmitting={updateStream.isPending}
        submitLabel="Save Changes"
        readOnly={!canUpdate}
        metadata={{
          createdAt: config.createdAt,
          updatedAt: config.updatedAt,
          createdBy: config.createdBy,
          updatedBy: config.updatedBy
        }}
      />

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Stream"
        message={`Are you sure you want to delete "${config.name}"? This will remove the configuration and stop any running container. This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
