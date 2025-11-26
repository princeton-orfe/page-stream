# nginx Auth Integration

This guide covers integrating Stream Manager with nginx using `auth_request` for authentication.

## Overview

nginx's `auth_request` module enables subrequest-based authentication. nginx makes a subrequest to an authentication service before proxying to Stream Manager. User identity is passed via HTTP headers.

This approach works with:
- LDAP authentication (via ldap-auth daemon)
- Custom authentication services
- OAuth/OIDC providers (via Vouch Proxy or similar)
- Basic authentication with header forwarding

## Architecture

```
┌──────────┐      ┌──────────────┐      ┌──────────────────┐
│  Browser │─────▶│    nginx     │─────▶│  Stream Manager  │
└──────────┘      │              │      │  (port 3001)     │
                  │   ┌──────┐   │      └──────────────────┘
                  │   │ auth │   │
                  │   │ svc  │   │
                  │   └──────┘   │
                  └──────────────┘

                  nginx sets:            Stream Manager reads:
                  X-Remote-User          X-Remote-User
                  X-Remote-Email         X-Remote-Email
                  X-Remote-Groups        X-Remote-Groups
```

## Quick Start: Basic Auth with Header Forwarding

### 1. nginx Configuration

```nginx
# /etc/nginx/conf.d/stream-manager.conf

# Upstream for Stream Manager
upstream stream-manager {
    server stream-manager:3001;
    keepalive 32;
}

# Authentication service (returns 200 if authenticated)
upstream auth-service {
    server auth-service:8080;
}

server {
    listen 443 ssl http2;
    server_name streams.yourdomain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # Auth request endpoint
    location = /auth {
        internal;
        proxy_pass http://auth-service/verify;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header X-Original-URI $request_uri;
        proxy_set_header X-Original-Method $request_method;
    }

    # Main application
    location / {
        # Require authentication
        auth_request /auth;

        # Capture auth response headers
        auth_request_set $auth_user $upstream_http_x_auth_user;
        auth_request_set $auth_email $upstream_http_x_auth_email;
        auth_request_set $auth_groups $upstream_http_x_auth_groups;

        # Forward user identity to Stream Manager
        proxy_set_header X-Remote-User $auth_user;
        proxy_set_header X-Remote-Email $auth_email;
        proxy_set_header X-Remote-Groups $auth_groups;

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;

        proxy_pass http://stream-manager;
    }

    # WebSocket endpoint (same auth)
    location /ws {
        auth_request /auth;
        auth_request_set $auth_user $upstream_http_x_auth_user;

        proxy_set_header X-Remote-User $auth_user;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;

        proxy_pass http://stream-manager;
    }
}
```

### 2. Stream Manager Configuration

```yaml
# docker-compose.yml
services:
  stream-manager:
    image: stream-manager:latest
    expose:
      - "3001"
    environment:
      AUTH_MODE: proxy
      AUTH_HEADER_USER: x-remote-user
      AUTH_HEADER_EMAIL: x-remote-email
      AUTH_HEADER_GROUPS: x-remote-groups
      AUTH_GROUP_ROLES: '{"admins":["admin"],"operators":["operator"]}'
      AUTH_DEFAULT_ROLE: viewer
      AUTH_TRUSTED_PROXIES: "172.16.0.0/12,10.0.0.0/8"
```

## LDAP Authentication

### ldap-auth Daemon Setup

Use nginx's ldap-auth daemon or a compatible service:

```yaml
# docker-compose.yml
services:
  nginx:
    image: nginx:latest
    ports:
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - stream-manager
      - ldap-auth

  ldap-auth:
    image: nginxinc/nginx-ldap-auth:latest
    environment:
      LDAP_URI: ldap://ldap.example.com
      LDAP_BASE_DN: dc=example,dc=com
      LDAP_BIND_DN: cn=service,dc=example,dc=com
      LDAP_BIND_PASSWORD: ${LDAP_PASSWORD}
      LDAP_USER_ATTR: uid
      LDAP_GROUP_ATTR: memberOf
    expose:
      - "8888"

  stream-manager:
    image: stream-manager:latest
    expose:
      - "3001"
    environment:
      AUTH_MODE: proxy
      AUTH_GROUP_ROLES: '{"cn=admins,ou=groups,dc=example,dc=com":["admin"]}'
```

### nginx Configuration for LDAP

```nginx
# LDAP auth endpoint
location = /auth {
    internal;
    proxy_pass http://ldap-auth:8888;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header X-Original-URI $request_uri;

    # Pass credentials
    proxy_set_header X-Ldap-URL "ldap://ldap.example.com";
    proxy_set_header X-Ldap-BaseDN "dc=example,dc=com";
    proxy_set_header X-Ldap-BindDN "cn=service,dc=example,dc=com";
    proxy_set_header X-Ldap-BindPass "secret";
}
```

## Vouch Proxy (OAuth/OIDC)

For OAuth/OIDC authentication through nginx:

### Vouch Proxy Configuration

```yaml
# docker-compose.yml
services:
  vouch:
    image: quay.io/vouch/vouch-proxy:latest
    ports:
      - "9090:9090"
    volumes:
      - ./vouch-config.yml:/config/config.yml:ro
    environment:
      VOUCH_PORT: 9090

  nginx:
    image: nginx:latest
    # ... nginx configuration
```

```yaml
# vouch-config.yml
vouch:
  listen: 0.0.0.0
  port: 9090
  domains:
    - yourdomain.com
  cookie:
    secure: true
    domain: yourdomain.com
    name: VouchCookie

oauth:
  provider: oidc
  client_id: stream-manager
  client_secret: ${OAUTH_SECRET}
  auth_url: https://idp.example.com/authorize
  token_url: https://idp.example.com/token
  user_info_url: https://idp.example.com/userinfo
  scopes:
    - openid
    - email
    - profile
    - groups
  callback_url: https://streams.yourdomain.com/auth/callback

headers:
  user: X-Vouch-User
  email: X-Vouch-User-Email
  groups: X-Vouch-User-Groups
```

### nginx Configuration for Vouch

```nginx
server {
    listen 443 ssl http2;
    server_name streams.yourdomain.com;

    # Vouch auth endpoint
    location = /validate {
        internal;
        proxy_pass http://vouch:9090/validate;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Auth response headers
        auth_request_set $auth_resp_x_vouch_user $upstream_http_x_vouch_user;
        auth_request_set $auth_resp_x_vouch_user_email $upstream_http_x_vouch_user_email;
        auth_request_set $auth_resp_x_vouch_user_groups $upstream_http_x_vouch_user_groups;
    }

    # Vouch login/callback
    location /auth {
        proxy_pass http://vouch:9090;
        proxy_set_header Host $host;
    }

    # Protected application
    location / {
        auth_request /validate;

        # Capture and forward user info
        auth_request_set $auth_user $upstream_http_x_vouch_user;
        auth_request_set $auth_email $upstream_http_x_vouch_user_email;
        auth_request_set $auth_groups $upstream_http_x_vouch_user_groups;

        proxy_set_header X-Remote-User $auth_user;
        proxy_set_header X-Remote-Email $auth_email;
        proxy_set_header X-Remote-Groups $auth_groups;

        # Redirect to login if not authenticated
        error_page 401 = @error401;

        proxy_pass http://stream-manager;
    }

    location @error401 {
        return 302 https://streams.yourdomain.com/auth/login?url=$scheme://$http_host$request_uri;
    }
}
```

## Basic Authentication with htpasswd

For simple deployments without an external auth service:

```nginx
server {
    listen 443 ssl;
    server_name streams.yourdomain.com;

    # Basic auth
    auth_basic "Stream Manager";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        # Forward authenticated username
        proxy_set_header X-Remote-User $remote_user;

        proxy_pass http://stream-manager:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Generate htpasswd file:

```bash
# Create htpasswd file
htpasswd -c /etc/nginx/.htpasswd admin

# Add additional users
htpasswd /etc/nginx/.htpasswd operator
```

Stream Manager configuration:

```yaml
AUTH_MODE: proxy
AUTH_HEADER_USER: x-remote-user
# No groups with basic auth - use default role
AUTH_DEFAULT_ROLE: admin  # Or map specific usernames
```

## Full Docker Compose Example

```yaml
# docker-compose.yml
version: '3.8'

services:
  nginx:
    image: nginx:latest
    container_name: nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - stream-manager
      - auth-service
    restart: unless-stopped

  auth-service:
    # Your authentication service
    # Could be: ldap-auth, vouch-proxy, custom service
    image: your-auth-service:latest
    expose:
      - "8080"
    environment:
      # Auth service configuration
      AUTH_BACKEND: ldap
      LDAP_URL: ldap://ldap.example.com
    restart: unless-stopped

  stream-manager:
    image: stream-manager:latest
    container_name: stream-manager
    expose:
      - "3001"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - stream-manager-data:/data
    environment:
      PORT: "3001"
      NODE_ENV: production

      # Authentication
      AUTH_MODE: proxy
      AUTH_HEADER_USER: x-remote-user
      AUTH_HEADER_EMAIL: x-remote-email
      AUTH_HEADER_GROUPS: x-remote-groups

      # Role mapping
      AUTH_GROUP_ROLES: |
        {
          "cn=stream-admins,ou=groups,dc=example,dc=com": ["admin"],
          "cn=operators,ou=groups,dc=example,dc=com": ["operator"],
          "cn=developers,ou=groups,dc=example,dc=com": ["editor"]
        }
      AUTH_DEFAULT_ROLE: viewer

      # Trust nginx IP
      AUTH_TRUSTED_PROXIES: "172.16.0.0/12"

      # Security
      RATE_LIMIT_ENABLED: "true"
      SECURITY_LOGGING: "true"
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped

volumes:
  stream-manager-data:

networks:
  default:
    name: stream-manager-network
```

## Security Considerations

### Header Spoofing Protection

Stream Manager validates that requests come from trusted proxy IPs before accepting auth headers:

```yaml
# Only accept auth headers from these IP ranges
AUTH_TRUSTED_PROXIES: "172.16.0.0/12,10.0.0.0/8"
```

Without this, users could spoof headers to impersonate others.

### Network Isolation

Never expose Stream Manager directly:

```yaml
stream-manager:
  expose:
    - "3001"     # Internal only
  # NOT: ports: - "3001:3001"
```

### nginx Security Headers

Add security headers in nginx:

```nginx
server {
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Remove nginx version
    server_tokens off;

    # ... rest of config
}
```

### Rate Limiting in nginx

Add rate limiting at the nginx level:

```nginx
# Define rate limit zone
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

server {
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        # ... proxy config
    }
}
```

## Troubleshooting

### 401 Unauthorized

Check auth service is responding:

```bash
# Test auth endpoint directly
curl -v http://localhost:8080/verify
```

### Headers Not Forwarded

Verify nginx is setting headers:

```bash
# Add debug logging
log_format auth '$remote_addr - $remote_user [$time_local] '
                '"$request" $status '
                'auth_user=$auth_user auth_groups=$auth_groups';

access_log /var/log/nginx/access.log auth;
```

### WebSocket Connection Fails

Ensure WebSocket upgrade headers are forwarded:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 86400;
```

### Debugging auth_request

```nginx
# Log auth subrequest results
location = /auth {
    internal;
    proxy_pass http://auth-service:8080/verify;

    # Log response status
    access_log /var/log/nginx/auth.log;
}
```

### Test Configuration

```bash
# Validate nginx config
nginx -t

# Reload configuration
nginx -s reload

# Check error logs
tail -f /var/log/nginx/error.log
```

## Custom Authentication Service

Build a simple auth service that nginx can query:

```python
# auth_service.py
from flask import Flask, request, Response

app = Flask(__name__)

USERS = {
    "admin": {"password": "secret", "groups": ["admins"]},
    "operator": {"password": "secret", "groups": ["operators"]},
}

@app.route("/verify")
def verify():
    auth = request.authorization
    if not auth:
        return Response(status=401)

    user = USERS.get(auth.username)
    if not user or user["password"] != auth.password:
        return Response(status=401)

    resp = Response(status=200)
    resp.headers["X-Auth-User"] = auth.username
    resp.headers["X-Auth-Groups"] = ",".join(user["groups"])
    return resp

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
```

## Related Documentation

- [nginx auth_request Module](https://nginx.org/en/docs/http/ngx_http_auth_request_module.html)
- [Vouch Proxy](https://github.com/vouch/vouch-proxy)
- [nginx LDAP Auth](https://github.com/nginxinc/nginx-ldap-auth)
- [Stream Manager README](../README.md)
- [OAuth2 Proxy Integration](auth-oauth2-proxy.md)
- [Azure EasyAuth Integration](auth-azure-easyauth.md)
