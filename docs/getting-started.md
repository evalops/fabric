# Getting Started

## Prerequisites

- Node.js 20+
- npm 10+
- Anthropic API key (for agent execution)
- PostgreSQL 15+ (for persistence, optional for development)

## Quick Start (Desktop App)

```bash
# Clone and install
git clone https://github.com/evalops/fabric.git
cd fabric
npm install

# Run in demo mode (no API key needed)
npm start
```

The app launches with mock data showing 5 goals, 16 agents, and live simulation. Click around to explore the UI.

## With Real Agents

1. Open the app → Settings (sidebar)
2. Enter your Anthropic API key
3. Press `Cmd+K` and type `create: <your goal description>`
4. Watch agents decompose and execute the goal in real-time

## Server Mode

For production deployment without Electron:

```bash
# Set environment variables
export ANTHROPIC_API_KEY=sk-ant-...
export DATABASE_URL=postgresql://user:pass@localhost:5432/fabric
export PORT=3000

# Build and run
npm run build
node dist/server.js
```

## Database Setup

```bash
# Create the database
createdb fabric

# Run migrations
psql fabric < src/db/migrations/001_initial.sql
```

Or use the Helm chart which handles this automatically.

## Kubernetes Deployment

```bash
# Add your values
cp helm/fabric/values.yaml helm/fabric/values-prod.yaml
# Edit values-prod.yaml with your config

# Deploy
helm install fabric helm/fabric -f helm/fabric/values-prod.yaml
```

See [deployment.md](deployment.md) for detailed Kubernetes instructions.

## Development

```bash
# Type-check
npx tsc --noEmit

# Build only
npm run build

# Build + launch
npm start
```

### Project Structure

```
src/
├── fabric.ts           # Orchestration engine (Claude Agent SDK)
├── main.ts             # Electron main process
├── preload.ts          # Electron preload (context bridge)
├── server.ts           # HTTP/WebSocket API server
├── db/
│   ├── persistence.ts  # Database access layer
│   ├── schema.sql      # Full schema reference
│   └── migrations/     # Versioned migrations
└── renderer/
    ├── renderer.ts     # Entry point (thin)
    ├── types.ts        # Shared types
    ├── state.ts        # Central state management
    └── ... (14 modules total)

docs/                   # Documentation
helm/fabric/            # Kubernetes Helm chart
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | API key for Claude Agent SDK |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | Environment (development/production) |
| `DEFAULT_BUDGET_USD` | `2.00` | Default per-goal budget |
| `DEFAULT_MAX_TURNS` | `30` | Default max agent turns per goal |
| `DEFAULT_MODEL` | `sonnet` | Default model (sonnet/opus/haiku) |

### Settings (Desktop App)

Settings are persisted in `localStorage` under `fabric:settings:v1`:

- **Theme**: light / dark / system
- **API Key**: Stored locally, forwarded to main process
- **Model**: Claude Opus 4.6 / Sonnet 4.6 / Haiku 4.5
- **Budget per goal**: Max spend in USD before pausing
- **Max turns**: Max conversation turns before stopping
- **Notifications**: Toast and sound toggles
