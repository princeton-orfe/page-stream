# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: COMPLETE - All steps 1.1-1.15 finished

## Next Steps
**Phase 2 (Control Actions)** is ready to begin:
1. **Step 2.1**: Docker control functions (start, stop, restart containers)
2. **Step 2.2**: Control API routes with capability enforcement
3. **Step 2.3**: Frontend control buttons and actions
4. **Step 2.4**: FIFO refresh functionality
5. **Step 2.5**: Audit logging for control actions

## How to Run
```bash
cd stream-manager

# Development
npm test           # Run all tests (190 passing)
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

## Phase 1 Deliverables (All Complete)
- RBAC types and capability definitions
- Auth middleware supporting proxy headers (oauth2-proxy, Azure EasyAuth)
- Role-to-capability resolution
- User/role database storage with audit logging
- Dashboard displaying all page-stream containers
- Real-time status updates via WebSocket
- Health status parsing and display
- Log viewing with filter and auto-scroll
- UserMenu showing current user/role
- CapabilityGate component for conditional UI
- Containerized and runnable via docker-compose
- All 190 tests passing
- README with auth configuration guide
