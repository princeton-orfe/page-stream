import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, Server as HttpServer } from 'http';
import { WebSocket } from 'ws';
import { AddressInfo } from 'net';
import { createWebSocketServer, closeWebSocketServer, ServerMessage, ClientMessage } from '../../src/server/websocket.js';
import { AuthConfig } from '../../src/server/auth/types.js';
import { DEFAULT_AUTH_CONFIG } from '../../src/server/auth/extractors.js';
import { BUILT_IN_ROLES } from '../../src/server/auth/rbac.js';
import { RoleStore } from '../../src/server/auth/middleware.js';

// Mock docker module
vi.mock('../../src/server/docker.js', () => ({
  listStreamContainers: vi.fn().mockResolvedValue([
    {
      id: 'container-1',
      name: 'page-stream-test',
      status: 'running',
      health: 'healthy',
      created: '2024-01-01T00:00:00Z',
      image: 'page-stream:latest',
      labels: {},
      ports: []
    }
  ]),
  getContainer: vi.fn().mockResolvedValue({
    id: 'container-1',
    name: 'page-stream-test',
    status: 'running',
    health: 'healthy',
    created: '2024-01-01T00:00:00Z',
    image: 'page-stream:latest',
    labels: {},
    ports: []
  }),
  streamLogs: vi.fn().mockImplementation(async function* () {
    yield '2024-01-01T00:00:00Z Test log line';
    yield '[health] {"type":"health","uptimeSec":100,"ingest":"test","protocol":"SRT"}';
  })
}));

// Create mock role store
function createMockRoleStore(): RoleStore {
  return {
    getRoles: vi.fn().mockResolvedValue(BUILT_IN_ROLES),
    getUserRoles: vi.fn().mockResolvedValue([]),
    mapGroupsToRoles: vi.fn().mockReturnValue([])
  };
}

// Helper to connect and wait for a message
async function connectAndWait(
  port: number,
  headers: Record<string, string> = {}
): Promise<{ ws: WebSocket; message: ServerMessage; messages: ServerMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`, { headers });
    const messages: ServerMessage[] = [];
    let resolved = false;

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      messages.push(message);
      if (!resolved) {
        resolved = true;
        // Allow time for additional messages to queue up
        setTimeout(() => resolve({ ws, message, messages }), 50);
      }
    });

    ws.on('error', reject);

    setTimeout(() => reject(new Error('Connection timeout')), 5000);
  });
}

// Helper to send message and wait for response
async function sendAndWait(
  ws: WebSocket,
  message: ClientMessage,
  timeout = 1000
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const handler = (data: Buffer | ArrayBuffer | Buffer[]) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      ws.off('message', handler);
      resolve(msg);
    };

    ws.on('message', handler);
    ws.send(JSON.stringify(message));

    setTimeout(() => {
      ws.off('message', handler);
      reject(new Error('Response timeout'));
    }, timeout);
  });
}

// Helper to wait for specific message type
async function waitForMessageType(
  ws: WebSocket,
  type: ServerMessage['type'],
  timeout = 1000
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const handler = (data: Buffer | ArrayBuffer | Buffer[]) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === type) {
        ws.off('message', handler);
        resolve(msg);
      }
    };

    ws.on('message', handler);

    setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timeout waiting for message type: ${type}`));
    }, timeout);
  });
}

describe('WebSocket Server', () => {
  let httpServer: HttpServer;
  let port: number;
  let roleStore: RoleStore;

  beforeEach(() => {
    httpServer = createServer();
    roleStore = createMockRoleStore();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await closeWebSocketServer();
    return new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  });

  describe('Connection and Authentication', () => {
    it('should accept connections and send auth message (mode=none)', async () => {
      const config: AuthConfig = { ...DEFAULT_AUTH_CONFIG, mode: 'none' };
      createWebSocketServer(httpServer, config, roleStore);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => resolve());
      });
      port = (httpServer.address() as AddressInfo).port;

      const { ws, message } = await connectAndWait(port);

      expect(message.type).toBe('auth');
      if (message.type === 'auth') {
        expect(message.data.user.id).toBe('anonymous');
        expect(message.data.user.username).toBe('Anonymous');
        expect(message.data.capabilities).toContain('streams:list');
        expect(message.data.capabilities).toContain('streams:logs');
      }

      ws.close();
    });

    it('should send initial streams list after auth', async () => {
      const config: AuthConfig = { ...DEFAULT_AUTH_CONFIG, mode: 'none' };
      createWebSocketServer(httpServer, config, roleStore);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => resolve());
      });
      port = (httpServer.address() as AddressInfo).port;

      const { ws, messages } = await connectAndWait(port);

      // Wait a bit more for additional messages
      await new Promise((r) => setTimeout(r, 100));

      // Find streams list in collected messages
      const streamsMsg = messages.find(m => m.type === 'streams:list');

      expect(streamsMsg).toBeDefined();
      if (streamsMsg && streamsMsg.type === 'streams:list') {
        expect(Array.isArray(streamsMsg.data)).toBe(true);
        expect(streamsMsg.data.length).toBe(1);
        expect(streamsMsg.data[0].name).toBe('page-stream-test');
      }

      ws.close();
    });

    it('should authenticate using proxy headers (mode=proxy)', async () => {
      const config: AuthConfig = {
        ...DEFAULT_AUTH_CONFIG,
        mode: 'proxy',
        roleMapping: {
          ...DEFAULT_AUTH_CONFIG.roleMapping,
          defaultRole: 'viewer'
        }
      };
      createWebSocketServer(httpServer, config, roleStore);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => resolve());
      });
      port = (httpServer.address() as AddressInfo).port;

      const { ws, message } = await connectAndWait(port, {
        'x-forwarded-user': 'testuser',
        'x-forwarded-email': 'test@example.com',
        'x-forwarded-preferred-username': 'Test User'
      });

      expect(message.type).toBe('auth');
      if (message.type === 'auth') {
        expect(message.data.user.id).toBe('testuser');
        expect(message.data.user.username).toBe('Test User');
      }

      ws.close();
    });

    it('should reject unauthenticated connections when anonymous not allowed', async () => {
      const config: AuthConfig = {
        ...DEFAULT_AUTH_CONFIG,
        mode: 'proxy',
        roleMapping: {
          ...DEFAULT_AUTH_CONFIG.roleMapping,
          anonymousRole: null
        }
      };
      createWebSocketServer(httpServer, config, roleStore);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => resolve());
      });
      port = (httpServer.address() as AddressInfo).port;

      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}`);

        ws.on('close', (code) => {
          expect(code).toBe(4401);
          resolve();
        });

        ws.on('error', () => {
          // Expected
        });

        ws.on('open', () => {
          // Wait a bit for potential close
          setTimeout(() => reject(new Error('Should have been rejected')), 1000);
        });
      });
    });
  });

  describe('Message Handling', () => {
    it('should respond to ping with pong', async () => {
      const config: AuthConfig = { ...DEFAULT_AUTH_CONFIG, mode: 'none' };
      createWebSocketServer(httpServer, config, roleStore);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => resolve());
      });
      port = (httpServer.address() as AddressInfo).port;

      const { ws } = await connectAndWait(port);

      // Skip past initial streams:list
      await waitForMessageType(ws, 'streams:list').catch(() => {});

      const response = await sendAndWait(ws, { type: 'ping' });

      expect(response.type).toBe('pong');

      ws.close();
    });

    it('should handle invalid JSON gracefully', async () => {
      const config: AuthConfig = { ...DEFAULT_AUTH_CONFIG, mode: 'none' };
      createWebSocketServer(httpServer, config, roleStore);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => resolve());
      });
      port = (httpServer.address() as AddressInfo).port;

      const { ws } = await connectAndWait(port);

      // Skip past initial streams:list
      await waitForMessageType(ws, 'streams:list').catch(() => {});

      return new Promise<void>((resolve, reject) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as ServerMessage;
          if (msg.type === 'error') {
            expect(msg.message).toBe('Invalid message format');
            expect(msg.code).toBe('INVALID_MESSAGE');
            ws.close();
            resolve();
          }
        });

        ws.send('not json');

        setTimeout(() => reject(new Error('Error message timeout')), 2000);
      });
    });

    it('should handle unknown message types', async () => {
      const config: AuthConfig = { ...DEFAULT_AUTH_CONFIG, mode: 'none' };
      createWebSocketServer(httpServer, config, roleStore);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => resolve());
      });
      port = (httpServer.address() as AddressInfo).port;

      const { ws } = await connectAndWait(port);

      // Skip past initial streams:list
      await waitForMessageType(ws, 'streams:list').catch(() => {});

      return new Promise<void>((resolve, reject) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as ServerMessage;
          if (msg.type === 'error' && msg.code === 'UNKNOWN_TYPE') {
            expect(msg.message).toBe('Unknown message type');
            ws.close();
            resolve();
          }
        });

        ws.send(JSON.stringify({ type: 'unknown_type' }));

        setTimeout(() => reject(new Error('Error message timeout')), 2000);
      });
    });
  });

  describe('Subscriptions', () => {
    it('should allow subscribing to health updates', async () => {
      const config: AuthConfig = { ...DEFAULT_AUTH_CONFIG, mode: 'none' };
      createWebSocketServer(httpServer, config, roleStore);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => resolve());
      });
      port = (httpServer.address() as AddressInfo).port;

      const { ws } = await connectAndWait(port);

      // Skip past initial messages
      await waitForMessageType(ws, 'streams:list').catch(() => {});

      // Subscribe to health
      ws.send(JSON.stringify({ type: 'subscribe:health', id: 'container-1' }));

      // No error means success (subscription is tracked internally)
      // Wait a bit to ensure no error
      await new Promise(resolve => setTimeout(resolve, 100));

      ws.close();
    });

    it('should allow subscribing to logs', async () => {
      const config: AuthConfig = { ...DEFAULT_AUTH_CONFIG, mode: 'none' };
      createWebSocketServer(httpServer, config, roleStore);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => resolve());
      });
      port = (httpServer.address() as AddressInfo).port;

      const { ws } = await connectAndWait(port);

      // Skip past initial messages
      await waitForMessageType(ws, 'streams:list').catch(() => {});

      // Subscribe to logs
      ws.send(JSON.stringify({ type: 'subscribe:logs', id: 'container-1' }));

      // Should receive log messages
      const logMsg = await waitForMessageType(ws, 'stream:log', 2000);

      expect(logMsg.type).toBe('stream:log');
      if (logMsg.type === 'stream:log') {
        expect(logMsg.id).toBe('container-1');
        expect(typeof logMsg.data).toBe('string');
      }

      ws.close();
    });

    it('should unsubscribe from logs', async () => {
      const config: AuthConfig = { ...DEFAULT_AUTH_CONFIG, mode: 'none' };
      createWebSocketServer(httpServer, config, roleStore);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => resolve());
      });
      port = (httpServer.address() as AddressInfo).port;

      const { ws } = await connectAndWait(port);

      // Skip past initial messages
      await waitForMessageType(ws, 'streams:list').catch(() => {});

      // Subscribe then unsubscribe
      ws.send(JSON.stringify({ type: 'subscribe:logs', id: 'container-1' }));
      await new Promise(resolve => setTimeout(resolve, 100));

      ws.send(JSON.stringify({ type: 'unsubscribe:logs', id: 'container-1' }));
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should complete without error
      ws.close();
    });
  });

  describe('Capability Enforcement', () => {
    it('should deny health subscription without capability', async () => {
      // Create a config that assigns a role without streams:health capability
      const roleStore: RoleStore = {
        getRoles: vi.fn().mockResolvedValue([
          {
            id: 'limited',
            name: 'Limited',
            description: 'No health access',
            capabilities: ['streams:list'],
            builtIn: false
          }
        ]),
        getUserRoles: vi.fn().mockResolvedValue(['limited']),
        mapGroupsToRoles: vi.fn().mockReturnValue([])
      };

      const config: AuthConfig = {
        ...DEFAULT_AUTH_CONFIG,
        mode: 'proxy',
        roleMapping: {
          ...DEFAULT_AUTH_CONFIG.roleMapping,
          defaultRole: 'limited'
        }
      };
      createWebSocketServer(httpServer, config, roleStore);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => resolve());
      });
      port = (httpServer.address() as AddressInfo).port;

      const { ws } = await connectAndWait(port, {
        'x-forwarded-user': 'testuser'
      });

      // Skip past any initial messages (may not get streams:list with limited caps)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Try to subscribe to health
      return new Promise<void>((resolve, reject) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as ServerMessage;
          if (msg.type === 'error' && msg.code === 'FORBIDDEN') {
            expect(msg.message).toBe('Permission denied');
            ws.close();
            resolve();
          }
        });

        ws.send(JSON.stringify({ type: 'subscribe:health', id: 'container-1' }));

        setTimeout(() => reject(new Error('Forbidden error timeout')), 2000);
      });
    });

    it('should deny logs subscription without capability', async () => {
      const roleStore: RoleStore = {
        getRoles: vi.fn().mockResolvedValue([
          {
            id: 'limited',
            name: 'Limited',
            description: 'No logs access',
            capabilities: ['streams:list'],
            builtIn: false
          }
        ]),
        getUserRoles: vi.fn().mockResolvedValue(['limited']),
        mapGroupsToRoles: vi.fn().mockReturnValue([])
      };

      const config: AuthConfig = {
        ...DEFAULT_AUTH_CONFIG,
        mode: 'proxy',
        roleMapping: {
          ...DEFAULT_AUTH_CONFIG.roleMapping,
          defaultRole: 'limited'
        }
      };
      createWebSocketServer(httpServer, config, roleStore);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => resolve());
      });
      port = (httpServer.address() as AddressInfo).port;

      const { ws } = await connectAndWait(port, {
        'x-forwarded-user': 'testuser'
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      return new Promise<void>((resolve, reject) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as ServerMessage;
          if (msg.type === 'error' && msg.code === 'FORBIDDEN') {
            expect(msg.message).toBe('Permission denied');
            ws.close();
            resolve();
          }
        });

        ws.send(JSON.stringify({ type: 'subscribe:logs', id: 'container-1' }));

        setTimeout(() => reject(new Error('Forbidden error timeout')), 2000);
      });
    });
  });

  describe('Cleanup', () => {
    it('should cleanup on close', async () => {
      const config: AuthConfig = { ...DEFAULT_AUTH_CONFIG, mode: 'none' };
      createWebSocketServer(httpServer, config, roleStore);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => resolve());
      });
      port = (httpServer.address() as AddressInfo).port;

      const { ws } = await connectAndWait(port);

      // Subscribe to something
      await waitForMessageType(ws, 'streams:list').catch(() => {});
      ws.send(JSON.stringify({ type: 'subscribe:logs', id: 'container-1' }));

      await new Promise(resolve => setTimeout(resolve, 100));

      // Close should work cleanly
      return new Promise<void>((resolve) => {
        ws.on('close', () => resolve());
        ws.close();
      });
    });

    it('should close all connections on server shutdown', async () => {
      const config: AuthConfig = { ...DEFAULT_AUTH_CONFIG, mode: 'none' };
      createWebSocketServer(httpServer, config, roleStore);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => resolve());
      });
      port = (httpServer.address() as AddressInfo).port;

      const { ws } = await connectAndWait(port);

      await waitForMessageType(ws, 'streams:list').catch(() => {});

      return new Promise<void>((resolve) => {
        ws.on('close', () => resolve());
        closeWebSocketServer();
      });
    });
  });
});

describe('Message Types', () => {
  it('should have correct ServerMessage type structure', () => {
    // Type checking - these should compile
    const authMsg: ServerMessage = {
      type: 'auth',
      data: { user: { id: '1', username: 'test' }, capabilities: ['streams:list'] }
    };

    const streamListMsg: ServerMessage = {
      type: 'streams:list',
      data: [{
        id: '1',
        name: 'test',
        status: 'running',
        health: 'healthy',
        created: '2024-01-01',
        image: 'test:latest',
        labels: {},
        ports: []
      }]
    };

    const healthMsg: ServerMessage = {
      type: 'stream:health',
      id: '1',
      data: {
        timestamp: '2024-01-01',
        uptimeSec: 100,
        ingest: 'test',
        protocol: 'SRT',
        restartAttempt: 0,
        lastFfmpegExitCode: null,
        retrying: false
      }
    };

    const logMsg: ServerMessage = {
      type: 'stream:log',
      id: '1',
      data: 'log line'
    };

    const statusMsg: ServerMessage = {
      type: 'stream:status',
      id: '1',
      data: { status: 'running', health: 'healthy' }
    };

    const errorMsg: ServerMessage = {
      type: 'error',
      message: 'test error',
      code: 'TEST'
    };

    const pongMsg: ServerMessage = { type: 'pong' };

    expect(authMsg.type).toBe('auth');
    expect(streamListMsg.type).toBe('streams:list');
    expect(healthMsg.type).toBe('stream:health');
    expect(logMsg.type).toBe('stream:log');
    expect(statusMsg.type).toBe('stream:status');
    expect(errorMsg.type).toBe('error');
    expect(pongMsg.type).toBe('pong');
  });

  it('should have correct ClientMessage type structure', () => {
    const subscribeLogsMsg: ClientMessage = { type: 'subscribe:logs', id: '1' };
    const unsubscribeLogsMsg: ClientMessage = { type: 'unsubscribe:logs', id: '1' };
    const subscribeHealthMsg: ClientMessage = { type: 'subscribe:health', id: '1' };
    const unsubscribeHealthMsg: ClientMessage = { type: 'unsubscribe:health', id: '1' };
    const pingMsg: ClientMessage = { type: 'ping' };

    expect(subscribeLogsMsg.type).toBe('subscribe:logs');
    expect(unsubscribeLogsMsg.type).toBe('unsubscribe:logs');
    expect(subscribeHealthMsg.type).toBe('subscribe:health');
    expect(unsubscribeHealthMsg.type).toBe('unsubscribe:health');
    expect(pingMsg.type).toBe('ping');
  });
});
