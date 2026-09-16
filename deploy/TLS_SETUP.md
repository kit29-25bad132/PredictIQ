# TLS Setup Guide for PredictIQ Deployment

## Status: Ready — verification pending live infrastructure

This document describes how to configure TLS (HTTPS) for the PredictIQ V1 deployment.
A profile-gated nginx reverse proxy service is now part of `docker-compose.yml`
(profile `proxy`); TLS itself still requires real certificates and a real domain
from the deployment environment.

## Current State

The compose stack ships an **nginx TLS-terminating reverse proxy** (service
`proxy`, compose profile `proxy`) implementing Option A below. Without
`--profile proxy` nothing changes for the local demo: services stay
loopback-only on the host and TLS is simply absent.

| Component | Current Protocol | Production Requirement |
|-----------|-----------------|----------------------|
| Browser → nginx (443) | HTTPS via `--profile proxy` | HTTPS required |
| nginx → frontend/backend | HTTP over internal Docker network | acceptable (private network) |
| Device → Backend (telemetry) | HTTP unless via proxy | HTTPS required for production |

## Configuration Files

- `deploy/nginx/predictiq.conf.template` — rendered at container start by the
  nginx image's envsubst bootstrap (`SERVER_NAME` substituted; nginx variables
  untouched). Handles HTTP→HTTPS redirect (with an ACME exception), TLS
  termination, HSTS/security headers, `location /` → `frontend:3000`,
  `location /api/` → `backend:8000`.
- `deploy/nginx/certs/` — **gitignored**. Place `fullchain.pem` + `privkey.pem`
  here; mounted read-only at `/etc/nginx/certs`.

## Why TLS Cannot Be Fully Pre-Verified

1. **No certificates available**: Real TLS certificates must be obtained for the specific domain.
2. **Deployment-specific**: The domain, certificate issuer, and DNS setup depend on the hosting environment.
3. **Cannot be verified locally**: Without real certificates and domain, TLS cannot be tested end-to-end.

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

**Let's Encrypt (free)** — recommended webroot flow for this stack (one-time
standalone bootstrap; see `deploy/README.md` → "Server deployment procedure"
for the full sequence):
```bash
sudo certbot certonly --standalone -d predictiq.example.com
sudo cp /etc/letsencrypt/live/predictiq.example.com/fullchain.pem deploy/nginx/certs/
sudo cp /etc/letsencrypt/live/predictiq.example.com/privkey.pem  deploy/nginx/certs/
sudo chown "$USER" deploy/nginx/certs/*.pem
```

Certificate files will be at:
- `/etc/letsencrypt/live/predictiq.example.com/fullchain.pem`
- `/etc/letsencrypt/live/predictiq.example.com/privkey.pem`

Renewals run with `--webroot` pointing at the mounted `certbot-webroot`
volume so nginx keeps serving while certificates refresh.

**Cloud Provider**: Use your cloud provider's managed certificate service (AWS ACM, GCP Certificate Manager, Azure Key Vault, etc.)

### Option B: Cloud Load Balancer / Ingress

If deploying to a cloud platform:

1. **AWS**: Application Load Balancer with ACM certificate
2. **GCP**: Cloud Load Balancing with Managed Certificates
3. **Azure**: Application Gateway with Key Vault certificates
4. **Kubernetes**: Ingress controller with cert-manager

## Configuration Updates Required

After TLS is configured, update these environment variables in `deploy/.env`:

```bash
# deploy/.env
SERVER_NAME=predictiq.example.com
CORS_ORIGINS=https://predictiq.example.com
# VITE_API_URL must stay UNSET for production builds: the bundle calls
# same-origin /api paths and the Node server + nginx route them. VITE_API_URL
# is a build-time-only variable and cannot change a built bundle.
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
- [ ] Certificate and private key securely stored (not in repository; deploy/nginx/certs/ is gitignored)
- [ ] Reverse proxy container running (`docker compose --profile proxy ps proxy`)
- [ ] HTTP → HTTPS redirect configured (predictiq.conf.template)
- [ ] HSTS header set (predictiq.conf.template)
- [ ] CORS_ORIGINS updated to HTTPS URLs (deploy/.env)
- [ ] SERVER_NAME set to the public domain (deploy/.env)
- [ ] VITE_API_URL left unset for the production build (same-origin /api)
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
