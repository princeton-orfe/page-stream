# Azure EasyAuth Integration

This guide covers integrating Stream Manager with Azure App Service Authentication (EasyAuth) and Azure Front Door.

## Overview

Azure EasyAuth provides built-in authentication for Azure App Service and Azure Container Apps. When enabled, Azure handles authentication and passes user identity to your application via special headers.

Stream Manager automatically detects and parses Azure EasyAuth headers:
- `X-MS-CLIENT-PRINCIPAL`: Base64-encoded JSON with full claims
- `X-MS-CLIENT-PRINCIPAL-NAME`: User's display name

## Architecture

### Azure App Service

```
┌──────────┐      ┌──────────────────┐      ┌──────────────────┐
│  Browser │─────▶│  Azure App       │─────▶│  Stream Manager  │
└──────────┘      │  Service Auth    │      │  (Container)     │
                  └──────────────────┘      └──────────────────┘

                  Azure sets headers:        Stream Manager reads:
                  X-MS-CLIENT-PRINCIPAL      X-MS-CLIENT-PRINCIPAL
                  X-MS-CLIENT-PRINCIPAL-     X-MS-CLIENT-PRINCIPAL-NAME
                  NAME
```

### Azure Front Door with App Service

```
┌──────────┐      ┌──────────────┐      ┌──────────────────┐      ┌──────────────┐
│  Browser │─────▶│  Front Door  │─────▶│  App Service     │─────▶│  Container   │
└──────────┘      │  (CDN/WAF)   │      │  Auth            │      │              │
                  └──────────────┘      └──────────────────┘      └──────────────┘
```

## Quick Start: Azure App Service

### 1. Deploy Stream Manager Container

Create a Container Apps or App Service deployment:

```bash
# Create resource group
az group create --name stream-manager-rg --location eastus

# Create Container Apps environment
az containerapp env create \
  --name stream-manager-env \
  --resource-group stream-manager-rg \
  --location eastus

# Deploy Stream Manager
az containerapp create \
  --name stream-manager \
  --resource-group stream-manager-rg \
  --environment stream-manager-env \
  --image your-registry.azurecr.io/stream-manager:latest \
  --target-port 3001 \
  --ingress external \
  --env-vars \
    AUTH_MODE=proxy \
    AUTH_DEFAULT_ROLE=viewer \
    AUTH_TRUSTED_PROXIES="10.0.0.0/8,172.16.0.0/12,169.254.0.0/16"
```

### 2. Enable Authentication

Via Azure Portal:
1. Navigate to your Container App or App Service
2. Go to **Settings** > **Authentication**
3. Click **Add identity provider**
4. Select **Microsoft** (Azure AD)
5. Configure:
   - App registration: Create new or use existing
   - Supported account types: Your organization
   - Client secret: Auto-generated
6. Save

Via Azure CLI:

```bash
# Enable Azure AD authentication
az containerapp auth microsoft update \
  --name stream-manager \
  --resource-group stream-manager-rg \
  --client-id $APP_CLIENT_ID \
  --client-secret $APP_CLIENT_SECRET \
  --tenant-id $TENANT_ID \
  --yes
```

### 3. Configure Group Claims

To include Azure AD groups in the authentication claims:

1. Go to Azure Portal > **App registrations**
2. Find your app registration
3. Go to **Token configuration**
4. Click **Add groups claim**
5. Select:
   - Security groups
   - Groups assigned to the application
6. For ID tokens, select "Group ID"

### 4. Configure Stream Manager

```bash
# Environment variables for Stream Manager
AUTH_MODE=proxy
AUTH_GROUP_ROLES='{"<group-id-1>":["admin"],"<group-id-2>":["operator"]}'
AUTH_DEFAULT_ROLE=viewer
```

## Azure Front Door Setup

For global CDN and WAF protection:

### 1. Create Front Door

```bash
# Create Front Door
az afd profile create \
  --name stream-manager-fd \
  --resource-group stream-manager-rg \
  --sku Standard_AzureFrontDoor

# Create endpoint
az afd endpoint create \
  --name streams \
  --profile-name stream-manager-fd \
  --resource-group stream-manager-rg

# Create origin group
az afd origin-group create \
  --name stream-manager-origins \
  --profile-name stream-manager-fd \
  --resource-group stream-manager-rg \
  --probe-path /api/health \
  --probe-protocol Https \
  --probe-interval-in-seconds 30

# Add origin (your App Service)
az afd origin create \
  --name stream-manager-origin \
  --origin-group-name stream-manager-origins \
  --profile-name stream-manager-fd \
  --resource-group stream-manager-rg \
  --host-name stream-manager.azurewebsites.net \
  --origin-host-header stream-manager.azurewebsites.net \
  --http-port 80 \
  --https-port 443 \
  --priority 1

# Create route
az afd route create \
  --name default-route \
  --profile-name stream-manager-fd \
  --resource-group stream-manager-rg \
  --endpoint-name streams \
  --origin-group stream-manager-origins \
  --forwarding-protocol HttpsOnly \
  --https-redirect Enabled \
  --supported-protocols Https
```

### 2. Configure Custom Domain

```bash
# Add custom domain
az afd custom-domain create \
  --name streams-domain \
  --profile-name stream-manager-fd \
  --resource-group stream-manager-rg \
  --host-name streams.yourdomain.com \
  --certificate-type ManagedCertificate
```

### 3. Update App Service Authentication

Update the redirect URLs in your app registration:
- `https://streams.yourdomain.com/.auth/login/aad/callback`

## X-MS-CLIENT-PRINCIPAL Format

Azure EasyAuth sends a base64-encoded JSON structure:

```json
{
  "auth_typ": "aad",
  "claims": [
    {
      "typ": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      "val": "user@domain.com"
    },
    {
      "typ": "name",
      "val": "John Doe"
    },
    {
      "typ": "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups",
      "val": "12345678-1234-1234-1234-123456789abc"
    },
    {
      "typ": "groups",
      "val": "87654321-4321-4321-4321-cba987654321"
    }
  ],
  "name_typ": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
  "role_typ": "http://schemas.microsoft.com/ws/2008/06/identity/claims/role"
}
```

Stream Manager extracts:
- User ID from `userId` or `userDetails` field
- Email from email claims
- Groups from `groups` claims (Azure AD group IDs)

## Role Mapping with Azure AD Groups

### Using Group Object IDs

Azure AD group claims contain Object IDs (GUIDs). Map these to Stream Manager roles:

```yaml
# docker-compose.yml
environment:
  AUTH_GROUP_ROLES: |
    {
      "12345678-1234-1234-1234-123456789abc": ["admin"],
      "87654321-4321-4321-4321-cba987654321": ["operator"],
      "abcdefab-abcd-abcd-abcd-abcdefabcdef": ["editor"]
    }
```

### Finding Group Object IDs

Via Azure Portal:
1. Go to **Azure Active Directory** > **Groups**
2. Click on the group
3. Copy the **Object ID**

Via Azure CLI:

```bash
# List groups
az ad group list --query "[].{name:displayName, id:id}" -o table

# Find specific group
az ad group show --group "StreamManager-Admins" --query id -o tsv
```

### Using Group Names (Optional)

To use group display names instead of IDs, configure your app registration to emit group names:

1. Go to **App registrations** > Your app > **Token configuration**
2. Edit the groups claim
3. Under "Customize token properties", select **Emit groups as: Group names (Preview)**

Then configure Stream Manager:

```yaml
AUTH_GROUP_ROLES: |
  {
    "StreamManager-Admins": ["admin"],
    "StreamManager-Operators": ["operator"],
    "Engineering": ["viewer"]
  }
```

## Security Considerations

### Restrict Access to Specific Users

Configure which users can access the application:

1. Go to **Enterprise applications** > Your app
2. Under **Properties**, set:
   - **Assignment required** = Yes
3. Under **Users and groups**, add allowed users/groups

### Configure Allowed Token Audiences

```bash
# In App Service configuration
az webapp config appsettings set \
  --name stream-manager \
  --resource-group stream-manager-rg \
  --settings WEBSITE_AUTH_ALLOWED_AUDIENCES="api://stream-manager"
```

### Trusted Proxy Configuration

Azure infrastructure IPs should be trusted. Default configuration handles this:

```yaml
AUTH_TRUSTED_PROXIES: "10.0.0.0/8,172.16.0.0/12,169.254.0.0/16"
```

For Container Apps, the platform handles proxy trust automatically.

## Bicep/ARM Deployment

### Container App with Authentication

```bicep
// main.bicep
param location string = resourceGroup().location
param containerAppName string = 'stream-manager'
param containerImage string

resource containerAppEnv 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: '${containerAppName}-env'
  location: location
  properties: {}
}

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: containerAppName
  location: location
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3001
      }
    }
    template: {
      containers: [
        {
          name: 'stream-manager'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'AUTH_MODE', value: 'proxy' }
            { name: 'AUTH_DEFAULT_ROLE', value: 'viewer' }
            { name: 'AUTH_GROUP_ROLES', value: '{}' }
          ]
        }
      ]
    }
  }
}
```

## Troubleshooting

### Headers Not Received

Check that EasyAuth is enabled:

```bash
# View auth settings
az containerapp auth show \
  --name stream-manager \
  --resource-group stream-manager-rg
```

### Group Claims Missing

1. Verify groups claim is configured in Token configuration
2. Check user is actually a member of the groups
3. Ensure "Assignment required" doesn't block access

### Debugging Claims

Add temporary logging to see what claims are received:

```bash
# Check Stream Manager logs
az containerapp logs show \
  --name stream-manager \
  --resource-group stream-manager-rg \
  --follow
```

Look for auth-related log entries showing parsed user info.

### Token Expired

EasyAuth handles token refresh automatically. If issues persist:

1. Clear browser cookies
2. Sign out and sign in again
3. Check token lifetime settings in Azure AD

## Multi-Tenant Configuration

For applications serving multiple Azure AD tenants:

```bash
# App registration - Supported account types
az ad app update \
  --id $APP_ID \
  --sign-in-audience AzureADMultipleOrgs
```

Configure EasyAuth:

```bash
az containerapp auth microsoft update \
  --name stream-manager \
  --resource-group stream-manager-rg \
  --issuer "https://login.microsoftonline.com/common/v2.0" \
  --yes
```

## Related Documentation

- [Azure App Service Authentication](https://docs.microsoft.com/azure/app-service/overview-authentication-authorization)
- [Azure Container Apps Authentication](https://docs.microsoft.com/azure/container-apps/authentication)
- [Configure Azure AD Groups Claims](https://docs.microsoft.com/azure/active-directory/develop/active-directory-optional-claims)
- [Stream Manager README](../README.md)
- [OAuth2 Proxy Integration](auth-oauth2-proxy.md)
- [nginx Auth Integration](auth-nginx.md)
