# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: In Progress - Steps 1.1-1.9 Complete

## Next Steps (in order)
1. **Step 1.10: Express Server Entry** - Wire everything together in `src/server/index.ts`
2. **Step 1.11-1.12: React Frontend** - AuthContext, Dashboard, StreamCard, LogViewer components
3. **Step 1.13: Frontend Build** - Vite config for production build
4. **Step 1.14: Docker Integration** - Dockerfile and docker-compose for the manager
5. **Step 1.15: Testing & Documentation** - Integration tests, README

## How to Run Tests
```bash
cd stream-manager
npm test           # Run all tests (143 passing)
npm run typecheck  # TypeScript check
```

## Key Files
- `src/server/auth/` - Auth module (types, rbac, extractors, middleware)
- `src/server/db/` - Database initialization, user store, audit logging
- `src/server/docker.ts` - Docker API client
- `src/server/health-parser.ts` - Health log parsing
- `src/server/routes/` - REST API routes (streams.ts, auth.ts)
- `src/server/websocket.ts` - WebSocket server for real-time updates
- `src/client/` - Basic React app structure

## Implementation Plan Reference
See `STREAM-MANAGER-IMPLEMENTATION-PLAN.md` for full details on each step.

## Notes
- Auth defaults to `mode: 'none'` (everyone gets admin) - configure `AUTH_MODE=proxy` for production
- Database uses SQLite with WAL mode at `./data/stream-manager.db`
- Docker client filters containers by image name containing `page-stream` or label `com.page-stream.managed=true`
- WebSocket server handles auth using same header logic as REST API
- WebSocket supports real-time log streaming and health updates with capability enforcement
