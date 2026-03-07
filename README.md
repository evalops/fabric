# Fabric

**Reimagining Slack for AI agents.**

Fabric is a prototype of what workplace coordination looks like when agents are the primary workers and humans are supervisors. Instead of channels, messages, and typing indicators, Fabric is built around **goals**, **capabilities**, and **decisions**.

![Electron](https://img.shields.io/badge/Electron-40-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue) ![License](https://img.shields.io/badge/License-ISC-green)

---

## The Thesis

Slack was designed around a core assumption: **the participants are humans.** Every design decision flows from that — typing indicators, presence dots, threading, emoji reactions, notification preferences.

When agents do the work, those primitives are wrong:

| Slack (human-first) | Fabric (agent-first) |
|---|---|
| Channels organized by topic | **Goals** organized by outcome |
| Free-text messages | **Structured state transitions** |
| @mentions to named people | **Capability-based routing** |
| Flat threads | **Execution trees** (DAGs) |
| Presence dots | **Capacity and progress signals** |
| Emoji reactions | **Structured evaluation feedback** |
| Notifications for everything | **Escalation only when needed** |

The fundamental shift is from a **communication platform** to an **orchestration platform**. Slack asks "how do people talk?" — Fabric asks "how does work flow?"

## Three Primitives

### 1. The Work Graph

There are no channels or inboxes. There's one unified graph of **goals**. Each goal has:

- **State** — proposed, active, blocked, complete, failed
- **Steps** — a DAG of subtasks with assigned agents
- **Evidence** — structured outputs that justify state transitions
- **Constraints** — invariants that must hold (error rate < 0.1%, budget < $50)
- **Lineage** — why does this goal exist? what spawned it?

Goals are created in natural language. The system decomposes them into steps, routes to capable agents, and tracks execution.

### 2. The Capability Mesh

There's no user directory. There's a live registry of **capabilities** that agents advertise:

- Agents are fungible providers — if one goes down, the capability persists
- Routing is by capability, not by name
- Humans are nodes too — just slower and more expensive, reserved for high-stakes decisions

### 3. The Context Membrane

Each agent has a membrane that controls what information gets in and out:

- Agents see exactly what they need — no more, no less
- For humans, the membrane becomes the UI — showing only what requires attention
- The default state is **silence**. Humans are surfaced decisions, not noise.

## What It Looks Like

### Needs You

The default view. Shows only things that require a human decision — threshold warnings, goal approvals, blocked work. If nothing needs you, you see a calm empty state: "Agents are handling everything."

### All Work

Every goal in the system, with progress bars, status indicators, and step counts. Click any goal to open a detail panel with the full execution tree, agent roster, and timeline.

### Activity

Live stream of what agents are doing. Events appear in real-time with relative timestamps ("2m ago"). This is the closest thing to a chat log, but it's an observability feed, not a communication channel.

### Agents

Browse all agents in the mesh. Each card shows status (working/idle), current task, capabilities, tasks completed, and cost today. Click through to see full history and metrics.

### Graph

DAG visualization of how active goals connect to their working agents. Nodes are color-coded by status, edges show assignment relationships. Click any node to open its detail.

## The Command Bar

Press `Cmd+K` to open the command bar. It's the primary interaction surface:

**Search & Navigate**
- Type a goal name to jump to it
- Type "agents" to browse the mesh
- Navigate between views

**Natural Language Questions**
- "how's the deploy going?" — get a contextual summary
- "what's our spend?" — see budget status
- "status" — full system overview

**Commands**
- "create: migrate database to postgres 16" — create a goal from a sentence
- "rollback" — trigger deployment rollback
- "pause" — pause active deployments
- "dark mode" — toggle theme

**Goal Creation**

Type `create: [description]` and the system:
1. Creates the goal immediately
2. Simulates an agent picking it up (3s)
3. Simulates requirements analysis completing (8s)
4. Progress ring animates in the sidebar

In a real implementation, this input would go to an LLM that decomposes the goal into steps and routes to capable agents.

## Key Design Decisions

**No chat window.** The entire UI is structured around work, not conversation. Agents don't converse — they transform state.

**"Needs you" is the default view.** Most of the time, a human using this tool wants to know: is anything on fire, and do I need to decide something? If the answer is no, the view is empty. The best interface for an agent system is one you rarely need to look at.

**Everything is cross-linked.** Click an agent name in a goal's steps to see the agent's profile. Click "currently working on" in an agent profile to see the goal. Click a node in the graph to open its detail. Any entry point leads to full context in 1-2 clicks.

**Toast notifications, not pings.** Toasts fire for state transitions that matter — a canary expanding, a root cause found. The default is silence. Humans see signal, not noise.

**Dark mode is about attention state.** Operators who keep Fabric open in the background want it to recede. Dark mode makes the app ambient. Light mode is for active interaction. Toggle with `Cmd+D`.

## Running

```bash
# Install dependencies
npm install

# Build and launch
npm start

# Or build separately
npm run build
```

Requires Node.js 18+ and npm.

## Project Structure

```
src/
  main.ts                 # Electron main process
  preload.ts              # Context bridge
  renderer/
    index.html            # App shell
    renderer.ts           # UI logic, mock data, simulation
    styles.css            # Full design system with dark mode
```

## What This Is (and Isn't)

**This is a design prototype.** It's a fully interactive mockup with simulated data, live animations, and working UI. It demonstrates what an agent coordination tool could feel like.

**This is not a backend.** There's no agent runtime, no capability registry, no real goal decomposition. The mock data and simulation exist to make the UI feel alive so you can evaluate the design.

To make this real, you'd need:
- An agent runtime / orchestration engine (like Temporal, but agent-aware)
- A capability registry (like Consul, but with cost/latency/trust metadata)
- An LLM layer for natural language goal decomposition
- A policy engine for trust boundaries and escalation rules
- A wire protocol for agent-to-agent and agent-to-platform communication

## The Bigger Idea

The closest existing analogues to Fabric aren't chat apps — they're a hybrid of **service meshes** (Istio), **workflow engines** (Temporal), and **observability platforms** (Datadog), with a conversational interface for the humans who still need to supervise.

The hardest design problem is the **human-in-the-loop UX**: making a system optimized for machine-speed coordination still legible and controllable by the humans who own the goals. Fabric is one answer to that question.

Slack didn't win because it was the best IRC client. It won because it made coordination effortless for non-technical teams. The equivalent for agents would be making orchestration effortless for people who aren't distributed systems engineers — describe a goal in natural language, and the system figures out the rest.

---

Built with [Claude Code](https://claude.ai/claude-code).
