# Stream Manager Implementation - Task Notes

## Current Status
**Phase 1 (Read-Only Dashboard)**: COMPLETE
**Phase 2 (Control Actions)**: COMPLETE
**Phase 3 (CRUD Operations)**: COMPLETE
**Phase 4.5 (User Management UI)**: COMPLETE
**Phase 4.1 (Compositor Management)**: COMPLETE
**Phase 4.2 (Stream Groups)**: COMPLETE
**Phase 4.3 (Scheduling System)**: COMPLETE
**Phase 4.4 (Monitoring and Alerts)**: IN PROGRESS (needs tests)

## Completed in This Iteration
- **Alert System**: Full implementation of monitoring and alerting
  - `src/server/alerts/schema.ts` - Alert interfaces and validation
  - `src/server/alerts/storage.ts` - CRUD operations for rules and events
  - `src/server/alerts/evaluator.ts` - Background evaluator service (polls every 30s)
  - `src/server/alerts/notifications.ts` - Webhook and email notifications
  - `src/server/routes/alerts.ts` - API endpoints
  - `src/client/hooks/useAlerts.ts` - React Query hooks
  - `src/client/components/AlertForm.tsx` - Form for creating/editing rules
  - `src/client/pages/Alerts.tsx` - Rules and events list with tabs
  - `src/client/pages/CreateAlert.tsx` & `EditAlert.tsx`
  - Navigation in App.tsx with capability-gated "Alerts" button
  - Database migrations: `011_alert_rules` and `012_alert_events`

## Next Steps (in priority order)
1. **Write tests for alerts backend** (schema, storage, routes, evaluator)
2. **Write tests for alerts frontend** (components)
3. **Phase 4 (Remaining optional enhancements)**:
   - Metrics export (Step 4.6)
   - Production hardening (Step 4.7)
   - Auth proxy integration examples (Step 4.8)

## How to Run
```bash
cd stream-manager

# Development
npm test           # Run all tests
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

### Alerts (NEW)
- `GET /api/alerts/rules` - List alert rules with filters
- `GET /api/alerts/rules/:id` - Get single rule
- `GET /api/alerts/rules/by-target/:targetType/:targetId` - Get rules for target
- `POST /api/alerts/rules` - Create rule
- `PUT /api/alerts/rules/:id` - Update rule
- `DELETE /api/alerts/rules/:id` - Delete rule
- `POST /api/alerts/rules/:id/enable` - Enable rule
- `POST /api/alerts/rules/:id/disable` - Disable rule
- `POST /api/alerts/rules/:id/test` - Test notifications
- `GET /api/alerts/events` - List events with filters
- `GET /api/alerts/events/active` - Get unresolved events
- `GET /api/alerts/events/count` - Get unacknowledged count
- `GET /api/alerts/events/:id` - Get single event
- `POST /api/alerts/events/:id/acknowledge` - Acknowledge event
- `POST /api/alerts/events/acknowledge-all` - Acknowledge all events
- `GET /api/alerts/status` - Get evaluator status

### Schedules
- `GET /api/schedules` - List schedules with filters
- `GET /api/schedules/:id` - Get single schedule
- (see full list in previous iteration)

## Key Technical Decisions
- **Alert Evaluator**: Polls containers every 30 seconds
- **Condition Types**: status_changed, status_is, health_unhealthy, restart_count, offline_duration, schedule_failed
- **Severities**: info, warning, critical
- **Notifications**: Webhook (HTTP POST/PUT) and Email (requires SMTP config)
- **Cooldown**: Configurable per-rule to prevent notification spam
- **Auto-resolve**: Events automatically resolved when condition clears
- **Target Types**: Can target specific stream/compositor or all of a type ('any')
- **Capabilities**: Uses `alerts:*` capabilities from RBAC system
