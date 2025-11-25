# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: COMPLETE
**Phase 2 (Control Actions)**: IN PROGRESS - Step 2.1 complete

## Completed in This Iteration
- **Step 2.1**: Docker control functions added to `src/server/docker.ts`:
  - `startContainer(id)` - Start a stopped container
  - `stopContainer(id, timeout?)` - Stop with graceful shutdown (default 30s)
  - `restartContainer(id, timeout?)` - Restart container
  - `signalContainer(id, signal)` - Send signal (e.g., SIGHUP)
  - `execInContainer(id, cmd[])` - Execute command, returns stdout/stderr/exitCode
  - `refreshContainer(id)` - FIFO write with SIGHUP fallback
  - All functions verify container is managed (page-stream image or label)
  - Improved retry logic: only retries on transient connection errors

## Next Steps
**Phase 2 (Control Actions)** - continue with:
1. **Step 2.2**: Control API routes with capability enforcement
2. **Step 2.3**: Frontend control buttons and actions
3. **Step 2.4**: (Merged into 2.1 - refreshContainer already implemented)
4. **Step 2.5**: Audit logging for control actions

## How to Run
```bash
cd stream-manager

# Development
npm test           # Run all tests (204 passing)
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
