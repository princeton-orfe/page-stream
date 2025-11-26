# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: COMPLETE
**Phase 2 (Control Actions)**: COMPLETE
**Phase 3 (CRUD Operations)**: COMPLETE
**Phase 4.5 (User Management UI)**: COMPLETE
**Phase 4.1 (Compositor Management)**: COMPLETE

## Completed in This Iteration
- **Compositor Management**: Full CRUD and control for FFmpeg compositors
  - Schema with 5 layout types: side-by-side, stacked, grid, pip, custom
  - Database migration for `compositors` table
  - Storage functions (create, read, update, delete, duplicate)
  - API routes with capability-gated access (`compositors:*`)
  - FFmpeg filter_complex generation for each layout type
  - Container management (create, start, stop, restart, deploy)
  - Frontend: Compositors page with list, controls, delete confirmation
  - Client hooks: `useCompositors`, `useCompositorControl`
  - 27 new tests for schema validation and filter generation
  - Total tests: 559 passing

## Next Steps
**Phase 4 (Remaining optional enhancements)**:
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
npm test           # Run all tests (559 passing)
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

## API Endpoints

### Compositors (NEW)
- `GET /api/compositors` - List compositors with filters (?enabled=, &limit=, &offset=)
- `GET /api/compositors/:id` - Get single compositor with container status
- `GET /api/compositors/:id/logs` - Get compositor container logs
- `GET /api/compositors/:id/preview` - Preview generated FFmpeg command
- `POST /api/compositors` - Create compositor (starts container if enabled=true)
- `PUT /api/compositors/:id` - Update compositor config
- `DELETE /api/compositors/:id` - Delete compositor and remove container
- `POST /api/compositors/:id/start` - Start compositor container
- `POST /api/compositors/:id/stop` - Stop compositor container
- `POST /api/compositors/:id/restart` - Restart compositor container
- `POST /api/compositors/:id/deploy` - Redeploy compositor (recreate container)

### Streams CRUD
- `GET /api/streams/configs` - List configs with optional filters
- `GET /api/streams/configs/:id` - Get single config
- `POST /api/streams` - Create config (starts container if enabled=true)
- `PUT /api/streams/:id` - Update config
- `DELETE /api/streams/:id` - Delete config and remove container
- `POST /api/streams/:id/deploy` - Deploy config as new container

### Templates
- `GET /api/templates` - List templates with filters
- `GET /api/templates/:id` - Get single template
- `POST /api/templates` - Create custom template
- `POST /api/templates/from-stream/:streamId` - Create from stream config
- `PUT /api/templates/:id` - Update custom template
- `DELETE /api/templates/:id` - Delete custom template
- `POST /api/templates/:id/apply` - Apply template

### Auth/Users
- `GET /api/auth/me` - Get current user info and capabilities
- `GET /api/auth/capabilities` - Get capabilities with helper booleans
- `GET /api/auth/users` - List all users (requires `users:list`)
- `GET /api/auth/roles` - List all roles (requires `users:list`)
- `PUT /api/auth/users/:id/roles` - Update user roles (requires `users:manage`)

## Key Decisions Made
- **Compositor Image**: Uses `jrottenberg/ffmpeg:4.4-ubuntu` for FFmpeg containers
- **Compositor Ports**: Listen ports must be in range 10001-10999
- **Layout Types**: side-by-side, stacked, grid (2-4 inputs), pip, custom
- **Custom Layouts**: Require explicit `customFilterComplex` FFmpeg filter string
- **PIP Config**: Requires `pipConfig` with mainInput, pipInput, position, scale, margin
- **Container Label**: Compositors labeled with `com.page-stream.compositor=true`
