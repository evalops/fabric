# Fabric Development Guide

Internal documentation for building, packaging, and running Fabric.

## Prerequisites

- Node.js 18+
- npm
- macOS (Apple Silicon) for DMG builds
- Docker (for GitHub and Vault MCP servers)
- `uv` / `uvx` (for Python-based MCP servers: ClickHouse, Grafana, Git, Fetch)

## Quick Start

```bash
npm install
npm start          # Build and launch in dev mode
npm test           # Run all tests (unit + e2e)
npm run typecheck  # Full TypeScript check
```

## Building

### Development

```bash
npm run build      # esbuild: main + renderer
npm start          # build + launch Electron
```

### Production DMG

```bash
npm run dist       # Build + package as macOS DMG
```

Output: `release/Fabric-1.0.0.dmg`

### Install to /Applications

```bash
npm run dist:install   # Build DMG + copy .app to /Applications
```

Or manually:

```bash
cp -r release/mac-arm64/Fabric.app /Applications/
```

## Packaging Details

Uses `electron-builder` with this configuration:

- **App ID:** `com.evalops.fabric`
- **Output:** `release/` directory
- **Target:** macOS DMG, arm64 only
- **Signing:** Ad-hoc (no Apple Developer cert)
- **Notarization:** Skipped (internal distribution only)

The DMG is ~114 MB. The `.app` bundle includes all node_modules and the
bundled Electron runtime.

### Build artifacts (gitignored)

```
release/
  Fabric-1.0.0.dmg           # Distributable disk image
  Fabric-1.0.0.dmg.blockmap  # Delta update support
  mac-arm64/
    Fabric.app/               # Standalone application bundle
```

## MCP Server Configuration

MCP servers are configured at `~/.fabric/mcp-servers.json`. Fabric loads
this on startup, skips any server with `REPLACE_ME` env values, and
connects the rest in parallel.

### Ready to go (no API keys needed)

| Server | What it does |
|--------|-------------|
| filesystem | File operations on configured directories |
| kubernetes | k3s cluster management via kubeconfig |
| playwright | Browser automation |
| memory | Persistent knowledge graph (~/.fabric/memory.jsonl) |
| sequential-thinking | Reflective problem-solving chains |
| fetch | Web content fetching |
| git | Git repository operations |

### Requires API keys

Replace `REPLACE_ME` in `~/.fabric/mcp-servers.json` with real values:

| Server | Env var | How to get it |
|--------|---------|--------------|
| github | `GITHUB_PERSONAL_ACCESS_TOKEN` | github.com/settings/tokens (fine-grained PAT) |
| brave-search | `BRAVE_API_KEY` | brave.com/search/api |
| clickhouse | `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` | Vault: `secret/data/homelab/clickhouse` |
| grafana | `GRAFANA_SERVICE_ACCOUNT_TOKEN` | grafana-k8s.tailcdfb.ts.net > Admin > Service accounts |
| vault | `VAULT_TOKEN` | `vault token create` or OIDC login |
| sentry | `SENTRY_ACCESS_TOKEN` | sentry.io/settings/auth-tokens |
| notion | `NOTION_TOKEN` | notion.so/my-integrations |
| firecrawl | `FIRECRAWL_API_KEY` | firecrawl.dev/app/api-keys |

### Infrastructure endpoints (via Tailscale)

| Service | Tailscale address |
|---------|------------------|
| ClickHouse | clickhouse.tailcdfb.ts.net |
| Grafana | grafana-k8s.tailcdfb.ts.net |
| Vault | vault.tailcdfb.ts.net |
| Prometheus | prometheus-k3s.tailcdfb.ts.net |
| ArgoCD | argocd.tailcdfb.ts.net |

Tailscale must be connected to reach these endpoints.

## Project Structure

```
src/
  main.ts                    # Electron main process, IPC, MCP loading
  preload.ts                 # Context bridge (renderer <-> main)
  fabric.ts                  # Core orchestration engine (1900+ lines)
  server.ts                  # HTTP API server (non-Electron mode)
  db/persistence.ts          # PostgreSQL persistence layer
  extensions/
    mcp.ts                   # MCP client extension factory
    mcp.test.ts              # Unit tests (25 tests)
    mcp-e2e.test.ts          # Stdio integration tests (10 tests)
    test-mcp-server.mjs      # Test MCP server for e2e tests
    webhook.ts               # Webhook notification extension
  renderer/
    index.html               # App shell
    renderer.ts              # View switching, event handling
    state.ts                 # Client state management
    styles.css               # Design system (light + dark mode)
    types.ts                 # TypeScript interfaces
    views.ts                 # Main view renderers
    view-chat.ts             # Chat interface
    view-settings.ts         # Settings with MCP tab
    view-agents.ts           # Agent roster
    view-costs.ts            # Cost breakdown
    detail-panels.ts         # Goal/agent detail modals
    cmdk.ts                  # Command palette (Cmd+K)
build/
  icon.icns                  # macOS app icon
  icon.iconset/              # Source PNGs for icon
```

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

Tests use Vitest. The e2e tests spawn a real MCP server (`test-mcp-server.mjs`)
over stdio and exercise the full client pipeline.

## Updating

After pulling changes:

```bash
npm install           # Pick up new dependencies
npm run dist:install  # Rebuild and reinstall to /Applications
```
