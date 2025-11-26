# Stream Manager

Web-based control plane for the page-stream system. Provides a real-time dashboard to monitor and manage page-stream containers.

## Quick Start

### Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Start development servers (in separate terminals)
npm run dev        # Backend server on port 3001
npm run dev:client # Vite dev server on port 3000 (with HMR)

# Or build and run production
npm run build
npm start
```

### Docker

```bash
# Build the image
docker build -t stream-manager:latest .

# Run standalone
docker run -d \
  --name stream-manager \
  -p 3001:3001 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v stream-manager-data:/data \
  stream-manager:latest

# Or use docker-compose
docker-compose up -d
```

### With page-stream Services

```bash
# From the parent page-stream directory
docker-compose -f docker-compose.stable.yml -f stream-manager/docker-compose.yml up -d
```

## Features

- **Real-time Dashboard**: View all page-stream containers with live status updates
- **Health Monitoring**: Parse and display health status from container logs
- **Log Viewing**: Stream and filter container logs in real-time
- **WebSocket Updates**: Live updates without polling
- **Role-Based Access Control**: Flexible auth with proxy header support
- **Dark Theme**: Terminal-aesthetic UI with responsive layout

## API Endpoints

### Health Check
```
GET /api/health
```
Returns: `{ status: 'ok', authMode: 'none' | 'proxy' }`

### Authentication
```
GET /api/auth/me
```
Returns current user info and capabilities.

### Streams
```
GET /api/streams                    # List all page-stream containers
GET /api/streams/:id                # Get container details
GET /api/streams/:id/logs           # Get container logs
GET /api/streams/:id/health/history # Get health history
```

### WebSocket
```
ws://localhost:3001
```
Real-time updates for container status, health, and logs.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `NODE_ENV` | - | Set to `production` for prod mode |
| `DATABASE_PATH` | `./data/stream-manager.db` | SQLite database location |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker socket path |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origin |
| `LOG_LEVEL` | `info` | Log verbosity |

### Authentication Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_MODE` | `none` | `none` (open mode) or `proxy` (trust headers) |
| `AUTH_HEADER_USER` | `x-forwarded-user` | Header containing user ID |
| `AUTH_HEADER_EMAIL` | `x-forwarded-email` | Header containing email |
| `AUTH_HEADER_GROUPS` | `x-forwarded-groups` | Header containing groups (comma-separated) |
| `AUTH_HEADER_NAME` | `x-forwarded-preferred-username` | Header containing display name |
| `AUTH_GROUP_ROLES` | `{}` | JSON mapping groups to roles |
| `AUTH_DEFAULT_ROLE` | `viewer` | Default role for authenticated users |
| `AUTH_ANONYMOUS_ROLE` | `null` | Role for anonymous users (null = deny) |

## Authentication Modes

### Open Mode (Default)

With `AUTH_MODE=none`, everyone gets admin access. Suitable for:
- Local development
- Trusted internal networks
- Quick testing

### Proxy Mode

With `AUTH_MODE=proxy`, the manager trusts authentication headers from a reverse proxy. This works with:
- oauth2-proxy
- Azure EasyAuth / App Service Authentication
- nginx auth_request
- Traefik Forward Auth

Example configuration:
```bash
AUTH_MODE=proxy
AUTH_GROUP_ROLES='{"admins":["admin"],"operators":["operator"],"viewers":["viewer"]}'
AUTH_DEFAULT_ROLE=viewer
AUTH_ANONYMOUS_ROLE=  # Empty = reject anonymous
```

### Roles and Capabilities

| Role | Capabilities |
|------|-------------|
| `viewer` | View streams, logs, health |
| `operator` | Viewer + start/stop/restart streams |
| `editor` | Operator + create/update streams |
| `admin` | Full access including user management |

## Monitoring & Metrics

Stream Manager exposes Prometheus metrics at `/metrics` for monitoring.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `METRICS_ENABLED` | `true` | Enable/disable metrics endpoint |
| `METRICS_API_KEY` | - | Optional API key for metrics authentication |
| `METRICS_INCLUDE_USER_REQUESTS` | `false` | Include per-user request counts |

### Grafana Dashboard

A pre-built Grafana dashboard is available at `grafana/dashboards/stream-manager.json`. See **[Monitoring with Grafana](docs/monitoring-grafana.md)** for setup instructions.

### Prometheus Configuration

```yaml
scrape_configs:
  - job_name: 'stream-manager'
    static_configs:
      - targets: ['stream-manager:3001']
    metrics_path: '/metrics'
```

## Auth Proxy Integration

Stream Manager integrates with common authentication proxies. See the detailed guides:

- **[OAuth2 Proxy](docs/auth-oauth2-proxy.md)** - Google, Azure AD, Keycloak, Okta, generic OIDC
- **[Azure EasyAuth](docs/auth-azure-easyauth.md)** - Azure App Service, Azure Container Apps
- **[nginx auth_request](docs/auth-nginx.md)** - LDAP, Vouch Proxy, custom auth services

### Quick Examples

**oauth2-proxy:**
```yaml
services:
  oauth2-proxy:
    image: quay.io/oauth2-proxy/oauth2-proxy:v7.5.1
    environment:
      OAUTH2_PROXY_PROVIDER: oidc
      OAUTH2_PROXY_UPSTREAMS: http://stream-manager:3001
      OAUTH2_PROXY_SET_XAUTHREQUEST: "true"

  stream-manager:
    environment:
      AUTH_MODE: proxy
      AUTH_GROUP_ROLES: '{"admins":["admin"]}'
```

**Azure EasyAuth:**
```bash
AUTH_MODE=proxy
# Azure headers are auto-detected
```

**nginx auth_request:**
```nginx
location / {
    auth_request /auth;
    auth_request_set $user $upstream_http_x_auth_user;
    proxy_set_header X-Remote-User $user;
    proxy_pass http://stream-manager:3001;
}
```

## Development

### Project Structure

```
stream-manager/
├── src/
│   ├── server/           # Backend (Express + WebSocket)
│   │   ├── auth/         # Authentication & RBAC
│   │   ├── db/           # SQLite database
│   │   ├── routes/       # REST API routes
│   │   ├── docker.ts     # Docker API client
│   │   ├── websocket.ts  # WebSocket server
│   │   └── index.ts      # Server entry point
│   └── client/           # Frontend (React)
│       ├── components/   # UI components
│       ├── contexts/     # React contexts
│       ├── hooks/        # Custom hooks
│       └── App.tsx       # Main app
├── tests/                # Test files
├── Dockerfile            # Production image
└── docker-compose.yml    # Docker Compose config
```

### Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
npm run typecheck     # TypeScript check
```

### Building

```bash
npm run build         # Build both server and client
npm run build:server  # Build server only
npm run build:client  # Build client only
```

## Container Detection

The manager detects page-stream containers by:
1. Image name containing `page-stream`
2. Label `com.page-stream.managed=true`

To add labels to existing services in docker-compose:
```yaml
services:
  my-stream:
    image: page-stream:latest
    labels:
      - "com.page-stream.managed=true"
      - "com.page-stream.type=standard"
```

## License

See the main page-stream repository for license information.
