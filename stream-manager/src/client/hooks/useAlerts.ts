import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertRule,
  AlertEvent,
  AlertTargetType,
  AlertSeverity,
  AlertCondition,
  NotificationChannel
} from '../types';

const API_BASE = '/api/alerts';

interface AlertRuleListResponse {
  rules: AlertRule[];
  total: number;
}

interface AlertEventListResponse {
  events: AlertEvent[];
  total: number;
}

interface AlertEvaluatorStatus {
  running: boolean;
  pollIntervalMs: number;
  trackedContainers: number;
}

interface EventCountResponse {
  count: number;
}

interface TestNotificationResult {
  success: boolean;
  results: Array<{
    channel: string;
    success: boolean;
    error?: string;
  }>;
}

export interface AlertRuleCreateInput {
  name: string;
  description?: string;
  enabled?: boolean;
  targetType: AlertTargetType;
  targetId?: string;
  condition: AlertCondition;
  severity?: AlertSeverity;
  notifications?: NotificationChannel[];
  cooldownMinutes?: number;
}

export interface AlertRuleUpdateInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  targetType?: AlertTargetType;
  targetId?: string;
  condition?: AlertCondition;
  severity?: AlertSeverity;
  notifications?: NotificationChannel[];
  cooldownMinutes?: number;
}

// =============================================================================
// Alert Rules Queries
// =============================================================================

// List alert rules with optional filters
export function useAlertRules(options?: {
  enabled?: boolean;
  targetType?: AlertTargetType;
  targetId?: string;
  severity?: AlertSeverity;
  limit?: number;
  offset?: number;
}) {
  return useQuery<AlertRuleListResponse>({
    queryKey: ['alert-rules', options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.enabled !== undefined) params.set('enabled', String(options.enabled));
      if (options?.targetType !== undefined) params.set('targetType', options.targetType);
      if (options?.targetId !== undefined) params.set('targetId', options.targetId);
      if (options?.severity !== undefined) params.set('severity', options.severity);
      if (options?.limit !== undefined) params.set('limit', String(options.limit));
      if (options?.offset !== undefined) params.set('offset', String(options.offset));

      const response = await fetch(`${API_BASE}/rules?${params}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch alert rules');
      }
      return response.json();
    }
  });
}

// Get single alert rule
export function useAlertRule(id: string | null) {
  return useQuery<AlertRule>({
    queryKey: ['alert-rule', id],
    queryFn: async () => {
      if (!id) throw new Error('No alert rule ID');
      const response = await fetch(`${API_BASE}/rules/${id}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch alert rule');
      }
      return response.json();
    },
    enabled: !!id
  });
}

// Get alert rules for a specific target
export function useAlertRulesForTarget(targetType: AlertTargetType | null, targetId: string | null) {
  return useQuery<AlertRuleListResponse>({
    queryKey: ['alert-rules', 'by-target', targetType, targetId],
    queryFn: async () => {
      if (!targetType || !targetId) throw new Error('Target type and ID required');
      const response = await fetch(`${API_BASE}/rules/by-target/${targetType}/${targetId}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch alert rules');
      }
      return response.json();
    },
    enabled: !!targetType && !!targetId
  });
}

// Get alert evaluator status
export function useAlertEvaluatorStatus() {
  return useQuery<AlertEvaluatorStatus>({
    queryKey: ['alert-evaluator-status'],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/status`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch evaluator status');
      }
      return response.json();
    },
    refetchInterval: 30000 // Refresh every 30 seconds
  });
}

// =============================================================================
// Alert Rules Mutations
// =============================================================================

// Create alert rule
export function useCreateAlertRule() {
  const queryClient = useQueryClient();

  return useMutation<AlertRule, Error, AlertRuleCreateInput>({
    mutationFn: async (input) => {
      const response = await fetch(`${API_BASE}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create alert rule');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
    }
  });
}

// Update alert rule
export function useUpdateAlertRule() {
  const queryClient = useQueryClient();

  return useMutation<AlertRule, Error, { id: string; updates: AlertRuleUpdateInput }>({
    mutationFn: async ({ id, updates }) => {
      const response = await fetch(`${API_BASE}/rules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update alert rule');
      }
      return response.json();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      queryClient.invalidateQueries({ queryKey: ['alert-rule', id] });
    }
  });
}

// Delete alert rule
export function useDeleteAlertRule() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/rules/${id}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete alert rule');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
    }
  });
}

// Alert rule control mutations
export function useAlertRuleControl() {
  const queryClient = useQueryClient();

  const enable = useMutation<AlertRule, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/rules/${id}/enable`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to enable alert rule');
      }
      return response.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      queryClient.invalidateQueries({ queryKey: ['alert-rule', id] });
    }
  });

  const disable = useMutation<AlertRule, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/rules/${id}/disable`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to disable alert rule');
      }
      return response.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      queryClient.invalidateQueries({ queryKey: ['alert-rule', id] });
    }
  });

  const test = useMutation<TestNotificationResult, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/rules/${id}/test`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to test notifications');
      }
      return response.json();
    }
  });

  return { enable, disable, test };
}

// =============================================================================
// Alert Events Queries
// =============================================================================

// List alert events with optional filters
export function useAlertEvents(options?: {
  ruleId?: string;
  targetType?: AlertTargetType;
  targetId?: string;
  severity?: AlertSeverity;
  acknowledged?: boolean;
  resolved?: boolean;
  since?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery<AlertEventListResponse>({
    queryKey: ['alert-events', options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.ruleId !== undefined) params.set('ruleId', options.ruleId);
      if (options?.targetType !== undefined) params.set('targetType', options.targetType);
      if (options?.targetId !== undefined) params.set('targetId', options.targetId);
      if (options?.severity !== undefined) params.set('severity', options.severity);
      if (options?.acknowledged !== undefined) params.set('acknowledged', String(options.acknowledged));
      if (options?.resolved !== undefined) params.set('resolved', String(options.resolved));
      if (options?.since !== undefined) params.set('since', options.since);
      if (options?.limit !== undefined) params.set('limit', String(options.limit));
      if (options?.offset !== undefined) params.set('offset', String(options.offset));

      const response = await fetch(`${API_BASE}/events?${params}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch alert events');
      }
      return response.json();
    },
    refetchInterval: 30000 // Refresh every 30 seconds
  });
}

// Get single alert event
export function useAlertEvent(id: string | null) {
  return useQuery<AlertEvent>({
    queryKey: ['alert-event', id],
    queryFn: async () => {
      if (!id) throw new Error('No alert event ID');
      const response = await fetch(`${API_BASE}/events/${id}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch alert event');
      }
      return response.json();
    },
    enabled: !!id
  });
}

// Get active (unresolved) events
export function useActiveAlertEvents() {
  return useQuery<AlertEventListResponse>({
    queryKey: ['alert-events', 'active'],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/events/active`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch active events');
      }
      return response.json();
    },
    refetchInterval: 15000 // Refresh every 15 seconds
  });
}

// Get unacknowledged event count (for badge)
export function useUnacknowledgedEventCount() {
  return useQuery<EventCountResponse>({
    queryKey: ['alert-events', 'count'],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/events/count`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch event count');
      }
      return response.json();
    },
    refetchInterval: 15000 // Refresh every 15 seconds
  });
}

// =============================================================================
// Alert Events Mutations
// =============================================================================

// Acknowledge single event
export function useAcknowledgeAlertEvent() {
  const queryClient = useQueryClient();

  return useMutation<AlertEvent, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/events/${id}/acknowledge`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to acknowledge event');
      }
      return response.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['alert-events'] });
      queryClient.invalidateQueries({ queryKey: ['alert-event', id] });
    }
  });
}

// Acknowledge all events
export function useAcknowledgeAllAlertEvents() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean; count: number }, Error, void>({
    mutationFn: async () => {
      const response = await fetch(`${API_BASE}/events/acknowledge-all`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to acknowledge events');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-events'] });
    }
  });
}
