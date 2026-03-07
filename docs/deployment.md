# Deployment

## Overview

Fabric supports three deployment modes:

1. **Desktop (Electron)** — Local development and personal use
2. **Server (Node.js)** — Standalone API server without Electron
3. **Kubernetes (Helm)** — Production deployment with PostgreSQL

## Desktop Mode

```bash
npm run build && npm start
```

Launches the Electron app with the full UI. No database required — uses in-memory state and mock data for demo.

## Server Mode

Run the API server standalone:

```bash
# Required
export ANTHROPIC_API_KEY=sk-ant-...

# Optional — enables persistent storage
export DATABASE_URL=postgresql://user:pass@localhost:5432/fabric

# Optional
export PORT=3000

npm run build
node dist/server.js
```

The server provides:
- REST API for goal management and observability queries
- SSE stream at `/events` for real-time updates
- Automatic database migration on startup (if `DATABASE_URL` is set)

### Without Database

The server works without PostgreSQL — all state is in-memory. Goals, tool calls, and cost data are lost on restart. Useful for testing and development.

### With Database

Set `DATABASE_URL` to enable persistent storage. The server runs migrations automatically on startup.

```bash
# Create the database
createdb fabric

# Server handles migrations automatically, or run manually:
psql fabric < src/db/migrations/001_initial.sql
```

## Kubernetes Deployment

### Prerequisites

- Kubernetes cluster (1.24+)
- Helm 3
- `kubectl` configured

### Quick Start

```bash
# Copy and customize values
cp helm/fabric/values.yaml helm/fabric/values-prod.yaml

# Edit values-prod.yaml:
#   - Set anthropicApiKey
#   - Configure ingress hostname
#   - Adjust resource limits

# Deploy
helm install fabric helm/fabric -f helm/fabric/values-prod.yaml
```

### Helm Chart Components

The chart deploys:

| Component | Kind | Description |
|-----------|------|-------------|
| Fabric API | Deployment | The main server (configurable replicas) |
| PostgreSQL | StatefulSet | Database with persistent volume |
| ConfigMap | ConfigMap | Non-sensitive configuration |
| Secret | Secret | API keys and DB credentials |
| Service | Service | ClusterIP for internal access |
| Ingress | Ingress | External HTTPS access (optional) |

### Configuration

Key values in `values.yaml`:

```yaml
# Replicas
replicaCount: 2

# Image
image:
  repository: fabric
  tag: latest

# API configuration
config:
  port: 3000
  defaultBudgetUsd: "2.00"
  defaultMaxTurns: "30"
  defaultModel: "sonnet"

# Secrets
secrets:
  anthropicApiKey: ""  # Required

# PostgreSQL
postgresql:
  enabled: true
  storage: 10Gi
  resources:
    requests:
      memory: 256Mi
      cpu: 250m

# Ingress
ingress:
  enabled: false
  className: nginx
  host: fabric.example.com
  tls: false
```

### Scaling

The Fabric API is stateless (all state in PostgreSQL), so horizontal scaling is straightforward:

```bash
# Scale up
kubectl scale deployment fabric --replicas=4

# Or update values
helm upgrade fabric helm/fabric --set replicaCount=4
```

### Monitoring

Health check endpoint:

```bash
curl http://fabric:3000/health
# {"status":"ok","goals":12,"db":true}
```

Kubernetes probes are configured:
- **Liveness**: `GET /health` every 30s
- **Readiness**: `GET /health` every 10s

### Upgrading

```bash
# Build new image
docker build -t fabric:v1.1.0 .

# Upgrade
helm upgrade fabric helm/fabric --set image.tag=v1.1.0
```

### Uninstalling

```bash
helm uninstall fabric
# Note: PVC for PostgreSQL is NOT deleted automatically
kubectl delete pvc data-fabric-postgresql-0
```

## Docker

### Dockerfile

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ dist/
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### Build and Run

```bash
npm run build
docker build -t fabric:latest .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e DATABASE_URL=postgresql://... \
  fabric:latest
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes (server) | — | Claude API key |
| `DATABASE_URL` | No | — | PostgreSQL connection string |
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | Environment |
| `PGHOST` | No | `localhost` | PostgreSQL host (if no DATABASE_URL) |
| `PGPORT` | No | `5432` | PostgreSQL port |
| `PGDATABASE` | No | `fabric` | PostgreSQL database name |
| `PGUSER` | No | — | PostgreSQL user |
| `PGPASSWORD` | No | — | PostgreSQL password |
| `DEFAULT_BUDGET_USD` | No | `2.00` | Default per-goal budget |
| `DEFAULT_MAX_TURNS` | No | `30` | Default max turns |
| `DEFAULT_MODEL` | No | `sonnet` | Default model |
