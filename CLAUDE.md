# Agentic Slack - Reimagined Slack for AI Agents

## Quick Reference
```bash
npm install               # Install dependencies
npm start                 # Launch Electron app
npm run dev               # Dev mode with hot reload
```

## Architecture
- **Framework**: Electron
- **UI**: React
- **Design philosophy**: Agent-first, not human-first

## Design Principles
- Every interaction should feel like talking to a coordinator agent that handles the rest
- Non-agent panes should be observability views (cost, performance, audit trail)
- Must be accessible to non-technical users (marketing, sales) — avoid overwhelming UIs
- Bring "life" to the interface: subtle animations, light effects, blinking indicators
- Think how normies imagine future computers should work
- Settings need depth: multiple tabs, enterprise security controls (SSO, data residency, audit logging, role-based access)

## Key Features
- Chat with coordinator agent → it dispatches to specialized agents
- Cost observability (finance-app-like views per agent/task)
- Clean tool-use visualization (show what agents are doing without overwhelming)
- Fleet MDM enrollment support
- Enterprise security settings
