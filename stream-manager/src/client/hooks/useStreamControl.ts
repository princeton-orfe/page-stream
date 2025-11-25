import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';

export type ControlAction = 'start' | 'stop' | 'restart' | 'refresh';

interface ControlActionParams {
  streamId: string;
  action: ControlAction;
  timeout?: number;
}

interface ControlActionResponse {
  success: boolean;
  message: string;
}

interface ControlActionError {
  error: string;
  message?: string;
  retryAfter?: number;
}

async function executeControlAction(params: ControlActionParams): Promise<ControlActionResponse> {
  const { streamId, action, timeout } = params;
  const url = `/api/streams/${streamId}/${action}`;

  const body = timeout !== undefined ? JSON.stringify({ timeout }) : undefined;

  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body
  });

  if (!res.ok) {
    const errorData: ControlActionError = await res.json().catch(() => ({ error: 'Request failed' }));
    const error = new Error(errorData.message || errorData.error || 'Request failed') as Error & { retryAfter?: number };
    if (errorData.retryAfter) {
      error.retryAfter = errorData.retryAfter;
    }
    throw error;
  }

  return res.json();
}

export function useStreamControl(streamId: string) {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<ControlAction | null>(null);

  const mutation = useMutation({
    mutationFn: (params: Omit<ControlActionParams, 'streamId'>) =>
      executeControlAction({ streamId, ...params }),
    onMutate: (params) => {
      setPendingAction(params.action);
    },
    onSettled: () => {
      setPendingAction(null);
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['streams'] });
      queryClient.invalidateQueries({ queryKey: ['stream', streamId] });
    }
  });

  const start = useCallback(() => {
    mutation.mutate({ action: 'start' });
  }, [mutation]);

  const stop = useCallback((timeout?: number) => {
    mutation.mutate({ action: 'stop', timeout });
  }, [mutation]);

  const restart = useCallback((timeout?: number) => {
    mutation.mutate({ action: 'restart', timeout });
  }, [mutation]);

  const refresh = useCallback(() => {
    mutation.mutate({ action: 'refresh' });
  }, [mutation]);

  return {
    start,
    stop,
    restart,
    refresh,
    isPending: mutation.isPending,
    pendingAction,
    error: mutation.error,
    isError: mutation.isError,
    reset: mutation.reset
  };
}
