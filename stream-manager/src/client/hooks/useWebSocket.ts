import { useEffect, useRef, useState, useCallback } from 'react';
import { StreamContainer, HealthStatus } from '../types';

// Message types from server
type ServerMessage =
  | { type: 'auth'; data: { user: { id: string; username: string }; capabilities: string[] } }
  | { type: 'streams:list'; data: StreamContainer[] }
  | { type: 'stream:health'; id: string; data: HealthStatus }
  | { type: 'stream:log'; id: string; data: string }
  | { type: 'stream:status'; id: string; data: { status: string; health: string } }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong' };

// Message types to server
type ClientMessage =
  | { type: 'subscribe:logs'; id: string }
  | { type: 'unsubscribe:logs'; id: string }
  | { type: 'subscribe:health'; id: string }
  | { type: 'unsubscribe:health'; id: string }
  | { type: 'ping' };

interface WebSocketState {
  connected: boolean;
  streams: StreamContainer[];
  healthStatuses: Map<string, HealthStatus>;
  logs: Map<string, string[]>;
  error: string | null;
}

interface UseWebSocketOptions {
  onStreamsUpdate?: (streams: StreamContainer[]) => void;
  onHealthUpdate?: (id: string, health: HealthStatus) => void;
  onLogLine?: (id: string, line: string) => void;
  onError?: (message: string) => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [state, setState] = useState<WebSocketState>({
    connected: false,
    streams: [],
    healthStatuses: new Map(),
    logs: new Map(),
    error: null
  });

  const connect = useCallback(() => {
    // Determine WebSocket URL based on current location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setState(s => ({ ...s, connected: true, error: null }));

      // Start ping interval to keep connection alive
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        handleMessage(msg);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      setState(s => ({ ...s, connected: false }));
      cleanup();

      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 3000);
    };

    ws.onerror = () => {
      setState(s => ({ ...s, error: 'WebSocket connection error' }));
    };
  }, []);

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'streams:list':
        setState(s => ({ ...s, streams: msg.data }));
        options.onStreamsUpdate?.(msg.data);
        break;

      case 'stream:health':
        setState(s => {
          const newMap = new Map(s.healthStatuses);
          newMap.set(msg.id, msg.data);
          return { ...s, healthStatuses: newMap };
        });
        options.onHealthUpdate?.(msg.id, msg.data);
        break;

      case 'stream:log':
        setState(s => {
          const newLogs = new Map(s.logs);
          const existing = newLogs.get(msg.id) || [];
          // Keep last 1000 lines per container
          const updated = [...existing, msg.data].slice(-1000);
          newLogs.set(msg.id, updated);
          return { ...s, logs: newLogs };
        });
        options.onLogLine?.(msg.id, msg.data);
        break;

      case 'stream:status':
        setState(s => {
          const streams = s.streams.map(stream =>
            stream.id === msg.id
              ? { ...stream, status: msg.data.status as StreamContainer['status'], health: msg.data.health as StreamContainer['health'] }
              : stream
          );
          return { ...s, streams };
        });
        break;

      case 'error':
        setState(s => ({ ...s, error: msg.message }));
        options.onError?.(msg.message);
        break;

      case 'auth':
      case 'pong':
        // Handled silently
        break;
    }
  }, [options]);

  const cleanup = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const subscribeLogs = useCallback((containerId: string) => {
    send({ type: 'subscribe:logs', id: containerId });
    send({ type: 'subscribe:health', id: containerId });
  }, [send]);

  const unsubscribeLogs = useCallback((containerId: string) => {
    send({ type: 'unsubscribe:logs', id: containerId });
    send({ type: 'unsubscribe:health', id: containerId });
  }, [send]);

  useEffect(() => {
    connect();

    return () => {
      cleanup();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, cleanup]);

  return {
    connected: state.connected,
    streams: state.streams,
    healthStatuses: state.healthStatuses,
    logs: state.logs,
    error: state.error,
    subscribeLogs,
    unsubscribeLogs
  };
}
