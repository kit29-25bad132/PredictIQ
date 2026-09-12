# TLS Setup Guide for PredictIQ Deployment

## Status: Deployment Verification Pending

This document describes how to configure TLS (HTTPS) for the PredictIQ V1 deployment.
**TLS is NOT configured in the current skeleton** - this is a deployment-environment dependent task.

## Current State

The current `docker-compose.yml` deployment does **not** include TLS termination.
Services communicate over HTTP on an internal Docker network.

| Component | Current Protocol | Production Requirement |
|-----------|-----------------|----------------------|
| Frontend → Backend (internal) | HTTP | HTTPS recommended (via reverse proxy) |
| Browser → Frontend | HTTP | HTTPS required |
| Device → Backend (telemetry) | HTTP | HTTPS required for production |

## Why TLS is Not Included in Phase 8 Skeleton

1. **No certificates available**: Real TLS certificates must be obtained for the specific domain.
2. **Deployment-specific**: The reverse proxy setup depends on the hosting environment.
3. **Cannot be verified locally**: Without real certificates and domain, TLS cannot be tested.

## Production TLS Options

### Option A: Reverse Proxy (Recommended for Self-Hosted)

Deploy a reverse proxy in front of the application stack:

```
                    ┌─────────────────────────────┐
                    │  Reverse Proxy (nginx/Traefik/Caddy) │
                    │  - TLS termination          │
                    │  - Certificate management   │
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────┴───────────────┐
                    │   Docker Network            │
                    │  ┌─────────┐  ┌─────────┐  │
                    │  │ Frontend│  │ Backend │  │
                    │  └─────────┘  └─────────┘  │
                    │          ┌─────────┐        │
                    │          │ Database│        │
                    │          └─────────┘        │
                    └─────────────────────────────┘
```

#### nginx Example Configuration

```nginx
server {
    listen 443 ssl;
    server_name predictiq.example.com;

    # TLS certificates (replace with real certificates)
    ssl_certificate /etc/ssl/certs/predictiq.crt;
    ssl_certificate_key /etc/ssl/private/predictiq.key;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    # Frontend
    location / {
        proxy_pass http://frontend:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend API
    location /api {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Obtaining Certificates

**Let's Encrypt (free)**:
```bash
# Using certbot
certbot certonly --standalone -d predictiq.example.com

# Or with nginx plugin
certbot certonly --nginx -d predictiq.example.com
```

Certificate files will be at:
- `/etc/letsencrypt/live/predictiq.example.com/fullchain.pem`
- `/etc/letsencrypt/live/predictiq.example.com/privkey.pem`

**Cloud Provider**: Use your cloud provider's managed certificate service (AWS ACM, GCP Certificate Manager, Azure Key Vault, etc.)

### Option B: Cloud Load Balancer / Ingress

If deploying to a cloud platform:

1. **AWS**: Application Load Balancer with ACM certificate
2. **GCP**: Cloud Load Balancing with Managed Certificates
3. **Azure**: Application Gateway with Key Vault certificates
4. **Kubernetes**: Ingress controller with cert-manager

## Configuration Updates Required

After TLS is configured, update these environment variables:

```bash
# .env file
VITE_API_URL=https://predictiq.example.com
CORS_ORIGINS=https://predictiq.example.com
```

## Device Telemetry TLS

For production device telemetry ingestion:

1. Devices must connect via HTTPS
2. The backend must have a valid certificate trusted by devices
3. Consider certificate pinning for high-security deployments
4. Update firmware `config.h` with the HTTPS URL

## Verification Checklist

Before claiming TLS is deployed:

- [ ] Valid TLS certificate obtained for the production domain
- [ ] Certificate and private key securely stored (not in repository)
- [ ] Reverse proxy or load balancer configured for TLS termination
- [ ] HTTP → HTTPS redirect configured
- [ ] HSTS header set
- [ ] CORS_ORIGINS updated to HTTPS URLs
- [ ] VITE_API_URL updated to HTTPS URL
- [ ] Browser connects via HTTPS without warnings
- [ ] Device telemetry uses HTTPS endpoint
- [ ] Certificate auto-renewal configured (if using Let's Encrypt)

## Security Notes

- **Never commit private keys** to the repository
- Use strong TLS configurations (TLS 1.2+, strong cipher suites)
- Enable HSTS to prevent downgrade attacks
- Keep certificates renewed before expiration
- Monitor certificate expiration

## Local Development

For local development without TLS:

1. Use HTTP on localhost (acceptable for development)
2. The frontend connects to `http://localhost:8000`
3. Devices on the same network can use HTTP if configured

Do not use development HTTP configuration in production.
