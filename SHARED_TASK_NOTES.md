# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: In Progress - Steps 1.1-1.12 Complete

## Next Steps (in order)
1. **Step 1.13: Frontend Build** - Configure Vite for production build, ensure server serves static files
2. **Step 1.14: Docker Integration** - Dockerfile and docker-compose for the manager
3. **Step 1.15: Testing & Documentation** - Integration tests, README

## How to Run
```bash
cd stream-manager
npm test           # Run all tests (190 passing)
npm run typecheck  # TypeScript check
npm run dev        # Start development server (tsx watch)
npm run dev:client # Start Vite dev server for frontend
```

## Key Files
- `src/server/index.ts` - Express server entry point with graceful shutdown
- `src/server/auth/` - Auth module (types, rbac, extractors, middleware)
- `src/server/db/` - Database initialization, user store, audit logging
- `src/server/docker.ts` - Docker API client
- `src/server/health-parser.ts` - Health log parsing
- `src/server/routes/` - REST API routes (streams.ts, auth.ts)
- `src/server/websocket.ts` - WebSocket server for real-time updates
- `src/client/App.tsx` - Main React app with providers and routing
- `src/client/contexts/AuthContext.tsx` - Auth state provider
- `src/client/components/` - Dashboard, StreamCard, StreamDetail, LogViewer, etc.
- `src/client/hooks/` - useAuth, useStreams, useWebSocket

## API Endpoints
- `GET /api/health` - Health check, returns `{ status: 'ok', authMode: '...' }`
- `GET /api/auth/me` - Current user info and capabilities
- `GET /api/streams` - List all streams
- `GET /api/streams/:id` - Get stream details with recent logs
- `GET /api/streams/:id/logs` - Get stream logs
- `GET /api/streams/:id/health/history` - Get health history
- `ws://localhost:3001` - WebSocket for real-time updates

## Frontend Components (Step 1.11-1.12 Complete)
- `AuthContext` + `useAuth` - Auth state provider and hook
- `UserMenu` - Shows current user, role, and Open Mode indicator
- `CapabilityGate` - Conditional rendering based on capabilities
- `HealthIndicator` - Colored dot showing stream health
- `StreamCard` - Stream summary card with click-to-detail
- `StreamDetail` - Full container info, health history, embedded logs
- `LogViewer` - Log display with filter, auto-scroll, health highlighting
- `Dashboard` - Stats summary + stream grid with live WebSocket updates

## Notes
- All 190 tests passing (155 server + 35 client component tests)
- Auth defaults to `mode: 'none'` (everyone gets admin) - configure `AUTH_MODE=proxy` for production
- Database uses SQLite with WAL mode
- Docker client filters containers by image name containing `page-stream` or label `com.page-stream.managed=true`
- WebSocket server handles auth using same header logic as REST API
- Server supports graceful shutdown (SIGTERM/SIGINT)
- Frontend uses React Query for data fetching and WebSocket for real-time updates
