import React, { useState } from 'react';
import { AlertForm } from '../components/AlertForm';
import { useAlertRule, useUpdateAlertRule, AlertRuleUpdateInput } from '../hooks/useAlerts';

interface EditAlertProps {
  alertRuleId: string;
  onBack: () => void;
  onSuccess?: () => void;
}

export function EditAlert({ alertRuleId, onBack, onSuccess }: EditAlertProps) {
  const { data: alertRule, isLoading, error: loadError } = useAlertRule(alertRuleId);
  const updateAlert = useUpdateAlertRule();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (data: AlertRuleUpdateInput) => {
    setError(null);
    try {
      await updateAlert.mutateAsync({ id: alertRuleId, updates: data as AlertRuleUpdateInput });
      if (onSuccess) {
        onSuccess();
      } else {
        onBack();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (isLoading) {
    return (
      <div className="edit-alert-page">
        <div className="page-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>Edit Alert Rule</h2>
        </div>
        <div className="loading">Loading alert rule...</div>
      </div>
    );
  }

  if (loadError || !alertRule) {
    return (
      <div className="edit-alert-page">
        <div className="page-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>Edit Alert Rule</h2>
        </div>
        <div className="error-message">
          {loadError ? loadError.message : 'Alert rule not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="edit-alert-page">
      <div className="page-header">
        <button className="back-button" onClick={onBack}>Back</button>
        <h2>Edit Alert Rule: {alertRule.name}</h2>
      </div>

      <div style={{ maxWidth: '800px', marginTop: '16px' }}>
        <AlertForm
          alertRule={alertRule}
          onSubmit={handleSubmit}
          onCancel={onBack}
          isSubmitting={updateAlert.isPending}
          submitError={error}
        />
      </div>
    </div>
  );
}
