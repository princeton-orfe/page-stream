import { useQuery } from '@tanstack/react-query';

export interface AuditEntry {
  id: number;
  timestamp: string;
  userId: string;
  username: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  result: 'success' | 'failure';
  error?: string;
}

interface AuditLogResponse {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface AuditActionsResponse {
  actions: string[];
}

interface AuditLogFilters {
  limit?: number;
  offset?: number;
  userId?: string;
  action?: string;
  resourceType?: string;
  since?: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.message || 'Request failed');
  }
  return res.json();
}

export function useAuditLog(filters: AuditLogFilters = {}) {
  const params = new URLSearchParams();
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.action) params.set('action', filters.action);
  if (filters.resourceType) params.set('resourceType', filters.resourceType);
  if (filters.since) params.set('since', filters.since);

  const queryString = params.toString();
  const url = `/api/audit${queryString ? `?${queryString}` : ''}`;

  return useQuery<AuditLogResponse, Error>({
    queryKey: ['audit-log', filters],
    queryFn: () => fetchJson(url),
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000 // Refetch every minute
  });
}

export function useAuditActions() {
  return useQuery<AuditActionsResponse, Error>({
    queryKey: ['audit-actions'],
    queryFn: () => fetchJson('/api/audit/actions'),
    staleTime: 300000 // 5 minutes
  });
}

export function getExportUrl(filters: Omit<AuditLogFilters, 'limit' | 'offset'> = {}): string {
  const params = new URLSearchParams();
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.action) params.set('action', filters.action);
  if (filters.resourceType) params.set('resourceType', filters.resourceType);
  if (filters.since) params.set('since', filters.since);

  const queryString = params.toString();
  return `/api/audit/export${queryString ? `?${queryString}` : ''}`;
}
