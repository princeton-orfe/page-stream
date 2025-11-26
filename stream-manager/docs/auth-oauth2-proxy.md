# OAuth2 Proxy Integration

This guide covers integrating Stream Manager with [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) for authentication.

## Overview

oauth2-proxy is a reverse proxy that provides authentication using OpenID Connect (OIDC) providers like:
- Google
- Azure AD / Entra ID
- Keycloak
- Okta
- GitHub
- GitLab

The proxy sits in front of Stream Manager and handles authentication, passing user identity via HTTP headers.

## Architecture

```
┌──────────┐      ┌──────────────┐      ┌──────────────────┐
│  Browser │─────▶│ oauth2-proxy │─────▶│  Stream Manager  │
└──────────┘      │ (port 4180)  │      │  (port 3001)     │
                  └──────────────┘      └──────────────────┘

                  Sets headers:          Reads headers:
                  X-Forwarded-User       X-Forwarded-User
                  X-Forwarded-Email      X-Forwarded-Email
                  X-Forwarded-Groups     X-Forwarded-Groups
```

## Quick Start

### 1. Docker Compose Setup

Create a `docker-compose.oauth2.yml`:

```yaml
services:
  oauth2-proxy:
    image: quay.io/oauth2-proxy/oauth2-proxy:v7.5.1
    container_name: oauth2-proxy
    ports:
      - "4180:4180"
    environment:
      # Provider configuration (example: Google)
      OAUTH2_PROXY_PROVIDER: google
      OAUTH2_PROXY_CLIENT_ID: ${OAUTH_CLIENT_ID}
      OAUTH2_PROXY_CLIENT_SECRET: ${OAUTH_CLIENT_SECRET}

      # Cookie settings
      OAUTH2_PROXY_COOKIE_SECRET: ${COOKIE_SECRET}  # Generate with: openssl rand -hex 16
      OAUTH2_PROXY_COOKIE_SECURE: "true"
      OAUTH2_PROXY_COOKIE_DOMAINS: ".yourdomain.com"

      # Upstream (Stream Manager)
      OAUTH2_PROXY_UPSTREAMS: http://stream-manager:3001

      # Header configuration - REQUIRED for Stream Manager
      OAUTH2_PROXY_SET_XAUTHREQUEST: "true"
      OAUTH2_PROXY_PASS_USER_HEADERS: "true"
      OAUTH2_PROXY_PASS_ACCESS_TOKEN: "false"

      # Redirect and email settings
      OAUTH2_PROXY_REDIRECT_URL: https://yourdomain.com/oauth2/callback
      OAUTH2_PROXY_EMAIL_DOMAINS: "*"  # Or restrict: "yourdomain.com"

      # Listen settings
      OAUTH2_PROXY_HTTP_ADDRESS: 0.0.0.0:4180
    depends_on:
      - stream-manager

  stream-manager:
    image: stream-manager:latest
    container_name: stream-manager
    # No port exposure - only accessible via oauth2-proxy
    expose:
      - "3001"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - stream-manager-data:/data
    environment:
      PORT: "3001"
      NODE_ENV: production

      # Enable proxy authentication
      AUTH_MODE: proxy

      # Header configuration (matches oauth2-proxy defaults)
      AUTH_HEADER_USER: x-forwarded-user
      AUTH_HEADER_EMAIL: x-forwarded-email
      AUTH_HEADER_GROUPS: x-forwarded-groups
      AUTH_HEADER_NAME: x-forwarded-preferred-username

      # Role mapping
      AUTH_GROUP_ROLES: '{"admins":["admin"],"operators":["operator"],"viewers":["viewer"]}'
      AUTH_DEFAULT_ROLE: viewer

      # Trusted proxy IPs (docker network)
      AUTH_TRUSTED_PROXIES: "172.16.0.0/12,10.0.0.0/8,192.168.0.0/16"

volumes:
  stream-manager-data:
```

### 2. Generate Cookie Secret

```bash
# Generate a secure cookie secret
openssl rand -hex 16
```

### 3. Create Environment File

Create a `.env` file:

```bash
# OAuth credentials from your provider
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret

# Generated cookie secret
COOKIE_SECRET=your-generated-secret
```

### 4. Start Services

```bash
docker-compose -f docker-compose.oauth2.yml up -d
```

## Provider-Specific Configuration

### Google

```yaml
environment:
  OAUTH2_PROXY_PROVIDER: google
  OAUTH2_PROXY_CLIENT_ID: ${OAUTH_CLIENT_ID}
  OAUTH2_PROXY_CLIENT_SECRET: ${OAUTH_CLIENT_SECRET}
  OAUTH2_PROXY_EMAIL_DOMAINS: "yourdomain.com"
```

Create credentials at [Google Cloud Console](https://console.cloud.google.com/apis/credentials).

### Azure AD / Entra ID

```yaml
environment:
  OAUTH2_PROXY_PROVIDER: azure
  OAUTH2_PROXY_AZURE_TENANT: your-tenant-id
  OAUTH2_PROXY_CLIENT_ID: ${OAUTH_CLIENT_ID}
  OAUTH2_PROXY_CLIENT_SECRET: ${OAUTH_CLIENT_SECRET}
  OAUTH2_PROXY_OIDC_ISSUER_URL: https://login.microsoftonline.com/${AZURE_TENANT}/v2.0
```

Configure an App Registration in [Azure Portal](https://portal.azure.com).

### Keycloak

```yaml
environment:
  OAUTH2_PROXY_PROVIDER: keycloak-oidc
  OAUTH2_PROXY_CLIENT_ID: stream-manager
  OAUTH2_PROXY_CLIENT_SECRET: ${OAUTH_CLIENT_SECRET}
  OAUTH2_PROXY_OIDC_ISSUER_URL: https://keycloak.example.com/realms/your-realm
  OAUTH2_PROXY_LOGIN_URL: https://keycloak.example.com/realms/your-realm/protocol/openid-connect/auth
  OAUTH2_PROXY_REDEEM_URL: https://keycloak.example.com/realms/your-realm/protocol/openid-connect/token
  OAUTH2_PROXY_PROFILE_URL: https://keycloak.example.com/realms/your-realm/protocol/openid-connect/userinfo
  OAUTH2_PROXY_VALIDATE_URL: https://keycloak.example.com/realms/your-realm/protocol/openid-connect/userinfo
```

### Generic OIDC

```yaml
environment:
  OAUTH2_PROXY_PROVIDER: oidc
  OAUTH2_PROXY_OIDC_ISSUER_URL: https://your-idp.example.com
  OAUTH2_PROXY_CLIENT_ID: stream-manager
  OAUTH2_PROXY_CLIENT_SECRET: ${OAUTH_CLIENT_SECRET}
```

## Group-Based Role Mapping

Stream Manager maps identity provider groups to roles. Configure this mapping with `AUTH_GROUP_ROLES`.

### Example: Azure AD Groups

```yaml
# In Stream Manager configuration
AUTH_GROUP_ROLES: |
  {
    "StreamManager-Admins": ["admin"],
    "StreamManager-Operators": ["operator"],
    "Engineering": ["operator", "editor"],
    "Everyone": ["viewer"]
  }
```

### Example: Keycloak Roles

If your Keycloak client is configured to include roles in the groups claim:

```yaml
AUTH_GROUP_ROLES: |
  {
    "admin": ["admin"],
    "operator": ["operator"],
    "viewer": ["viewer"]
  }
```

### Passing Groups from oauth2-proxy

Ensure your OIDC provider includes groups in the ID token, then configure oauth2-proxy:

```yaml
environment:
  # Request groups scope
  OAUTH2_PROXY_SCOPE: "openid email profile groups"

  # Pass groups header
  OAUTH2_PROXY_SET_XAUTHREQUEST: "true"
```

## Security Considerations

### Trusted Proxies

Stream Manager validates that authentication headers come from trusted proxy IPs:

```yaml
# Only accept headers from these IP ranges
AUTH_TRUSTED_PROXIES: "172.16.0.0/12,10.0.0.0/8,192.168.0.0/16"
```

Configure this to match your Docker network or proxy infrastructure.

### Network Isolation

Never expose Stream Manager directly when using proxy authentication:

```yaml
stream-manager:
  # Use expose instead of ports
  expose:
    - "3001"
  # NOT: ports: - "3001:3001"
```

### Cookie Security

For production:

```yaml
OAUTH2_PROXY_COOKIE_SECURE: "true"
OAUTH2_PROXY_COOKIE_HTTPONLY: "true"
OAUTH2_PROXY_COOKIE_SAMESITE: "lax"
```

### Rate Limiting

Stream Manager includes built-in rate limiting for proxy mode:

```yaml
# Optional rate limiting configuration
RATE_LIMIT_ENABLED: "true"
RATE_LIMIT_MAX_REQUESTS: "120"  # Per minute
RATE_LIMIT_WINDOW_MS: "60000"
```

## Troubleshooting

### Headers Not Received

Check that oauth2-proxy is setting headers:

```bash
# In oauth2-proxy container
curl -I http://stream-manager:3001/api/auth/me
```

Verify `OAUTH2_PROXY_SET_XAUTHREQUEST: "true"` is set.

### User Not Authenticated

Check Stream Manager logs:

```bash
docker logs stream-manager 2>&1 | grep -i auth
```

Verify `AUTH_MODE=proxy` is set.

### Groups Not Mapped

1. Check that groups are in the ID token from your provider
2. Verify `AUTH_GROUP_ROLES` JSON is valid
3. Check that group names match exactly (case-sensitive)

### Connection Refused

Ensure Stream Manager is accessible from oauth2-proxy:

```bash
# From oauth2-proxy container
docker exec -it oauth2-proxy wget -qO- http://stream-manager:3001/api/health
```

## Full Production Example

```yaml
# docker-compose.prod.yml
services:
  oauth2-proxy:
    image: quay.io/oauth2-proxy/oauth2-proxy:v7.5.1
    restart: unless-stopped
    ports:
      - "443:4180"
    environment:
      # Azure AD configuration
      OAUTH2_PROXY_PROVIDER: azure
      OAUTH2_PROXY_AZURE_TENANT: ${AZURE_TENANT}
      OAUTH2_PROXY_CLIENT_ID: ${OAUTH_CLIENT_ID}
      OAUTH2_PROXY_CLIENT_SECRET: ${OAUTH_CLIENT_SECRET}

      # Cookie configuration
      OAUTH2_PROXY_COOKIE_SECRET: ${COOKIE_SECRET}
      OAUTH2_PROXY_COOKIE_SECURE: "true"
      OAUTH2_PROXY_COOKIE_HTTPONLY: "true"
      OAUTH2_PROXY_COOKIE_SAMESITE: lax

      # Header passthrough
      OAUTH2_PROXY_SET_XAUTHREQUEST: "true"
      OAUTH2_PROXY_PASS_USER_HEADERS: "true"
      OAUTH2_PROXY_SCOPE: "openid email profile groups"

      # Upstream
      OAUTH2_PROXY_UPSTREAMS: http://stream-manager:3001
      OAUTH2_PROXY_REDIRECT_URL: https://streams.yourdomain.com/oauth2/callback

      # TLS (or use external termination)
      OAUTH2_PROXY_HTTPS_ADDRESS: 0.0.0.0:4180
      OAUTH2_PROXY_TLS_CERT_FILE: /etc/ssl/certs/cert.pem
      OAUTH2_PROXY_TLS_KEY_FILE: /etc/ssl/private/key.pem
    volumes:
      - ./certs:/etc/ssl:ro
    depends_on:
      stream-manager:
        condition: service_healthy

  stream-manager:
    image: stream-manager:latest
    restart: unless-stopped
    expose:
      - "3001"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - stream-manager-data:/data
    environment:
      PORT: "3001"
      NODE_ENV: production
      LOG_LEVEL: info

      # Authentication
      AUTH_MODE: proxy
      AUTH_GROUP_ROLES: '{"Admins":["admin"],"DevOps":["operator"],"Engineering":["editor"]}'
      AUTH_DEFAULT_ROLE: viewer
      AUTH_TRUSTED_PROXIES: "172.16.0.0/12"

      # Rate limiting
      RATE_LIMIT_ENABLED: "true"
      RATE_LIMIT_MAX_REQUESTS: "120"

      # Security logging
      SECURITY_LOGGING: "true"
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  stream-manager-data:
```

## Related Documentation

- [oauth2-proxy Documentation](https://oauth2-proxy.github.io/oauth2-proxy/)
- [Stream Manager README](../README.md)
- [Azure EasyAuth Integration](auth-azure-easyauth.md)
- [nginx Auth Integration](auth-nginx.md)
