import React, { useCallback, useState } from 'react';
import { CapabilityGate } from '../components/CapabilityGate';
import { StreamForm, StreamFormData } from '../components/StreamForm';
import { useCreateStream } from '../hooks/useStreamConfig';

interface Props {
  onBack: () => void;
  onCreated: (configId: string, containerId?: string) => void;
}

export function CreateStream({ onBack, onCreated }: Props) {
  const createStream = useCreateStream();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback((data: StreamFormData) => {
    setError(null);
    createStream.mutate(data, {
      onSuccess: (response) => {
        onCreated(response.config.id, response.container?.id);
      },
      onError: (err) => {
        setError(err.message);
      }
    });
  }, [createStream, onCreated]);

  return (
    <CapabilityGate
      require="streams:create"
      fallback={
        <div className="create-stream">
          <div className="page-header">
            <button className="btn btn-secondary" onClick={onBack}>Back</button>
            <h2>Create Stream</h2>
          </div>
          <div className="empty-state">
            <h3>Access Denied</h3>
            <p>You don't have permission to create streams.</p>
          </div>
        </div>
      }
    >
      <div className="create-stream">
        <div className="page-header">
          <button className="btn btn-secondary" onClick={onBack}>Back</button>
          <h2>Create New Stream</h2>
        </div>

        {error && (
          <div className="error-banner">
            {error}
            <button className="error-dismiss" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        <StreamForm
          onSubmit={handleSubmit}
          onCancel={onBack}
          isSubmitting={createStream.isPending}
          submitLabel="Create Stream"
        />
      </div>
    </CapabilityGate>
  );
}
