# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: COMPLETE
**Phase 2 (Control Actions)**: COMPLETE
**Phase 3 (CRUD Operations)**: COMPLETE
**Phase 4.5 (User Management UI)**: COMPLETE

## Completed in This Iteration
- **User Management UI**: Added admin page for viewing and managing users
  - Lists all users with their roles, email, first/last seen timestamps
  - Role editor with checkbox interface for assigning/removing roles
  - Roles legend showing available roles and descriptions
  - Capability-gated (`users:list` to view, `users:manage` to edit roles)
  - New endpoint: `GET /api/auth/roles` to fetch available roles
  - 12 new tests added (10 client, 2 server)
  - Total tests: 532 passing

## Next Steps
**Phase 4 (Remaining optional enhancements)**:
- Compositor management (Step 4.1)
- Stream groups and dependencies (Step 4.2)
- Scheduling system (Step 4.3)
- Monitoring and alerts (Step 4.4)
- Metrics export (Step 4.6)
- Production hardening (Step 4.7)
- Auth proxy integration examples (Step 4.8)

## How to Run
```bash
cd stream-manager

# Development
npm test           # Run all tests (532 passing)
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
- **User Management**: Users page shows all users who have accessed the system; roles can be assigned via checkbox interface

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

### Auth/Users
- `GET /api/auth/me` - Get current user info and capabilities
- `GET /api/auth/capabilities` - Get capabilities with helper booleans
- `GET /api/auth/users` - List all users (requires `users:list`)
- `GET /api/auth/roles` - List all roles (requires `users:list`)
- `PUT /api/auth/users/:id/roles` - Update user roles (requires `users:manage`)
