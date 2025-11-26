# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: COMPLETE
**Phase 2 (Control Actions)**: COMPLETE
**Phase 3 (CRUD Operations)**: IN PROGRESS (Steps 3.1-3.6 complete)

## Completed in This Iteration
- **Step 3.6**: Templates system
  - Created database migration for `templates` table (007_templates)
  - Created `src/server/config/templates.ts` with CRUD operations and 7 built-in templates
  - Created `src/server/routes/templates.ts` with capability-gated API routes
  - Created `src/client/hooks/useTemplates.ts` for React Query hooks
  - Created `src/client/components/TemplateSelector.tsx` with category filtering and preview
  - Updated `CreateStream.tsx` to show template selector first, then form
  - Added CSS styles for template selector UI
  - Tests: 516 total tests passing (44 new tests for templates)

## Next Steps
**Phase 3 (CRUD Operations)** - Consider completing:
1. "Save as Template" button on EditStream page (API route exists: `POST /api/templates/from-stream/:streamId`)

**Phase 4 (Optional enhancements)**:
- User management (list users, view activity)
- Batch operations on streams
- Dashboard widgets/stats

## How to Run
```bash
cd stream-manager

# Development
npm test           # Run all tests (516 passing)
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

## Files Added This Iteration
- `src/server/config/templates.ts` - Template storage with CRUD operations and built-in templates
- `src/server/routes/templates.ts` - Express routes for template API
- `src/client/hooks/useTemplates.ts` - React Query hooks for template operations
- `src/client/components/TemplateSelector.tsx` - Template selection UI with category filter and preview
- `tests/server/config/templates.test.ts` - Unit tests for template storage
- `tests/server/routes/templates.test.ts` - Route tests for template API
