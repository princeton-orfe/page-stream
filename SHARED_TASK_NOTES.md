# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: COMPLETE
**Phase 2 (Control Actions)**: COMPLETE

## Completed in This Iteration
- **Step 2.5**: Audit Log Viewer implemented:
  - Backend API (`src/server/routes/audit.ts`): GET /api/audit (with filters), GET /api/audit/actions, GET /api/audit/export (CSV)
  - Frontend hook (`src/client/hooks/useAuditLog.ts`): useAuditLog, useAuditActions, getExportUrl
  - Frontend component (`src/client/components/AuditLog.tsx`): Table with filters, pagination, export
  - Navigation updated in App.tsx with capability-gated Audit Log button
  - 24 new tests (15 backend + 9 frontend) - 264 total tests passing

## Next Steps
**Phase 3 (CRUD Operations)** - Start with:
1. **Step 3.1**: Stream configuration schema
2. **Step 3.2**: Template storage and API
3. **Step 3.3**: Create stream from template UI

Note: Step 2.4 (Bulk actions API) was skipped as optional for MVP.

## How to Run
```bash
cd stream-manager

# Development
npm test           # Run all tests (264 passing)
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
