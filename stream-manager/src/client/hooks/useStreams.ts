import { useQuery } from '@tanstack/react-query';
import { StreamContainer, HealthStatus } from '../types';

interface StreamsResponse {
  streams: StreamContainer[];
  timestamp: string;
}

interface StreamDetailResponse {
  stream: StreamContainer;
  health: HealthStatus | null;
  recentLogs: string[];
}

interface LogsResponse {
  logs: string[];
  hasMore: boolean;
}

interface HealthHistoryResponse {
  history: HealthStatus[];
  latest: HealthStatus | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.message || 'Request failed');
  }
  return res.json();
}

export function useStreams() {
  return useQuery<StreamsResponse, Error>({
    queryKey: ['streams'],
    queryFn: () => fetchJson('/api/streams'),
    refetchInterval: 10000, // Refetch every 10 seconds as fallback
    staleTime: 5000
  });
}

export function useStream(id: string | null) {
  return useQuery<StreamDetailResponse, Error>({
    queryKey: ['stream', id],
    queryFn: () => fetchJson(`/api/streams/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
    staleTime: 2000
  });
}

export function useStreamLogs(id: string | null, lines: number = 100) {
  return useQuery<LogsResponse, Error>({
    queryKey: ['stream-logs', id, lines],
    queryFn: () => fetchJson(`/api/streams/${id}/logs?lines=${lines}`),
    enabled: !!id,
    staleTime: 1000
  });
}

export function useHealthHistory(id: string | null, limit: number = 50) {
  return useQuery<HealthHistoryResponse, Error>({
    queryKey: ['health-history', id, limit],
    queryFn: () => fetchJson(`/api/streams/${id}/health/history?limit=${limit}`),
    enabled: !!id,
    refetchInterval: 10000,
    staleTime: 5000
  });
}
