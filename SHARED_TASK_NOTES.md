# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: COMPLETE
**Phase 2 (Control Actions)**: IN PROGRESS - Steps 2.1, 2.2, and 2.3 complete

## Completed in This Iteration
- **Step 2.3**: Frontend control buttons implemented:
  - `useStreamControl` hook (`src/client/hooks/useStreamControl.ts`): Wraps useMutation for start/stop/restart/refresh actions with loading state and error handling
  - `StreamCard.tsx`: Start/Stop toggle button + Refresh button (when running), gated by capability
  - `StreamDetail.tsx`: Full control bar with Start/Stop/Restart/Refresh buttons, plus confirmation dialog for Stop action
  - `ConfirmDialog.tsx`: Reusable confirmation dialog component with backdrop, escape key handling
  - CSS styles for buttons, dialogs, and error messages added to `styles.css`
  - 10 new tests added for StreamCard control buttons and ConfirmDialog (240 total tests passing)

## Next Steps
**Phase 2 (Control Actions)** - continue with:
1. **Step 2.4**: Bulk actions API (optional, could skip for MVP)
2. **Step 2.5**: Additional audit logging features (query API for audit log)

**Phase 3 (Templates & Groups)** - if Phase 2 complete:
1. Template management API and UI
2. Stream groups and batch operations

## How to Run
```bash
cd stream-manager

# Development
npm test           # Run all tests (240 passing)
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
