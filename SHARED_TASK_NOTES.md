# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: COMPLETE
**Phase 2 (Control Actions)**: COMPLETE
**Phase 3 (CRUD Operations)**: IN PROGRESS (Steps 3.1-3.2 complete)

## Completed in This Iteration
- **Step 3.1**: Stream configuration schema (`src/server/config/schema.ts`)
  - StreamConfig interface with all fields (identity, content, display, encoding, output, behavior, advanced, metadata)
  - Type definitions: StreamType, EncodingPreset, OutputFormat
  - STREAM_CONFIG_DEFAULTS with sensible defaults
  - validateStreamConfig() for full validation on create
  - validatePartialStreamConfig() for partial validation on update
  - StreamConfigValidationError with field/value details

- **Step 3.2**: Configuration storage (`src/server/config/storage.ts`)
  - CRUD: createStreamConfig, getStreamConfig, getStreamConfigByName, listStreamConfigs, updateStreamConfig, deleteStreamConfig
  - duplicateStreamConfig for quick copying
  - Display management: getNextAvailableDisplay, assignDisplay, releaseDisplay, getAssignedDisplay
  - Import/Export: exportConfigs, importConfigs (with skipExisting/overwrite options)
  - Database migrations: 005_stream_configs, 006_display_assignments

- **Tests**: 88 new tests (47 schema + 41 storage) - 352 total tests passing

## Next Steps
**Phase 3 (CRUD Operations)** - Continue with:
1. **Step 3.3**: Container generation (convert StreamConfig → Docker container)
2. **Step 3.4**: CRUD API routes with RBAC (POST/PUT/DELETE /api/streams)
3. **Step 3.5**: Frontend - Stream form with capability gates
4. **Step 3.6**: Templates system

## How to Run
```bash
cd stream-manager

# Development
npm test           # Run all tests (352 passing)
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
