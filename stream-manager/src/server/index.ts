import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { initDatabase, closeDatabase } from './db/index.js';
import { createAuthMiddleware, RoleStore } from './auth/middleware.js';
import { DEFAULT_AUTH_CONFIG } from './auth/extractors.js';
import { AuthConfig } from './auth/types.js';
import { createRoleStore, recordUserSeen } from './db/users.js';
import { createWebSocketServer, closeWebSocketServer, broadcastContainerStatusChange } from './websocket.js';
import { streamsRouter, authRouter } from './routes/index.js';
import { setBroadcastCallback } from './routes/streams.js';

// Load config from environment
function loadAuthConfig(): AuthConfig {
  const mode = (process.env.AUTH_MODE || 'none') as 'none' | 'proxy';

  return {
    ...DEFAULT_AUTH_CONFIG,
    mode,
    headers: {
      userId: process.env.AUTH_HEADER_USER || DEFAULT_AUTH_CONFIG.headers.userId,
      email: process.env.AUTH_HEADER_EMAIL || DEFAULT_AUTH_CONFIG.headers.email,
      groups: process.env.AUTH_HEADER_GROUPS || DEFAULT_AUTH_CONFIG.headers.groups,
      name: process.env.AUTH_HEADER_NAME || DEFAULT_AUTH_CONFIG.headers.name,
    },
    roleMapping: {
      groupRoles: process.env.AUTH_GROUP_ROLES
        ? JSON.parse(process.env.AUTH_GROUP_ROLES)
        : DEFAULT_AUTH_CONFIG.roleMapping.groupRoles,
      defaultRole: process.env.AUTH_DEFAULT_ROLE || DEFAULT_AUTH_CONFIG.roleMapping.defaultRole,
      anonymousRole: process.env.AUTH_ANONYMOUS_ROLE || DEFAULT_AUTH_CONFIG.roleMapping.anonymousRole,
    }
  };
}

export async function createApp(roleStore?: RoleStore) {
  // Load auth config
  const authConfig = loadAuthConfig();
  const store = roleStore || createRoleStore();

  // Create Express app
  const app = express();
  const server = createServer(app);

  // Middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", "ws:", "wss:"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      }
    }
  }));
  app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' }));
  app.use(express.json());

  // Auth middleware - runs on all routes
  app.use(createAuthMiddleware(authConfig, store));

  // Record user visits (for admin visibility)
  app.use((req, res, next) => {
    if (req.ctx.user.authSource === 'header') {
      recordUserSeen(req.ctx.user.id, req.ctx.user.username, req.ctx.user.email);
    }
    next();
  });

  // Health check (no auth required - runs after auth middleware but doesn't need capabilities)
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', authMode: authConfig.mode });
  });

  // API routes
  app.use('/api/auth', authRouter);
  app.use('/api/streams', streamsRouter);

  // Static files (frontend)
  app.use(express.static('dist/client'));
  app.get('*', (req, res) => {
    res.sendFile('index.html', { root: 'dist/client' });
  });

  // WebSocket
  createWebSocketServer(server, authConfig, store);

  // Wire up broadcast callback for control routes
  setBroadcastCallback(broadcastContainerStatusChange);

  return { app, server, authConfig };
}

async function main() {
  // Initialize database
  const dbPath = process.env.DATABASE_PATH || './data/stream-manager.db';

  // Ensure data directory exists
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
  } catch {
    // Directory may already exist
  }

  initDatabase(dbPath);

  // Create role store
  const roleStore = createRoleStore();

  // Create app and server
  const { server, authConfig } = await createApp(roleStore);

  // Start server
  const port = parseInt(process.env.PORT || '3001');
  server.listen(port, () => {
    console.log(`Stream Manager running on port ${port}`);
    console.log(`Auth mode: ${authConfig.mode}`);
  });

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);

    // Close WebSocket connections
    await closeWebSocketServer();

    // Close HTTP server
    server.close(() => {
      // Close database
      closeDatabase();
      console.log('Server shut down complete');
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Only run main if this is the entry point
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
