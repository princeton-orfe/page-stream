import React, { useState } from 'react';
import { AlertForm } from '../components/AlertForm';
import { useCreateAlertRule, AlertRuleCreateInput } from '../hooks/useAlerts';

interface CreateAlertProps {
  onBack: () => void;
  onSuccess?: (id: string) => void;
}

export function CreateAlert({ onBack, onSuccess }: CreateAlertProps) {
  const createAlert = useCreateAlertRule();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (data: AlertRuleCreateInput) => {
    setError(null);
    try {
      const result = await createAlert.mutateAsync(data as AlertRuleCreateInput);
      if (onSuccess) {
        onSuccess(result.id);
      } else {
        onBack();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="create-alert-page">
      <div className="page-header">
        <button className="back-button" onClick={onBack}>Back</button>
        <h2>Create Alert Rule</h2>
      </div>

      <div style={{ maxWidth: '800px', marginTop: '16px' }}>
        <AlertForm
          onSubmit={handleSubmit}
          onCancel={onBack}
          isSubmitting={createAlert.isPending}
          submitError={error}
        />
      </div>
    </div>
  );
}
