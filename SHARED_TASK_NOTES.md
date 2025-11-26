# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: COMPLETE
**Phase 2 (Control Actions)**: COMPLETE
**Phase 3 (CRUD Operations)**: COMPLETE

## Completed in This Iteration
- **Save as Template feature**: Added "Save as Template" button to EditStream page
  - Capability-gated (`templates:create`)
  - Dialog with name, description, and category fields
  - Uses existing `POST /api/templates/from-stream/:streamId` endpoint
  - 4 new tests added for the feature
  - Total tests: 520 passing

## Next Steps
**Phase 4 (Optional enhancements)**:
- Compositor management (Step 4.1)
- Stream groups and dependencies (Step 4.2)
- Scheduling system (Step 4.3)
- Monitoring and alerts (Step 4.4)
- User management UI (Step 4.5)
- Metrics export (Step 4.6)
- Production hardening (Step 4.7)
- Auth proxy integration examples (Step 4.8)

## How to Run
```bash
cd stream-manager

# Development
npm test           # Run all tests (520 passing)
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
- **Form Tabs**: StreamForm uses Basic/Encoding/Behavior/Advanced tabs for organized configuration
- **Templates**: Built-in templates are immutable; custom templates can be created/deleted by their creator; template selector is shown before stream creation form

## API Endpoints

### Streams CRUD
- `GET /api/streams/configs` - List configs with optional filters (?type=, &enabled=, &limit=, &offset=)
- `GET /api/streams/configs/:id` - Get single config
- `POST /api/streams` - Create config (starts container if enabled=true)
- `PUT /api/streams/:id` - Update config
- `DELETE /api/streams/:id` - Delete config and remove container
- `POST /api/streams/:id/deploy` - Deploy config as new container (removes existing first)

### Templates
- `GET /api/templates` - List templates with filters (?category=, &builtIn=, &limit=, &offset=)
- `GET /api/templates/:id` - Get single template
- `POST /api/templates` - Create custom template
- `POST /api/templates/from-stream/:streamId` - Create template from existing stream config
- `PUT /api/templates/:id` - Update custom template
- `DELETE /api/templates/:id` - Delete custom template
- `POST /api/templates/:id/apply` - Apply template (merge with name/url/ingest to get full config)
