# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: In Progress - Steps 1.1-1.10 Complete

## Next Steps (in order)
1. **Step 1.11-1.12: React Frontend** - AuthContext, Dashboard, StreamCard, LogViewer components
2. **Step 1.13: Frontend Build** - Vite config for production build
3. **Step 1.14: Docker Integration** - Dockerfile and docker-compose for the manager
4. **Step 1.15: Testing & Documentation** - Integration tests, README

## How to Run
```bash
cd stream-manager
npm test           # Run all tests (155 passing)
npm run typecheck  # TypeScript check
npm run dev        # Start development server (tsx watch)
```

## Key Files
- `src/server/index.ts` - Express server entry point with graceful shutdown
- `src/server/auth/` - Auth module (types, rbac, extractors, middleware)
- `src/server/db/` - Database initialization, user store, audit logging
- `src/server/docker.ts` - Docker API client
- `src/server/health-parser.ts` - Health log parsing
- `src/server/routes/` - REST API routes (streams.ts, auth.ts)
- `src/server/websocket.ts` - WebSocket server for real-time updates
- `src/client/` - Basic React app structure (needs components)

## API Endpoints
- `GET /api/health` - Health check, returns `{ status: 'ok', authMode: '...' }`
- `GET /api/auth/me` - Current user info and capabilities
- `GET /api/streams` - List all streams
- `GET /api/streams/:id` - Get stream details with recent logs
- `GET /api/streams/:id/logs` - Get stream logs
- `GET /api/streams/:id/health/history` - Get health history
- `ws://localhost:3001` - WebSocket for real-time updates

## Environment Variables
- `PORT` (default: 3001)
- `DATABASE_PATH` (default: ./data/stream-manager.db)
- `CORS_ORIGIN` (default: http://localhost:3000)
- `AUTH_MODE` (default: 'none', options: 'none', 'proxy')
- `AUTH_ANONYMOUS_ROLE` (default: null, set to 'viewer' for anonymous read)
- See implementation plan for full list

## Notes
- Auth defaults to `mode: 'none'` (everyone gets admin) - configure `AUTH_MODE=proxy` for production
- Database uses SQLite with WAL mode
- Docker client filters containers by image name containing `page-stream` or label `com.page-stream.managed=true`
- WebSocket server handles auth using same header logic as REST API
- Server supports graceful shutdown (SIGTERM/SIGINT)
