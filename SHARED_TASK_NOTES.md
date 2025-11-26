# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: COMPLETE
**Phase 2 (Control Actions)**: COMPLETE
**Phase 3 (CRUD Operations)**: IN PROGRESS (Steps 3.1-3.4 complete)

## Completed in This Iteration
- **Step 3.4**: CRUD API routes with RBAC
  - Added `createAndStartContainer()` to docker.ts - creates and starts Docker containers
  - Added `removeContainer()` to docker.ts - stops and removes containers
  - Added `getContainerByName()` to docker.ts - lookup containers by name
  - Added CRUD routes to streams.ts:
    - `GET /api/streams/configs` - List all stream configurations (database)
    - `GET /api/streams/configs/:id` - Get stream config by ID
    - `POST /api/streams` - Create new stream config (+ optionally start container)
    - `PUT /api/streams/:id` - Update stream config
    - `DELETE /api/streams/:id` - Delete stream config (+ remove container if running)
    - `POST /api/streams/:id/deploy` - Deploy/redeploy a config as container
  - All routes are capability-gated and audit-logged
  - Tests: 436 total tests passing

## Next Steps
**Phase 3 (CRUD Operations)** - Continue with:
1. **Step 3.5**: Frontend - Stream form with capability gates
   - Create StreamForm.tsx with tabbed sections (Basic, Encoding, Behavior, Advanced)
   - Create CreateStream.tsx page
   - Create EditStream.tsx page
   - Update navigation with "New Stream" button (gated)
2. **Step 3.6**: Templates system

## How to Run
```bash
cd stream-manager

# Development
npm test           # Run all tests (436 passing)
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
- **Route Ordering**: `/configs` routes placed before `/:id` routes to prevent Express from matching "configs" as an ID parameter

## API Endpoints (Phase 3 CRUD)
- `GET /api/streams/configs` - List configs with optional filters (?type=, &enabled=, &limit=, &offset=)
- `GET /api/streams/configs/:id` - Get single config
- `POST /api/streams` - Create config (starts container if enabled=true)
- `PUT /api/streams/:id` - Update config
- `DELETE /api/streams/:id` - Delete config and remove container
- `POST /api/streams/:id/deploy` - Deploy config as new container (removes existing first)
