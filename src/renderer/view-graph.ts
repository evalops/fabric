import { state } from './state';
import { stringToColor } from './utils';
import { openGoalDetail, openAgentDetail } from './detail-panels';

function renderNode(
  n: { id: string; label: string; type: string; status?: string; progress?: number; outcome?: string; retryCount?: number; x: number; y: number; color: string },
  nodeW: number, nodeH: number,
  progressRing: (cx: number, cy: number, r: number, pct: number, color: string) => string
): string {
  const isGoal = n.type === "goal";
  const textX = n.x + (isGoal ? 36 : 30);
  const textY = n.y + (isGoal ? 22 : nodeH / 2 + 4);
  const outcomeLabel = n.outcome ? n.outcome.replace(/_/g, " ") : "";
  const truncLabel = n.label.length > 22 ? n.label.slice(0, 22) + "\u2026" : n.label;

  let indicator: string;
  if (isGoal && n.progress !== undefined) {
    indicator = progressRing(n.x + 18, n.y + nodeH / 2, 10, n.progress, n.color);
  } else {
    const pulse = (n.type === "agent" || n.status === "active") ? ' class="graph-pulse"' : "";
    indicator = `<circle cx="${n.x + 18}" cy="${n.y + nodeH / 2}" r="4" fill="${n.color}"${pulse} />`;
  }

  const retryBadge = (n.retryCount && n.retryCount > 0)
    ? `<circle cx="${n.x + nodeW - 8}" cy="${n.y + 8}" r="8" fill="var(--amber)" />
       <text x="${n.x + nodeW - 8}" y="${n.y + 12}" font-size="9" fill="white" text-anchor="middle" font-weight="600">${n.retryCount}</text>`
    : "";

  const subtitle = isGoal
    ? `<text x="${n.x + 36}" y="${n.y + 38}" font-size="10" fill="var(--text-muted)" font-family="var(--font-sans)">${n.status || ""}${outcomeLabel ? " \u00b7 " + outcomeLabel : ""}${n.progress !== undefined ? " \u00b7 " + Math.round(n.progress) + "%" : ""}</text>`
    : "";

  const opacity = n.status === "complete" ? ' opacity="0.7"' : "";

  return `
    <g class="graph-node" data-id="${n.id}" style="cursor: pointer;">
      <rect x="${n.x}" y="${n.y}" width="${nodeW}" height="${nodeH}" rx="8"
        fill="var(--bg-base)" stroke="${n.color}" stroke-width="${isGoal ? 2 : 1.5}"${opacity} />
      ${indicator}
      <text x="${textX}" y="${textY}" font-size="12" fill="var(--text-primary)"
        font-family="var(--font-sans)" font-weight="${isGoal ? "600" : "400"}">${truncLabel}</text>
      ${subtitle}
      ${retryBadge}
    </g>
  `;
}

export function renderGraph(): void {
  const feed = document.getElementById("feed")!;

  const nodeW = 200;
  const nodeH = 56;
  const gapX = 80;
  const gapY = 28;
  const padX = 40;
  const padY = 40;

  interface GNode {
    id: string;
    label: string;
    type: "goal" | "agent";
    status?: string;
    progress?: number;
    outcome?: string;
    col: number;
    row: number;
    x: number;
    y: number;
    color: string;
    retryCount?: number;
  }

  interface GEdge { from: string; to: string; }
  interface GDepEdge { from: string; to: string; depType: "blocks" | "enables" | "shares-area"; }

  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const depEdges: GDepEdge[] = [];

  // Show all goals, not just active ones
  state.goals.forEach((goal, gi) => {
    const statusColors: Record<string, string> = {
      active: "var(--blue)", complete: "var(--green)",
      blocked: "var(--amber)", failed: "var(--red)",
    };
    const goalNode: GNode = {
      id: goal.id, label: goal.title, type: "goal", status: goal.status,
      progress: goal.progress, outcome: goal.outcome, retryCount: goal.retryCount,
      col: 0, row: gi, x: padX, y: padY + gi * (nodeH + gapY + 40),
      color: statusColors[goal.status] || "var(--blue)",
    };
    nodes.push(goalNode);

    const goalAgentNames = [...new Set(goal.steps.filter(s => s.agent).map(s => s.agent!))];

    goalAgentNames.forEach((aName) => {
      const existingNode = nodes.find(n => n.id === `agent-${aName}`);
      if (existingNode) {
        edges.push({ from: goal.id, to: existingNode.id });
      } else {
        const agentNode: GNode = {
          id: `agent-${aName}`, label: aName, type: "agent",
          col: 1, row: nodes.filter(n => n.col === 1).length,
          x: padX + nodeW + gapX,
          y: padY + nodes.filter(n => n.col === 1).length * (nodeH + gapY),
          color: stringToColor(aName),
        };
        nodes.push(agentNode);
        edges.push({ from: goal.id, to: agentNode.id });
      }
    });
  });

  // Build dependency edges
  state.goals.forEach(goal => {
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
    state.goals.forEach(other => {
      if (other.id <= goal.id) return;
      const shared = other.areasAffected.filter(a => goal.areasAffected.includes(a));
      if (shared.length > 0) {
        depEdges.push({ from: goal.id, to: other.id, depType: "shares-area" });
      }
    });
  });

  // Layout: center agent column vertically
  const agentNodes = nodes.filter(n => n.col === 1);
  const goalNodes = nodes.filter(n => n.col === 0);
  const totalAgentHeight = agentNodes.length * (nodeH + gapY) - gapY;
  const totalGoalHeight = goalNodes.length * (nodeH + gapY + 40) - gapY;
  const agentStartY = padY + Math.max(0, (totalGoalHeight - totalAgentHeight) / 2);
  agentNodes.forEach((n, i) => { n.y = agentStartY + i * (nodeH + gapY); });

  const svgW = padX * 2 + nodeW * 2 + gapX;
  const svgH = Math.max(totalGoalHeight, totalAgentHeight) + padY * 2 + 20;
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // SVG progress ring helper
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

  feed.innerHTML = `
    <svg class="graph-svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" style="max-height: calc(100vh - 160px);">
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

      ${edges.map(e => {
        const from = nodeMap.get(e.from)!;
        const to = nodeMap.get(e.to)!;
        const x1 = from.x + nodeW;
        const y1 = from.y + nodeH / 2;
        const x2 = to.x;
        const y2 = to.y + nodeH / 2;
        const cx1 = x1 + gapX * 0.4;
        const cx2 = x2 - gapX * 0.4;
        return `<path d="M${x1},${y1} C${cx1},${y1} ${cx2},${y2} ${x2},${y2}"
          fill="none" stroke="var(--border-lit)" stroke-width="1.5" marker-end="url(#arrowhead)"
          class="graph-edge" />`;
      }).join("")}

      ${depEdges.map(e => {
        const from = nodeMap.get(e.from);
        const to = nodeMap.get(e.to);
        if (!from || !to) return "";
        const x1 = from.x + nodeW / 2;
        const y1 = from.y + nodeH;
        const x2 = to.x + nodeW / 2;
        const y2 = to.y;
        const color = e.depType === "blocks" ? "var(--amber)" : e.depType === "enables" ? "var(--green)" : "var(--border-lit)";
        const dash = e.depType === "shares-area" ? "4,4" : "none";
        const marker = e.depType === "blocks" ? "arrow-amber" : e.depType === "enables" ? "arrow-green" : "arrowhead";
        const midY = (y1 + y2) / 2;
        return `<path d="M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}"
          fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="${dash}"
          opacity="0.7" marker-end="url(#${marker})" />`;
      }).join("")}

      ${nodes.map(n => renderNode(n, nodeW, nodeH, progressRing)).join("")}
    </svg>
  `;

  feed.querySelectorAll(".graph-node").forEach(el => {
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
  });
}
