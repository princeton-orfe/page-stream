# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: COMPLETE
**Phase 2 (Control Actions)**: COMPLETE
**Phase 3 (CRUD Operations)**: COMPLETE
**Phase 4.5 (User Management UI)**: COMPLETE
**Phase 4.1 (Compositor Management)**: COMPLETE
**Phase 4.2 (Stream Groups)**: COMPLETE

## Completed in This Iteration
- **Stream Groups Frontend UI**: Full CRUD and control UI for stream groups
  - `StreamGroups` page with list view, status badges, control buttons
  - `StreamGroupForm` component for create/edit with member selection
  - `CreateStreamGroup` and `EditStreamGroup` page components
  - `useStreamGroups` hook for list/single/create/update/delete
  - `useStreamGroupControl` hook for start/stop/restart
  - Navigation in App.tsx with capability-gated "Groups" button
  - 10 new tests for StreamGroups page component
  - Total tests: 606 passing (23 skipped)

## Next Steps (in priority order)
1. **Phase 4 (Remaining optional enhancements)**:
   - Scheduling system (Step 4.3)
   - Monitoring and alerts (Step 4.4)
   - Metrics export (Step 4.6)
   - Production hardening (Step 4.7)
   - Auth proxy integration examples (Step 4.8)

## How to Run
```bash
cd stream-manager

# Development
npm test           # Run all tests (606 passing)
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

## Frontend Files Added
- `src/client/types.ts` - Added StreamGroup, GroupMember types
- `src/client/hooks/useStreamGroups.ts` - Hooks for groups API
- `src/client/components/StreamGroupForm.tsx` - Form component
- `src/client/pages/StreamGroups.tsx` - List page
- `src/client/pages/CreateStreamGroup.tsx` - Create page
- `src/client/pages/EditStreamGroup.tsx` - Edit page
- `src/client/App.tsx` - Added Groups navigation and views

## API Endpoints

### Stream Groups
- `GET /api/groups` - List groups with filters (?enabled=, &limit=, &offset=)
- `GET /api/groups/:id` - Get single group with stream statuses
- `GET /api/groups/by-stream/:streamId` - Find groups containing a stream
- `POST /api/groups` - Create group
- `PUT /api/groups/:id` - Update group
- `DELETE /api/groups/:id` - Delete group
- `POST /api/groups/:id/start` - Start all streams in group (respects startOrder)
- `POST /api/groups/:id/stop` - Stop all streams in group (respects stopOrder)
- `POST /api/groups/:id/restart` - Restart all streams in group

### Compositors
- `GET /api/compositors` - List compositors with filters
- `GET /api/compositors/:id` - Get single compositor with container status
- `GET /api/compositors/:id/logs` - Get compositor container logs
- `GET /api/compositors/:id/preview` - Preview generated FFmpeg command
- `POST /api/compositors` - Create compositor
- `PUT /api/compositors/:id` - Update compositor config
- `DELETE /api/compositors/:id` - Delete compositor and remove container
- `POST /api/compositors/:id/start` - Start compositor container
- `POST /api/compositors/:id/stop` - Stop compositor container
- `POST /api/compositors/:id/restart` - Restart compositor container
- `POST /api/compositors/:id/deploy` - Redeploy compositor

### Streams CRUD
- `GET /api/streams/configs` - List configs with optional filters
- `GET /api/streams/configs/:id` - Get single config
- `POST /api/streams` - Create config
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
- **Stream Groups**: Groups hold references to stream IDs, not embedded configs
- **Ordering**: `startOrder` can be parallel/sequential; `stopOrder` can be parallel/sequential/reverse
- **Delays**: Default delays are 1000ms, per-member delays override group default
- **Rate Limiting**: 5 second cooldown on group start/stop/restart actions
- **Capabilities**: Uses existing `groups:*` capabilities from RBAC system
