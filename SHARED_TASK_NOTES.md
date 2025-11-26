# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: COMPLETE
**Phase 2 (Control Actions)**: COMPLETE
**Phase 3 (CRUD Operations)**: COMPLETE
**Phase 4.5 (User Management UI)**: COMPLETE
**Phase 4.1 (Compositor Management)**: COMPLETE
**Phase 4.2 (Stream Groups)**: COMPLETE
**Phase 4.3 (Scheduling System)**: COMPLETE

## Completed in This Iteration
- **Scheduling System**: Full implementation of cron-based scheduling
  - `src/server/schedules/schema.ts` - Schedule interfaces and validation
  - `src/server/schedules/storage.ts` - CRUD operations for schedules
  - `src/server/schedules/scheduler.ts` - Background scheduler service
  - `src/server/routes/schedules.ts` - API endpoints
  - `src/client/hooks/useSchedules.ts` - React Query hooks
  - `src/client/components/ScheduleForm.tsx` - Form with cron presets
  - `src/client/pages/Schedules.tsx` - List page with controls
  - `src/client/pages/CreateSchedule.tsx` & `EditSchedule.tsx`
  - Navigation in App.tsx with capability-gated "Schedules" button
  - 57 new tests (39 backend + 18 frontend)
  - Total tests: 663 passing (23 skipped)

## Next Steps (in priority order)
1. **Phase 4 (Remaining optional enhancements)**:
   - Monitoring and alerts (Step 4.4)
   - Metrics export (Step 4.6)
   - Production hardening (Step 4.7)
   - Auth proxy integration examples (Step 4.8)

## How to Run
```bash
cd stream-manager

# Development
npm test           # Run all tests (663 passing)
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

### Schedules (NEW)
- `GET /api/schedules` - List schedules with filters (?enabled=, &targetType=, &targetId=, &limit=, &offset=)
- `GET /api/schedules/:id` - Get single schedule
- `GET /api/schedules/timezones` - Get list of common timezones
- `GET /api/schedules/status` - Get scheduler service status
- `GET /api/schedules/by-target/:targetType/:targetId` - Get schedules for a target
- `POST /api/schedules` - Create schedule
- `PUT /api/schedules/:id` - Update schedule
- `DELETE /api/schedules/:id` - Delete schedule
- `POST /api/schedules/:id/trigger` - Manually trigger schedule
- `POST /api/schedules/:id/enable` - Enable schedule
- `POST /api/schedules/:id/disable` - Disable schedule
- `POST /api/schedules/:id/duplicate` - Duplicate schedule
- `POST /api/schedules/preview-next-run` - Preview next run time for cron expression

### Stream Groups
- `GET /api/groups` - List groups with filters
- `GET /api/groups/:id` - Get single group with stream statuses
- `POST /api/groups` - Create group
- `PUT /api/groups/:id` - Update group
- `DELETE /api/groups/:id` - Delete group
- `POST /api/groups/:id/start` - Start all streams in group
- `POST /api/groups/:id/stop` - Stop all streams in group
- `POST /api/groups/:id/restart` - Restart all streams in group

### Compositors
- `GET /api/compositors` - List compositors
- `GET /api/compositors/:id` - Get single compositor
- `POST /api/compositors` - Create compositor
- `PUT /api/compositors/:id` - Update compositor
- `DELETE /api/compositors/:id` - Delete compositor
- `POST /api/compositors/:id/start|stop|restart|deploy` - Control actions

### Auth/Users
- `GET /api/auth/me` - Get current user
- `GET /api/auth/users` - List all users
- `GET /api/auth/roles` - List all roles
- `PUT /api/auth/users/:id/roles` - Update user roles

## Key Technical Decisions
- **Scheduling**: Uses cron-parser v4 for expression validation and next-run calculation
- **Scheduler Service**: Polls every 10 seconds for due schedules
- **Target Types**: Schedules can target streams, groups, or compositors
- **Actions**: start, stop, refresh (refresh only for streams)
- **Timezone Support**: Full IANA timezone support via Intl API
- **System User**: Scheduled executions logged as "scheduler" system user
- **Capabilities**: Uses `schedules:*` capabilities from RBAC system
