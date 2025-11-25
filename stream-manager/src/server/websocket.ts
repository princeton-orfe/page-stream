import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage, Server as HttpServer } from 'http';
import { AuthConfig, RequestContext, User, Role } from './auth/types.js';
import { extractUserFromRequest, createAnonymousUser } from './auth/extractors.js';
import { createRequestContext, BUILT_IN_ROLES } from './auth/rbac.js';
import { RoleStore } from './auth/middleware.js';
import { StreamContainer, listStreamContainers, getContainer, streamLogs } from './docker.js';
import { HealthStatus, parseHealthLine } from './health-parser.js';

// Message types from server to client
export type ServerMessage =
  | { type: 'auth'; data: { user: { id: string; username: string }; capabilities: string[] } }
  | { type: 'streams:list'; data: StreamContainer[] }
  | { type: 'stream:health'; id: string; data: HealthStatus }
  | { type: 'stream:log'; id: string; data: string }
  | { type: 'stream:status'; id: string; data: { status: string; health: string } }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong' };

// Message types from client to server
export type ClientMessage =
  | { type: 'subscribe:logs'; id: string }
  | { type: 'unsubscribe:logs'; id: string }
  | { type: 'subscribe:health'; id: string }
  | { type: 'unsubscribe:health'; id: string }
  | { type: 'ping' };

interface AuthenticatedSocket extends WebSocket {
  ctx: RequestContext;
  subscriptions: Set<string>;
  isAlive: boolean;
  logAbortControllers: Map<string, AbortController>;
}

interface WebSocketServerState {
  wss: WebSocketServer;
  pollInterval: NodeJS.Timeout | null;
  heartbeatInterval: NodeJS.Timeout | null;
}

// State for cleanup
let serverState: WebSocketServerState | null = null;

export function createWebSocketServer(
  server: HttpServer,
  authConfig: AuthConfig,
  roleStore: RoleStore
): WebSocketServer {
  const wss = new WebSocketServer({ server });

  // Track intervals for cleanup
  serverState = {
    wss,
    pollInterval: null,
    heartbeatInterval: null
  };

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const socket = ws as AuthenticatedSocket;
    socket.subscriptions = new Set();
    socket.isAlive = true;
    socket.logAbortControllers = new Map();

    // Authenticate WebSocket connection using same header logic
    let ctx: RequestContext;

    try {
      if (authConfig.mode === 'none') {
        const user = createAnonymousUser(['admin']);
        ctx = createRequestContext(user, BUILT_IN_ROLES);
      } else {
        // Create fake Express request for header extraction
        const fakeReq = { headers: req.headers } as { headers: IncomingMessage['headers'] };
        const user = extractUserFromRequest(fakeReq as unknown as import('express').Request, authConfig);

        if (!user && !authConfig.roleMapping.anonymousRole) {
          socket.close(4401, 'Authentication required');
          return;
        }

        const finalUser = user || createAnonymousUser([authConfig.roleMapping.anonymousRole!]);

        // Resolve roles
        const groupRoles = roleStore.mapGroupsToRoles(finalUser.groups || [], authConfig);
        const dbRoles = await roleStore.getUserRoles(finalUser.id);
        finalUser.roles = [...new Set([...groupRoles, ...dbRoles])];

        if (finalUser.roles.length === 0) {
          finalUser.roles = [authConfig.roleMapping.defaultRole];
        }

        const allRoles = await roleStore.getRoles();
        ctx = createRequestContext(finalUser, allRoles);
      }

      socket.ctx = ctx;

      // Send auth confirmation with capabilities
      sendMessage(socket, {
        type: 'auth',
        data: {
          user: {
            id: ctx.user.id,
            username: ctx.user.username
          },
          capabilities: Array.from(ctx.capabilities)
        }
      });

      // Send initial stream list if user has permission
      if (ctx.hasCapability('streams:list')) {
        try {
          const streams = await listStreamContainers();
          sendMessage(socket, { type: 'streams:list', data: streams });
        } catch (err) {
          sendMessage(socket, {
            type: 'error',
            message: 'Failed to fetch streams',
            code: 'DOCKER_ERROR'
          });
        }
      }
    } catch (err) {
      socket.close(4500, 'Authentication error');
      return;
    }

    // Handle pong for heartbeat
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    // Handle incoming messages
    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage;
        handleClientMessage(socket, msg);
      } catch {
        sendMessage(socket, {
          type: 'error',
          message: 'Invalid message format',
          code: 'INVALID_MESSAGE'
        });
      }
    });

    // Handle disconnect
    socket.on('close', () => {
      cleanupSocket(socket);
    });

    socket.on('error', () => {
      cleanupSocket(socket);
    });
  });

  // Poll Docker API every 5 seconds for container status changes
  serverState.pollInterval = setInterval(async () => {
    try {
      const streams = await listStreamContainers();

      // Broadcast to all connected clients with streams:list capability
      wss.clients.forEach((client) => {
        const socket = client as AuthenticatedSocket;
        if (socket.readyState === WebSocket.OPEN && socket.ctx?.hasCapability('streams:list')) {
          sendMessage(socket, { type: 'streams:list', data: streams });

          // Send individual status updates for subscribed containers
          for (const stream of streams) {
            if (socket.subscriptions.has(`health:${stream.id}`)) {
              sendMessage(socket, {
                type: 'stream:status',
                id: stream.id,
                data: { status: stream.status, health: stream.health }
              });
            }
          }
        }
      });
    } catch (err) {
      // Log error but don't crash - Docker might be temporarily unavailable
      console.error('[WebSocket] Docker poll error:', err);
    }
  }, 5000);

  // Heartbeat to detect dead connections (ping every 30 seconds)
  serverState.heartbeatInterval = setInterval(() => {
    wss.clients.forEach((client) => {
      const socket = client as AuthenticatedSocket;

      if (!socket.isAlive) {
        cleanupSocket(socket);
        socket.terminate();
        return;
      }

      socket.isAlive = false;
      socket.ping();
    });
  }, 30000);

  return wss;
}

function sendMessage(socket: AuthenticatedSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function handleClientMessage(socket: AuthenticatedSocket, msg: ClientMessage) {
  switch (msg.type) {
    case 'ping':
      sendMessage(socket, { type: 'pong' });
      break;

    case 'subscribe:logs':
      handleSubscribeLogs(socket, msg.id);
      break;

    case 'unsubscribe:logs':
      handleUnsubscribeLogs(socket, msg.id);
      break;

    case 'subscribe:health':
      if (!socket.ctx.hasCapability('streams:health')) {
        sendMessage(socket, {
          type: 'error',
          message: 'Permission denied',
          code: 'FORBIDDEN'
        });
        return;
      }
      socket.subscriptions.add(`health:${msg.id}`);
      break;

    case 'unsubscribe:health':
      socket.subscriptions.delete(`health:${msg.id}`);
      break;

    default:
      sendMessage(socket, {
        type: 'error',
        message: 'Unknown message type',
        code: 'UNKNOWN_TYPE'
      });
  }
}

async function handleSubscribeLogs(socket: AuthenticatedSocket, containerId: string) {
  if (!socket.ctx.hasCapability('streams:logs')) {
    sendMessage(socket, {
      type: 'error',
      message: 'Permission denied',
      code: 'FORBIDDEN'
    });
    return;
  }

  // Check if already subscribed
  if (socket.subscriptions.has(`logs:${containerId}`)) {
    return;
  }

  // Verify container exists and is a page-stream container
  try {
    const container = await getContainer(containerId);
    if (!container) {
      sendMessage(socket, {
        type: 'error',
        message: 'Container not found',
        code: 'NOT_FOUND'
      });
      return;
    }
  } catch (err) {
    sendMessage(socket, {
      type: 'error',
      message: 'Failed to verify container',
      code: 'DOCKER_ERROR'
    });
    return;
  }

  socket.subscriptions.add(`logs:${containerId}`);

  // Start streaming logs for this container
  const abortController = new AbortController();
  socket.logAbortControllers.set(containerId, abortController);

  streamLogsToSocket(socket, containerId, abortController.signal);
}

async function streamLogsToSocket(
  socket: AuthenticatedSocket,
  containerId: string,
  signal: AbortSignal
) {
  try {
    for await (const line of streamLogs(containerId)) {
      if (signal.aborted) break;
      if (socket.readyState !== WebSocket.OPEN) break;

      // Send log line
      sendMessage(socket, {
        type: 'stream:log',
        id: containerId,
        data: line
      });

      // Check if it's a health line and also send health update
      const health = parseHealthLine(line);
      if (health && socket.subscriptions.has(`health:${containerId}`)) {
        sendMessage(socket, {
          type: 'stream:health',
          id: containerId,
          data: health
        });
      }
    }
  } catch (err) {
    if (!signal.aborted && socket.readyState === WebSocket.OPEN) {
      sendMessage(socket, {
        type: 'error',
        message: 'Log streaming error',
        code: 'STREAM_ERROR'
      });
    }
  }
}

function handleUnsubscribeLogs(socket: AuthenticatedSocket, containerId: string) {
  socket.subscriptions.delete(`logs:${containerId}`);

  // Abort log streaming if active
  const controller = socket.logAbortControllers.get(containerId);
  if (controller) {
    controller.abort();
    socket.logAbortControllers.delete(containerId);
  }
}

function cleanupSocket(socket: AuthenticatedSocket) {
  // Abort all log streams
  socket.logAbortControllers.forEach((controller) => {
    controller.abort();
  });
  socket.logAbortControllers.clear();
  socket.subscriptions.clear();
}

// Cleanup function for graceful shutdown
export function closeWebSocketServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!serverState) {
      resolve();
      return;
    }

    // Stop polling
    if (serverState.pollInterval) {
      clearInterval(serverState.pollInterval);
    }
    if (serverState.heartbeatInterval) {
      clearInterval(serverState.heartbeatInterval);
    }

    // Close all connections
    serverState.wss.clients.forEach((client) => {
      const socket = client as AuthenticatedSocket;
      cleanupSocket(socket);
      socket.close(1001, 'Server shutting down');
    });

    // Close server
    serverState.wss.close(() => {
      serverState = null;
      resolve();
    });
  });
}
