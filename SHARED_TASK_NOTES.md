# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: COMPLETE
**Phase 2 (Control Actions)**: COMPLETE
**Phase 3 (CRUD Operations)**: IN PROGRESS (Steps 3.1-3.3 complete)

## Completed in This Iteration
- **Step 3.3**: Container generation (`src/server/docker-generator.ts`)
  - `generateContainerConfig()`: Converts StreamConfig to Docker ContainerCreateOptions
  - `generateCommand()`: Builds CLI arguments for page-stream
  - `generateEnvironment()`: Creates environment variables (DISPLAY, WIDTH, HEIGHT, etc.)
  - `generateVolumeMounts()`: Handles demo/output mounts, local file URLs, inject paths
  - `generateLabels()`: Sets managed labels for container identification
  - `generateHealthcheck()`: Configures health checks (pgrep Xvfb/chrome/ffmpeg)
  - `resolveDisplay()`: Auto-assigns X11 displays with optional DB persistence
  - `getNetworkForStreamType()`: Routes compositor sources to compositor_net
  - `validateContainerConfig()`: Pre-flight validation of container config
  - Exports: `CONTAINER_LABELS`, `NETWORKS`, `DEFAULT_PAGE_STREAM_IMAGE`

- **Tests**: 53 new tests for docker-generator - 405 total tests passing

## Next Steps
**Phase 3 (CRUD Operations)** - Continue with:
1. **Step 3.4**: CRUD API routes with RBAC (POST/PUT/DELETE /api/streams)
   - Need to integrate docker-generator with docker.ts to actually create containers
   - Add `createAndStartContainer()` function to docker.ts
   - Add routes: POST /api/streams, PUT /api/streams/:id, DELETE /api/streams/:id
2. **Step 3.5**: Frontend - Stream form with capability gates
3. **Step 3.6**: Templates system

## How to Run
```bash
cd stream-manager

# Development
npm test           # Run all tests (405 passing)
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
- **Control Flow**: StreamCard uses simple Start/Stop toggle; StreamDetail has full controls with confirmation for Stop
- **Audit Log**: Capability-gated (`audit:read`), supports filtering by action/user/date, CSV export up to 10,000 entries
- **Stream Config**: Full validation with defaults, supports import/export JSON, X11 display auto-assignment from :99-:199
- **Container Generation**: Supports `persistDisplayAssignment` option - set to false for preview, true when creating actual containers
