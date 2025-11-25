# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: COMPLETE
**Phase 2 (Control Actions)**: IN PROGRESS - Steps 2.1 and 2.2 complete

## Completed in This Iteration
- **Step 2.2**: Control API routes added to `src/server/routes/streams.ts`:
  - `POST /api/streams/:id/start` - Start a stopped container
  - `POST /api/streams/:id/stop` - Stop a running container (accepts optional `timeout`)
  - `POST /api/streams/:id/restart` - Restart a container (accepts optional `timeout`)
  - `POST /api/streams/:id/refresh` - Refresh via FIFO or SIGHUP fallback
  - All routes enforce capability requirements (`streams:start`, `streams:stop`, etc.)
  - Rate limiting: max 1 control action per container per 5 seconds (429 response)
  - Audit logging via `logAuditEvent()` on success and failure
  - WebSocket broadcast via `broadcastContainerStatusChange()` after actions
  - 38 tests added covering all routes, rate limiting, and audit logging

## Next Steps
**Phase 2 (Control Actions)** - continue with:
1. **Step 2.3**: Frontend control buttons and actions (StreamCard.tsx, StreamDetail.tsx)
2. **Step 2.4**: Bulk actions API (optional, could skip for MVP)
3. **Step 2.5**: Additional audit logging features (query API for audit log)

## How to Run
```bash
cd stream-manager

# Development
npm test           # Run all tests (226 passing)
npm run typecheck  # TypeScript check
npm run dev        # Start backend server (port 3001)
npm run dev:client # Start Vite dev server (port 3000)

# Production
npm run build      # Build server and client
npm start          # Start production server

# Docker
docker build -t stream-manager:latest .
docker-compose up -d
```

## Key Decisions Made
- **Auth Mode**: Defaults to `none` (open mode, everyone gets admin). Set `AUTH_MODE=proxy` for production.
- **Docker Socket**: Runs as root to access Docker socket. For security-conscious deployments, consider running with docker group membership.
- **Database**: SQLite with WAL mode at `/data/stream-manager.db`
- **Container Detection**: Filters by image name containing `page-stream` OR label `com.page-stream.managed=true`
- **Retry Logic**: Only retries on connection errors (ECONNREFUSED, ENOTFOUND), not on application errors
- **Rate Limiting**: In-memory Map per container, 5 second cooldown between actions
