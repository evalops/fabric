import { state } from './state';
import { stringToColor, debounce, formatTokens, formatDuration } from './utils';
import { openGoalDetail, openAgentDetail } from './detail-panels';
import type { Goal, GoalStatus } from './types';

// ── Persistent graph state ───────────────────────────

type LayoutMode = "dependency" | "timeline" | "cost-map";
type NodeSizeMode = "uniform" | "cost" | "turns" | "tokens";
type GroupMode = "none" | "status" | "area" | "batch";

let prevGraphKeyHandler: ((e: KeyboardEvent) => void) | null = null;

const graphState = {
  layout: "dependency" as LayoutMode,
  nodeSize: "uniform" as NodeSizeMode,
  groupBy: "none" as GroupMode,
  statusFilter: new Set<GoalStatus>(["active", "complete", "blocked", "failed"]),
  showAgents: true,
  showDepEdges: true,
  showAreaEdges: false,
  searchQuery: "",
  // Pan & zoom
  zoom: 1,
  panX: 0,
  panY: 0,
  // Focus mode
  focusNodeId: null as string | null,
  focusDepth: 2,
};

// ── Helper types ─────────────────────────────────────

interface GNode {
  id: string;
  label: string;
  type: "goal" | "agent";
  status?: GoalStatus;
  progress?: number;
  outcome?: string;
  costUsd?: number;
  turnCount?: number;
  tokenCount?: number;
  col: number;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  retryCount?: number;
  area?: string;
  goalRef?: Goal;
}

interface GEdge { from: string; to: string; }
interface GDepEdge { from: string; to: string; depType: "blocks" | "enables" | "shares-area"; }

// ── Constants ────────────────────────────────────────

const BASE_NODE_W = 200;
const BASE_NODE_H = 56;
const GAP_X = 80;
const GAP_Y = 28;
const PAD_X = 40;
const PAD_Y = 60;

// ── Rendering ────────────────────────────────────────

function getNodeDimensions(n: GNode): { w: number; h: number } {
  if (graphState.nodeSize === "uniform") return { w: BASE_NODE_W, h: BASE_NODE_H };
  let scale = 1;
  switch (graphState.nodeSize) {
    case "cost": scale = n.costUsd ? Math.max(0.7, Math.min(2.0, 0.7 + (n.costUsd / 2))) : 0.7; break;
    case "turns": scale = n.turnCount ? Math.max(0.7, Math.min(2.0, 0.7 + (n.turnCount / 30))) : 0.7; break;
    case "tokens": scale = n.tokenCount ? Math.max(0.7, Math.min(2.0, 0.7 + (n.tokenCount / 100000))) : 0.7; break;
  }
  return { w: Math.round(BASE_NODE_W * scale), h: Math.round(BASE_NODE_H * Math.max(1, scale * 0.8)) };
}

function progressRing(cx: number, cy: number, r: number, pct: number, color: string): string {
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct / 100);
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="2" opacity="0.3" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="2.5"
      stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
      transform="rotate(-90 ${cx} ${cy})" stroke-linecap="round" />
  `;
}

function renderNode(n: GNode): string {
  const isGoal = n.type === "goal";
  const dim = getNodeDimensions(n);
  const textX = n.x + (isGoal ? 36 : 30);
  const textY = n.y + (isGoal ? 22 : dim.h / 2 + 4);
  const outcomeLabel = n.outcome ? n.outcome.replace(/_/g, " ") : "";
  const truncLabel = n.label.length > 22 ? n.label.slice(0, 22) + "\u2026" : n.label;

  let indicator: string;
  if (isGoal && n.progress !== undefined) {
    indicator = progressRing(n.x + 18, n.y + dim.h / 2, 10, n.progress, n.color);
  } else {
    const pulse = (n.type === "agent" || n.status === "active") ? ' class="graph-pulse"' : "";
    indicator = `<circle cx="${n.x + 18}" cy="${n.y + dim.h / 2}" r="4" fill="${n.color}"${pulse} />`;
  }

  const retryBadge = (n.retryCount && n.retryCount > 0)
    ? `<circle cx="${n.x + dim.w - 8}" cy="${n.y + 8}" r="8" fill="var(--amber)" />
       <text x="${n.x + dim.w - 8}" y="${n.y + 12}" font-size="9" fill="white" text-anchor="middle" font-weight="600">${n.retryCount}</text>`
    : "";

  // Subtitle line with metrics
  let subtitleParts: string[] = [];
  if (isGoal) {
    if (n.status) subtitleParts.push(n.status);
    if (outcomeLabel) subtitleParts.push(outcomeLabel);
    if (n.progress !== undefined) subtitleParts.push(Math.round(n.progress) + "%");
    if (n.costUsd !== undefined && n.costUsd > 0) subtitleParts.push("$" + n.costUsd.toFixed(2));
    if (n.turnCount !== undefined && n.turnCount > 0) subtitleParts.push(n.turnCount + "t");
  }
  const subtitle = subtitleParts.length > 0
    ? `<text x="${n.x + 36}" y="${n.y + 38}" font-size="10" fill="var(--text-muted)" font-family="var(--font-sans)">${subtitleParts.join(" \u00b7 ")}</text>`
    : "";

  const opacity = n.status === "complete" ? 0.8 : 1;

  return `
    <g class="graph-node" data-id="${n.id}" style="cursor: pointer; transition: opacity 0.2s;" opacity="${opacity}">
      <rect x="${n.x}" y="${n.y}" width="${dim.w}" height="${dim.h}" rx="8"
        fill="var(--bg-base)" stroke="${n.color}" stroke-width="${isGoal ? 2 : 1.5}" />
      ${indicator}
      <text x="${textX}" y="${textY}" font-size="12" fill="var(--text-primary)"
        font-family="var(--font-sans)" font-weight="${isGoal ? "600" : "400"}">${truncLabel}</text>
      ${subtitle}
      ${retryBadge}
    </g>
  `;
}

function renderEdge(from: GNode, to: GNode, color: string, dash: string, markerEnd: string): string {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const cx1 = x1 + GAP_X * 0.4;
  const cx2 = x2 - GAP_X * 0.4;
  return `<path d="M${x1},${y1} C${cx1},${y1} ${cx2},${y2} ${x2},${y2}"
    fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="${dash}"
    opacity="0.7" marker-end="url(#${markerEnd})" class="graph-edge"
    style="transition: opacity 0.2s;" />`;
}

function renderDepEdge(from: GNode, to: GNode, depType: string): string {
  const x1 = from.x + from.w / 2;
  const y1 = from.y + from.h;
  const x2 = to.x + to.w / 2;
  const y2 = to.y;
  const color = depType === "blocks" ? "var(--amber)" : depType === "enables" ? "var(--green)" : "var(--border-lit)";
  const dash = depType === "shares-area" ? "4,4" : "none";
  const marker = depType === "blocks" ? "arrow-amber" : depType === "enables" ? "arrow-green" : "arrowhead";
  const midY = (y1 + y2) / 2;
  const labelText = depType === "blocks" ? "blocks" : depType === "enables" ? "enables" : "shared";
  const labelX = (x1 + x2) / 2 + 6;
  const labelY = midY - 4;
  return `<path d="M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}"
    fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="${dash}"
    opacity="0.7" marker-end="url(#${marker})" class="graph-edge"
    style="transition: opacity 0.2s;" />
    <text x="${labelX}" y="${labelY}" class="graph-edge-label" fill="${color}">${labelText}</text>`;
}

// ── Layout engines ───────────────────────────────────

function layoutDependency(goals: Goal[], nodes: GNode[], edges: GEdge[], depEdges: GDepEdge[]): void {
  const groups = groupGoals(goals);
  let globalRow = 0;

  groups.forEach((group, gi) => {
    if (graphState.groupBy !== "none" && groups.length > 1) {
      globalRow += (gi > 0 ? 1 : 0);
    }

    group.goals.forEach((goal) => {
      const statusColors: Record<string, string> = {
        active: "var(--blue)", complete: "var(--green)",
        blocked: "var(--amber)", failed: "var(--red)",
      };
      const dim = getNodeDimensions({ costUsd: goal.costUsd, turnCount: goal.turnCount, tokenCount: goal.inputTokens + goal.outputTokens } as any);
      const goalNode: GNode = {
        id: goal.id, label: goal.title, type: "goal", status: goal.status as GoalStatus,
        progress: goal.progress, outcome: goal.outcome, retryCount: goal.retryCount,
        costUsd: goal.costUsd, turnCount: goal.turnCount,
        tokenCount: goal.inputTokens + goal.outputTokens,
        area: goal.areasAffected[0],
        col: 0, row: globalRow,
        x: PAD_X, y: PAD_Y + globalRow * (BASE_NODE_H + GAP_Y + 20),
        w: dim.w, h: dim.h,
        color: statusColors[goal.status] || "var(--blue)",
        goalRef: goal,
      };
      nodes.push(goalNode);
      globalRow++;

      if (graphState.showAgents) {
        const goalAgentNames = [...new Set(goal.steps.filter(s => s.agent).map(s => s.agent!))];
        goalAgentNames.forEach((aName) => {
          const existingNode = nodes.find(n => n.id === `agent-${aName}`);
          if (existingNode) {
            edges.push({ from: goal.id, to: existingNode.id });
          } else {
            const agentCol1Count = nodes.filter(n => n.col === 1).length;
            const agentNode: GNode = {
              id: `agent-${aName}`, label: aName, type: "agent",
              col: 1, row: agentCol1Count,
              x: PAD_X + BASE_NODE_W + GAP_X,
              y: PAD_Y + agentCol1Count * (BASE_NODE_H + GAP_Y),
              w: BASE_NODE_W, h: BASE_NODE_H,
              color: stringToColor(aName),
            };
            nodes.push(agentNode);
            edges.push({ from: goal.id, to: agentNode.id });
          }
        });
      }
    });
  });

  // Dependency edges
  goals.forEach(goal => {
    goal.blockedBy.forEach(depId => {
      if (nodes.find(n => n.id === depId)) {
        depEdges.push({ from: depId, to: goal.id, depType: "blocks" });
      }
    });
    goal.enables.forEach(enId => {
      if (nodes.find(n => n.id === enId)) {
        depEdges.push({ from: goal.id, to: enId, depType: "enables" });
      }
    });
    if (graphState.showAreaEdges) {
      goals.forEach(other => {
        if (other.id <= goal.id) return;
        const shared = other.areasAffected.filter(a => goal.areasAffected.includes(a));
        if (shared.length > 0) {
          depEdges.push({ from: goal.id, to: other.id, depType: "shares-area" });
        }
      });
    }
  });

  // Center agent column
  const agentNodes = nodes.filter(n => n.col === 1);
  const goalNodes = nodes.filter(n => n.col === 0);
  if (goalNodes.length > 0 && agentNodes.length > 0) {
    const totalGoalH = goalNodes[goalNodes.length - 1].y + goalNodes[goalNodes.length - 1].h - goalNodes[0].y;
    const totalAgentH = agentNodes.length * (BASE_NODE_H + GAP_Y) - GAP_Y;
    const agentStartY = PAD_Y + Math.max(0, (totalGoalH - totalAgentH) / 2);
    agentNodes.forEach((n, i) => { n.y = agentStartY + i * (BASE_NODE_H + GAP_Y); });
  }
}

function layoutTimeline(goals: Goal[], nodes: GNode[]): void {
  const sorted = [...goals].sort((a, b) => a.startedAt - b.startedAt);
  if (sorted.length === 0) return;

  const minTime = sorted[0].startedAt;
  const maxTime = Math.max(...sorted.map(g => g.completedAt || Date.now()));
  const timeSpan = maxTime - minTime || 1;
  const svgWidth = Math.max(800, sorted.length * 140);
  const lanes: { goalId: string; end: number }[][] = [];

  sorted.forEach((goal) => {
    const startX = PAD_X + ((goal.startedAt - minTime) / timeSpan) * (svgWidth - PAD_X * 2 - BASE_NODE_W);
    const endTime = goal.completedAt || Date.now();
    const barWidth = Math.max(BASE_NODE_W, ((endTime - goal.startedAt) / timeSpan) * (svgWidth - PAD_X * 2 - BASE_NODE_W));

    let laneIdx = lanes.findIndex(lane => lane.every(item => startX > item.end + 10));
    if (laneIdx === -1) { laneIdx = lanes.length; lanes.push([]); }
    lanes[laneIdx].push({ goalId: goal.id, end: startX + barWidth });

    const statusColors: Record<string, string> = {
      active: "var(--blue)", complete: "var(--green)",
      blocked: "var(--amber)", failed: "var(--red)",
    };
    const dim = getNodeDimensions({ costUsd: goal.costUsd, turnCount: goal.turnCount, tokenCount: goal.inputTokens + goal.outputTokens } as any);
    nodes.push({
      id: goal.id, label: goal.title, type: "goal", status: goal.status as GoalStatus,
      progress: goal.progress, outcome: goal.outcome, retryCount: goal.retryCount,
      costUsd: goal.costUsd, turnCount: goal.turnCount,
      tokenCount: goal.inputTokens + goal.outputTokens,
      area: goal.areasAffected[0],
      col: 0, row: laneIdx,
      x: startX, y: PAD_Y + 30 + laneIdx * (BASE_NODE_H + GAP_Y + 10),
      w: Math.max(dim.w, barWidth), h: dim.h,
      color: statusColors[goal.status] || "var(--blue)",
      goalRef: goal,
    });
  });
}

function layoutCostMap(goals: Goal[], nodes: GNode[]): void {
  const sorted = [...goals].sort((a, b) => b.costUsd - a.costUsd);
  const totalCost = sorted.reduce((s, g) => s + g.costUsd, 0) || 1;
  const mapW = 700;
  const mapH = 400;
  let curX = PAD_X;
  let curY = PAD_Y;
  let rowH = 0;

  sorted.forEach((goal) => {
    const fraction = goal.costUsd / totalCost;
    const area = fraction * mapW * mapH;
    const nodeW = Math.max(120, Math.min(mapW, Math.sqrt(area * 1.6)));
    const nodeH = Math.max(50, area / nodeW);

    if (curX + nodeW > PAD_X + mapW) { curX = PAD_X; curY += rowH + 8; rowH = 0; }

    const statusColors: Record<string, string> = {
      active: "var(--blue)", complete: "var(--green)",
      blocked: "var(--amber)", failed: "var(--red)",
    };
    nodes.push({
      id: goal.id, label: goal.title, type: "goal", status: goal.status as GoalStatus,
      progress: goal.progress, outcome: goal.outcome, retryCount: goal.retryCount,
      costUsd: goal.costUsd, turnCount: goal.turnCount,
      tokenCount: goal.inputTokens + goal.outputTokens,
      area: goal.areasAffected[0],
      col: 0, row: 0,
      x: curX, y: curY,
      w: Math.round(nodeW), h: Math.round(nodeH),
      color: statusColors[goal.status] || "var(--blue)",
      goalRef: goal,
    });
    curX += nodeW + 8;
    rowH = Math.max(rowH, nodeH);
  });
}

// ── Grouping ─────────────────────────────────────────

interface GoalGroup { label: string; goals: Goal[]; }

function groupGoals(goals: Goal[]): GoalGroup[] {
  if (graphState.groupBy === "none") return [{ label: "", goals }];
  const map = new Map<string, Goal[]>();
  goals.forEach(g => {
    let key: string;
    switch (graphState.groupBy) {
      case "status": key = g.status; break;
      case "area": key = g.areasAffected[0] || "unscoped"; break;
      case "batch": key = (g as any).batchId || "standalone"; break;
      default: key = "all";
    }
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(g);
  });
  return [...map.entries()].map(([label, goals]) => ({ label, goals }));
}

// ── Stats bar ────────────────────────────────────────

function renderStatsBar(goals: Goal[]): string {
  const active = goals.filter(g => g.status === "active").length;
  const complete = goals.filter(g => g.status === "complete").length;
  const blocked = goals.filter(g => g.status === "blocked").length;
  const failed = goals.filter(g => g.status === "failed").length;
  const totalCost = goals.reduce((s, g) => s + g.costUsd, 0);
  const totalTurns = goals.reduce((s, g) => s + g.turnCount, 0);
  const avgCost = goals.length > 0 ? totalCost / goals.length : 0;

  return `<div class="graph-stats-bar">
    <div class="graph-stat"><span class="graph-stat-value" style="color:var(--blue)">${active}</span><span class="graph-stat-label">active</span></div>
    <div class="graph-stat"><span class="graph-stat-value" style="color:var(--green)">${complete}</span><span class="graph-stat-label">done</span></div>
    <div class="graph-stat"><span class="graph-stat-value" style="color:var(--amber)">${blocked}</span><span class="graph-stat-label">blocked</span></div>
    <div class="graph-stat"><span class="graph-stat-value" style="color:var(--red)">${failed}</span><span class="graph-stat-label">failed</span></div>
    <div class="graph-stat-divider"></div>
    <div class="graph-stat"><span class="graph-stat-value">$${totalCost.toFixed(2)}</span><span class="graph-stat-label">total cost</span></div>
    <div class="graph-stat"><span class="graph-stat-value">${totalTurns}</span><span class="graph-stat-label">turns</span></div>
    <div class="graph-stat"><span class="graph-stat-value">$${avgCost.toFixed(2)}</span><span class="graph-stat-label">avg/goal</span></div>
  </div>`;
}

// ── Toolbar ──────────────────────────────────────────

function renderToolbar(): string {
  const layoutOptions = [
    { value: "dependency", label: "Dependency Graph" },
    { value: "timeline", label: "Timeline" },
    { value: "cost-map", label: "Cost Map" },
  ];
  const sizeOptions = [
    { value: "uniform", label: "Uniform" },
    { value: "cost", label: "By Cost" },
    { value: "turns", label: "By Turns" },
    { value: "tokens", label: "By Tokens" },
  ];
  const groupOptions = [
    { value: "none", label: "No Grouping" },
    { value: "status", label: "By Status" },
    { value: "area", label: "By Area" },
    { value: "batch", label: "By Batch" },
  ];

  const statusFilters: { status: GoalStatus; color: string; label: string }[] = [
    { status: "active", color: "var(--blue)", label: "Active" },
    { status: "complete", color: "var(--green)", label: "Done" },
    { status: "blocked", color: "var(--amber)", label: "Blocked" },
    { status: "failed", color: "var(--red)", label: "Failed" },
  ];

  return `<div class="graph-toolbar">
    <div class="graph-toolbar-row">
      <div class="graph-toolbar-group">
        <label class="graph-toolbar-label">Layout</label>
        <select class="graph-toolbar-select" id="graph-layout">
          ${layoutOptions.map(o => `<option value="${o.value}"${graphState.layout === o.value ? " selected" : ""}>${o.label}</option>`).join("")}
        </select>
      </div>
      <div class="graph-toolbar-group">
        <label class="graph-toolbar-label">Node Size</label>
        <select class="graph-toolbar-select" id="graph-node-size">
          ${sizeOptions.map(o => `<option value="${o.value}"${graphState.nodeSize === o.value ? " selected" : ""}>${o.label}</option>`).join("")}
        </select>
      </div>
      <div class="graph-toolbar-group">
        <label class="graph-toolbar-label">Group By</label>
        <select class="graph-toolbar-select" id="graph-group-by">
          ${groupOptions.map(o => `<option value="${o.value}"${graphState.groupBy === o.value ? " selected" : ""}>${o.label}</option>`).join("")}
        </select>
      </div>
      <div class="graph-toolbar-group">
        <label class="graph-toolbar-label">Search</label>
        <input class="graph-toolbar-input" id="graph-search" type="text" placeholder="Filter goals..." value="${graphState.searchQuery}" />
      </div>
    </div>
    <div class="graph-toolbar-row">
      <div class="graph-toolbar-group">
        <label class="graph-toolbar-label">Status</label>
        <div class="graph-status-filters">
          ${statusFilters.map(sf => `
            <button class="graph-status-btn${graphState.statusFilter.has(sf.status) ? " active" : ""}" data-status="${sf.status}" style="--btn-color: ${sf.color}">
              ${sf.label}
            </button>
          `).join("")}
        </div>
      </div>
      <div class="graph-toolbar-group graph-toolbar-toggles">
        <label class="graph-toggle"><input type="checkbox" id="graph-show-agents" ${graphState.showAgents ? "checked" : ""} /> Agents</label>
        <label class="graph-toggle"><input type="checkbox" id="graph-show-deps" ${graphState.showDepEdges ? "checked" : ""} /> Dependencies</label>
        <label class="graph-toggle"><input type="checkbox" id="graph-show-areas" ${graphState.showAreaEdges ? "checked" : ""} /> Shared Areas</label>
      </div>
    </div>
  </div>`;
}

// ── Legend ────────────────────────────────────────────

function renderLegend(): string {
  return `<div class="graph-legend">
    <div class="graph-legend-item"><span class="graph-legend-dot" style="background: var(--blue)"></span> Active</div>
    <div class="graph-legend-item"><span class="graph-legend-dot" style="background: var(--green)"></span> Complete</div>
    <div class="graph-legend-item"><span class="graph-legend-dot" style="background: var(--amber)"></span> Blocked</div>
    <div class="graph-legend-item"><span class="graph-legend-dot" style="background: var(--red)"></span> Failed</div>
    <div class="graph-legend-divider"></div>
    <div class="graph-legend-item"><span class="graph-legend-line" style="background: var(--border-lit)"></span> Agent link</div>
    <div class="graph-legend-item"><span class="graph-legend-line" style="background: var(--amber)"></span> Blocks</div>
    <div class="graph-legend-item"><span class="graph-legend-line" style="background: var(--green)"></span> Enables</div>
    <div class="graph-legend-item"><span class="graph-legend-line graph-legend-dash" style="background: var(--border-lit)"></span> Shared area</div>
    <div class="graph-legend-divider"></div>
    <span style="font-size: 10px; color: var(--text-muted);">Scroll to zoom \u00b7 Drag to pan \u00b7 Dbl-click to focus</span>
  </div>`;
}

// ── Group headers (SVG) ──────────────────────────────

function renderGroupHeaders(groups: GoalGroup[], nodes: GNode[]): string {
  if (graphState.groupBy === "none" || groups.length <= 1) return "";
  return groups.map(group => {
    const groupNodes = nodes.filter(n => n.goalRef && group.goals.some(g => g.id === n.id));
    if (groupNodes.length === 0) return "";
    const minY = Math.min(...groupNodes.map(n => n.y));
    return `<text x="${PAD_X}" y="${minY - 8}" font-size="11" fill="var(--text-muted)"
      font-family="var(--font-sans)" font-weight="600" text-transform="uppercase"
      letter-spacing="0.5">${group.label.toUpperCase()}</text>`;
  }).join("");
}

// ── Focus mode helpers ────────────────────────────────

function getNeighborhood(nodeId: string, edges: GEdge[], depEdges: GDepEdge[], depth: number): Set<string> {
  const visited = new Set<string>([nodeId]);
  let frontier = [nodeId];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of edges) {
        if (e.from === id && !visited.has(e.to)) { visited.add(e.to); next.push(e.to); }
        if (e.to === id && !visited.has(e.from)) { visited.add(e.from); next.push(e.from); }
      }
      for (const e of depEdges) {
        if (e.from === id && !visited.has(e.to)) { visited.add(e.to); next.push(e.to); }
        if (e.to === id && !visited.has(e.from)) { visited.add(e.from); next.push(e.from); }
      }
    }
    frontier = next;
    if (next.length === 0) break;
  }
  return visited;
}

// ── Tooltip content builder ──────────────────────────

function buildTooltipHtml(n: GNode): string {
  if (n.type === "agent") {
    const agent = state.agents.find(a => a.name === n.label);
    return `<div class="graph-tooltip-title">${n.label}</div>
      <div class="graph-tooltip-row"><span class="tt-label">Status</span><span class="tt-value">${agent?.status || "unknown"}</span></div>
      <div class="graph-tooltip-row"><span class="tt-label">Tasks</span><span class="tt-value">${agent?.tasksCompleted || 0}</span></div>
      <div class="graph-tooltip-row"><span class="tt-label">Success</span><span class="tt-value">${agent?.successRate || 0}%</span></div>`;
  }
  const g = n.goalRef;
  if (!g) return `<div class="graph-tooltip-title">${n.label}</div>`;

  const doneSteps = g.steps.filter(s => s.state === "done").length;
  const toolErrors = g.toolCalls.filter(tc => !tc.success).length;

  return `<div class="graph-tooltip-title">${g.title}</div>
    <div class="graph-tooltip-row"><span class="tt-label">Status</span><span class="tt-value" style="color:${n.color}">${g.status}${g.outcome ? " \u00b7 " + g.outcome.replace(/_/g, " ") : ""}</span></div>
    <div class="graph-tooltip-row"><span class="tt-label">Progress</span><span class="tt-value">${Math.round(g.progress)}%</span></div>
    <div class="graph-tooltip-bar"><div class="graph-tooltip-bar-fill" style="width:${g.progress}%;background:${n.color}"></div></div>
    <div class="graph-tooltip-row"><span class="tt-label">Cost</span><span class="tt-value">$${g.costUsd.toFixed(2)}</span></div>
    <div class="graph-tooltip-row"><span class="tt-label">Tokens</span><span class="tt-value">${formatTokens(g.inputTokens + g.outputTokens)}</span></div>
    <div class="graph-tooltip-row"><span class="tt-label">Steps</span><span class="tt-value">${doneSteps}/${g.steps.length}</span></div>
    <div class="graph-tooltip-row"><span class="tt-label">Turns</span><span class="tt-value">${g.turnCount}</span></div>
    <div class="graph-tooltip-row"><span class="tt-label">Tools</span><span class="tt-value">${g.toolCalls.length}${toolErrors > 0 ? ` (${toolErrors} err)` : ""}</span></div>
    ${g.retryCount > 0 ? `<div class="graph-tooltip-row"><span class="tt-label">Retries</span><span class="tt-value" style="color:var(--amber)">${g.retryCount}</span></div>` : ""}
    <div class="graph-tooltip-row"><span class="tt-label">Duration</span><span class="tt-value">${formatDuration(g.startedAt, g.completedAt)}</span></div>
    ${g.steps.length > 0 ? `<div class="graph-tooltip-steps">${g.steps.map(s => {
      const c = s.state === "done" ? "var(--green)" : s.state === "running" ? "var(--blue)" : s.state === "failed" ? "var(--red)" : "var(--border)";
      return `<div class="graph-tooltip-step" style="background:${c}" title="${s.name}: ${s.state}"></div>`;
    }).join("")}</div>` : ""}`;
}

// ── Minimap renderer ─────────────────────────────────

function renderMinimapSvg(nodes: GNode[], svgW: number, svgH: number): string {
  if (nodes.length === 0) return "";
  const mmW = 136;
  const mmH = 86;
  const scaleX = mmW / svgW;
  const scaleY = mmH / svgH;
  const scale = Math.min(scaleX, scaleY);
  return `<svg width="${mmW}" height="${mmH}" viewBox="0 0 ${mmW} ${mmH}">
    ${nodes.map(n => {
      const x = n.x * scale;
      const y = n.y * scale;
      const w = Math.max(2, n.w * scale);
      const h = Math.max(2, n.h * scale);
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="${n.color}" opacity="0.7" />`;
    }).join("")}
  </svg>`;
}

// ── Main render ──────────────────────────────────────

export function renderGraph(): void {
  const feed = document.getElementById("feed")!;

  // Filter goals
  let filteredGoals = state.goals.filter(g => graphState.statusFilter.has(g.status as GoalStatus));
  if (graphState.searchQuery) {
    const q = graphState.searchQuery.toLowerCase();
    filteredGoals = filteredGoals.filter(g =>
      g.title.toLowerCase().includes(q) ||
      g.summary.toLowerCase().includes(q) ||
      g.areasAffected.some(a => a.toLowerCase().includes(q))
    );
  }

  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const depEdges: GDepEdge[] = [];

  switch (graphState.layout) {
    case "dependency": layoutDependency(filteredGoals, nodes, edges, depEdges); break;
    case "timeline": layoutTimeline(filteredGoals, nodes); break;
    case "cost-map": layoutCostMap(filteredGoals, nodes); break;
  }

  // Focus mode — determine neighborhood
  let focusNeighborhood: Set<string> | null = null;
  const focusNode = graphState.focusNodeId ? nodes.find(n => n.id === graphState.focusNodeId) : null;
  if (graphState.focusNodeId && focusNode) {
    focusNeighborhood = getNeighborhood(graphState.focusNodeId, edges, depEdges, graphState.focusDepth);
  }

  // SVG dimensions
  const maxX = Math.max(600, ...nodes.map(n => n.x + n.w));
  const maxY = Math.max(300, ...nodes.map(n => n.y + n.h));
  const svgW = maxX + PAD_X;
  const svgH = maxY + PAD_Y + 20;
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const groups = groupGoals(filteredGoals);

  // Timeline axis
  let timelineAxis = "";
  if (graphState.layout === "timeline" && filteredGoals.length > 0) {
    const sorted = [...filteredGoals].sort((a, b) => a.startedAt - b.startedAt);
    const minTime = sorted[0].startedAt;
    const maxTime = Math.max(...sorted.map(g => g.completedAt || Date.now()));
    const ticks = 6;
    const axisLabels: string[] = [];
    for (let i = 0; i <= ticks; i++) {
      const t = minTime + (maxTime - minTime) * (i / ticks);
      const d = new Date(t);
      const label = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
      const x = PAD_X + ((t - minTime) / (maxTime - minTime || 1)) * (svgW - PAD_X * 2 - BASE_NODE_W);
      axisLabels.push(`<text x="${x}" y="${PAD_Y + 20}" font-size="10" fill="var(--text-muted)" font-family="var(--font-mono)" text-anchor="middle">${label}</text>`);
      axisLabels.push(`<line x1="${x}" y1="${PAD_Y + 24}" x2="${x}" y2="${svgH - PAD_Y}" stroke="var(--border)" stroke-width="0.5" opacity="0.4" />`);
    }
    timelineAxis = axisLabels.join("");
  }

  // Focus mode bar
  const focusBar = focusNode ? `
    <div class="graph-focus-bar">
      <span class="focus-label">Focus</span>
      <span class="focus-title">${focusNode.label}</span>
      <span class="focus-depth">
        Depth <input type="range" id="focus-depth" min="1" max="5" value="${graphState.focusDepth}" />
        <span id="focus-depth-val">${graphState.focusDepth}</span>
      </span>
      <button class="focus-exit" id="focus-exit">Exit focus</button>
    </div>
  ` : "";

  const isInFocus = (id: string) => !focusNeighborhood || focusNeighborhood.has(id);

  feed.innerHTML = `
    ${renderToolbar()}
    ${renderStatsBar(filteredGoals)}
    ${focusBar}
    <div class="graph-container" id="graph-container">
      <svg class="graph-svg" id="graph-svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}">
        <g id="graph-world" transform="translate(${graphState.panX},${graphState.panY}) scale(${graphState.zoom})">
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="var(--border-lit)" />
            </marker>
            <marker id="arrow-amber" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="var(--amber)" opacity="0.7" />
            </marker>
            <marker id="arrow-green" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="var(--green)" opacity="0.7" />
            </marker>
          </defs>

          ${timelineAxis}
          ${renderGroupHeaders(groups, nodes)}

          ${graphState.showDepEdges ? depEdges.map(e => {
            const from = nodeMap.get(e.from);
            const to = nodeMap.get(e.to);
            if (!from || !to) return "";
            return renderDepEdge(from, to, e.depType);
          }).join("") : ""}

          ${edges.map(e => {
            const from = nodeMap.get(e.from);
            const to = nodeMap.get(e.to);
            if (!from || !to) return "";
            return renderEdge(from, to, "var(--border-lit)", "none", "arrowhead");
          }).join("")}

          ${nodes.map(n => renderNode(n)).join("")}
        </g>
      </svg>
      <div class="graph-tooltip" id="graph-tooltip"></div>
      <div class="graph-minimap" id="graph-minimap">
        ${renderMinimapSvg(nodes, svgW, svgH)}
        <div class="graph-minimap-viewport" id="minimap-viewport"></div>
      </div>
      <div class="graph-zoom-controls">
        <button class="graph-zoom-btn" id="zoom-in" title="Zoom in (+)">+</button>
        <div class="graph-zoom-level" id="zoom-level">${Math.round(graphState.zoom * 100)}%</div>
        <button class="graph-zoom-btn" id="zoom-out" title="Zoom out (-)">&#x2212;</button>
        <button class="graph-zoom-btn" id="zoom-fit" title="Fit all (0)" style="font-size: 11px; margin-top: 4px; border-radius: var(--radius-xs);">Fit</button>
      </div>
    </div>
    ${renderLegend()}
  `;

  // ── Wire interactions ────────────────────────────

  const edgeLookup = new Map<string, Set<string>>();
  const addEdgeLink = (a: string, b: string) => {
    if (!edgeLookup.has(a)) edgeLookup.set(a, new Set());
    if (!edgeLookup.has(b)) edgeLookup.set(b, new Set());
    edgeLookup.get(a)!.add(b);
    edgeLookup.get(b)!.add(a);
  };
  edges.forEach(e => addEdgeLink(e.from, e.to));
  depEdges.forEach(e => addEdgeLink(e.from, e.to));

  const allNodeEls = feed.querySelectorAll(".graph-node");
  const allEdgeEls = feed.querySelectorAll(".graph-edge");
  const tooltip = document.getElementById("graph-tooltip")!;
  const container = document.getElementById("graph-container")!;
  const worldG = document.getElementById("graph-world")!;

  // Apply focus dimming
  if (focusNeighborhood) {
    allNodeEls.forEach(n => {
      if (!isInFocus((n as HTMLElement).dataset.id!)) (n as SVGGElement).setAttribute("opacity", "0.12");
    });
    allEdgeEls.forEach(e => (e as SVGElement).setAttribute("opacity", "0.06"));
  }

  // ── Pan & Zoom ────────────────────────────────

  function applyTransform(): void {
    worldG.setAttribute("transform", `translate(${graphState.panX},${graphState.panY}) scale(${graphState.zoom})`);
    const zoomLabel = document.getElementById("zoom-level");
    if (zoomLabel) zoomLabel.textContent = `${Math.round(graphState.zoom * 100)}%`;
    updateMinimapViewport();
  }

  function zoomBy(delta: number, cx?: number, cy?: number): void {
    const oldZoom = graphState.zoom;
    graphState.zoom = Math.max(0.2, Math.min(5, graphState.zoom + delta));
    if (cx !== undefined && cy !== undefined) {
      const ratio = graphState.zoom / oldZoom;
      graphState.panX = cx - ratio * (cx - graphState.panX);
      graphState.panY = cy - ratio * (cy - graphState.panY);
    }
    applyTransform();
  }

  function fitAll(): void {
    const rect = container.getBoundingClientRect();
    if (nodes.length === 0) return;
    graphState.zoom = Math.min(rect.width / svgW, rect.height / svgH, 1.5) * 0.9;
    graphState.panX = (rect.width - svgW * graphState.zoom) / 2;
    graphState.panY = (rect.height - svgH * graphState.zoom) / 2;
    applyTransform();
  }

  function updateMinimapViewport(): void {
    const vp = document.getElementById("minimap-viewport");
    if (!vp) return;
    const mmW = 136, mmH = 86;
    const scale = Math.min(mmW / svgW, mmH / svgH);
    const cRect = container.getBoundingClientRect();
    const vpX = (-graphState.panX / graphState.zoom) * scale;
    const vpY = (-graphState.panY / graphState.zoom) * scale;
    const vpW = (cRect.width / graphState.zoom) * scale;
    const vpH = (cRect.height / graphState.zoom) * scale;
    vp.style.left = `${Math.max(0, vpX)}px`;
    vp.style.top = `${Math.max(0, vpY)}px`;
    vp.style.width = `${Math.min(mmW, vpW)}px`;
    vp.style.height = `${Math.min(mmH, vpH)}px`;
  }

  // Wheel zoom
  container.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const rect = container.getBoundingClientRect();
    zoomBy(delta, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  // Drag to pan
  let isPanning = false;
  let panStartX = 0, panStartY = 0, panStartPX = 0, panStartPY = 0;

  container.addEventListener("pointerdown", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".graph-node") || target.closest(".graph-zoom-controls") || target.closest(".graph-minimap")) return;
    isPanning = true;
    panStartX = e.clientX; panStartY = e.clientY;
    panStartPX = graphState.panX; panStartPY = graphState.panY;
    container.classList.add("panning");
    container.setPointerCapture(e.pointerId);
  });
  container.addEventListener("pointermove", (e) => {
    if (!isPanning) return;
    graphState.panX = panStartPX + (e.clientX - panStartX);
    graphState.panY = panStartPY + (e.clientY - panStartY);
    applyTransform();
  });
  container.addEventListener("pointerup", (e) => {
    if (!isPanning) return;
    isPanning = false;
    container.classList.remove("panning");
    if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
  });

  // Zoom buttons
  document.getElementById("zoom-in")?.addEventListener("click", () => zoomBy(0.2));
  document.getElementById("zoom-out")?.addEventListener("click", () => zoomBy(-0.2));
  document.getElementById("zoom-fit")?.addEventListener("click", fitAll);

  // Minimap click-to-pan
  const minimap = document.getElementById("graph-minimap");
  if (minimap) {
    minimap.addEventListener("click", (e) => {
      const mmRect = minimap.getBoundingClientRect();
      const scale = Math.min(136 / svgW, 86 / svgH);
      const clickX = (e.clientX - mmRect.left) / scale;
      const clickY = (e.clientY - mmRect.top) / scale;
      const cRect = container.getBoundingClientRect();
      graphState.panX = -(clickX * graphState.zoom - cRect.width / 2);
      graphState.panY = -(clickY * graphState.zoom - cRect.height / 2);
      applyTransform();
    });
  }

  requestAnimationFrame(updateMinimapViewport);

  // ── Node interactions ────────────────────────────

  allNodeEls.forEach(el => {
    el.addEventListener("click", () => {
      const id = (el as HTMLElement).dataset.id!;
      if (id.startsWith("agent-")) {
        const agentName = id.replace("agent-", "");
        const agent = state.agents.find(a => a.name === agentName);
        if (agent) openAgentDetail(agent.id);
      } else {
        openGoalDetail(id);
      }
    });

    // Double click → focus mode
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const id = (el as HTMLElement).dataset.id!;
      graphState.focusNodeId = graphState.focusNodeId === id ? null : id;
      renderGraph();
    });

    // Hover → tooltip + highlight
    el.addEventListener("mouseenter", () => {
      const hovId = (el as HTMLElement).dataset.id!;
      const node = nodes.find(n => n.id === hovId);
      if (node) {
        tooltip.innerHTML = buildTooltipHtml(node);
        tooltip.classList.add("visible");
        const cRect = container.getBoundingClientRect();
        const elRect = (el as SVGGElement).getBoundingClientRect();
        let tx = elRect.right - cRect.left + 8;
        let ty = elRect.top - cRect.top;
        if (tx + 280 > cRect.width) tx = elRect.left - cRect.left - 288;
        if (ty + 200 > cRect.height) ty = cRect.height - 210;
        tooltip.style.left = `${Math.max(4, tx)}px`;
        tooltip.style.top = `${Math.max(4, ty)}px`;
      }
      const connected = edgeLookup.get(hovId) || new Set<string>();
      allNodeEls.forEach(n => {
        const nId = (n as HTMLElement).dataset.id!;
        const inFocus = isInFocus(nId);
        (n as SVGGElement).setAttribute("opacity", nId === hovId || connected.has(nId) ? "1" : inFocus ? "0.25" : "0.08");
      });
      allEdgeEls.forEach(edge => (edge as SVGElement).setAttribute("opacity", "0.08"));
    });
    el.addEventListener("mouseleave", () => {
      tooltip.classList.remove("visible");
      allNodeEls.forEach(n => {
        const nId = (n as HTMLElement).dataset.id!;
        const goalNode = nodes.find(nd => nd.id === nId);
        const inFocus = isInFocus(nId);
        (n as SVGGElement).setAttribute("opacity", !inFocus ? "0.12" : goalNode?.status === "complete" ? "0.8" : "1");
      });
      allEdgeEls.forEach(edge => (edge as SVGElement).setAttribute("opacity", focusNeighborhood ? "0.06" : "0.7"));
    });
  });

  // ── Focus mode controls ────────────────────────

  document.getElementById("focus-exit")?.addEventListener("click", () => {
    graphState.focusNodeId = null;
    renderGraph();
  });
  const depthSlider = document.getElementById("focus-depth") as HTMLInputElement | null;
  if (depthSlider) {
    depthSlider.addEventListener("input", () => {
      graphState.focusDepth = parseInt(depthSlider.value);
      const depthLabel = document.getElementById("focus-depth-val");
      if (depthLabel) depthLabel.textContent = depthSlider.value;
      renderGraph();
    });
  }

  // ── Toolbar controls ────────────────────────────

  (document.getElementById("graph-layout") as HTMLSelectElement)?.addEventListener("change", (e) => {
    graphState.layout = (e.target as HTMLSelectElement).value as LayoutMode;
    graphState.panX = 0; graphState.panY = 0; graphState.zoom = 1;
    renderGraph();
  });
  (document.getElementById("graph-node-size") as HTMLSelectElement)?.addEventListener("change", (e) => {
    graphState.nodeSize = (e.target as HTMLSelectElement).value as NodeSizeMode;
    renderGraph();
  });
  (document.getElementById("graph-group-by") as HTMLSelectElement)?.addEventListener("change", (e) => {
    graphState.groupBy = (e.target as HTMLSelectElement).value as GroupMode;
    renderGraph();
  });

  const searchInput = document.getElementById("graph-search") as HTMLInputElement;
  const debouncedGraphSearch = debounce(() => {
    graphState.searchQuery = searchInput.value;
    renderGraph();
  }, 200);
  searchInput?.addEventListener("input", debouncedGraphSearch);

  feed.querySelectorAll(".graph-status-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const status = (btn as HTMLElement).dataset.status as GoalStatus;
      if (graphState.statusFilter.has(status)) graphState.statusFilter.delete(status);
      else graphState.statusFilter.add(status);
      renderGraph();
    });
  });

  (document.getElementById("graph-show-agents") as HTMLInputElement)?.addEventListener("change", (e) => {
    graphState.showAgents = (e.target as HTMLInputElement).checked; renderGraph();
  });
  (document.getElementById("graph-show-deps") as HTMLInputElement)?.addEventListener("change", (e) => {
    graphState.showDepEdges = (e.target as HTMLInputElement).checked; renderGraph();
  });
  (document.getElementById("graph-show-areas") as HTMLInputElement)?.addEventListener("change", (e) => {
    graphState.showAreaEdges = (e.target as HTMLInputElement).checked; renderGraph();
  });

  // ── Keyboard shortcuts (cleanup previous listener to avoid leaks) ──

  if (prevGraphKeyHandler) document.removeEventListener("keydown", prevGraphKeyHandler);
  prevGraphKeyHandler = (e: KeyboardEvent) => {
    if (state.currentView !== "graph") return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "=" || e.key === "+") { e.preventDefault(); zoomBy(0.15); }
    else if (e.key === "-") { e.preventDefault(); zoomBy(-0.15); }
    else if (e.key === "0") { e.preventDefault(); graphState.zoom = 1; graphState.panX = 0; graphState.panY = 0; applyTransform(); }
    else if (e.key === "f" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); fitAll(); }
    else if (e.key === "Escape" && graphState.focusNodeId) { e.preventDefault(); graphState.focusNodeId = null; renderGraph(); }
  };
  document.addEventListener("keydown", prevGraphKeyHandler);

  // Auto-fit on first render with many nodes
  if (nodes.length > 4 && graphState.zoom === 1 && graphState.panX === 0 && graphState.panY === 0) {
    requestAnimationFrame(fitAll);
  }
}
