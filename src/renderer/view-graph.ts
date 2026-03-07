import { state } from './state';
import { stringToColor } from './utils';
import { openGoalDetail, openAgentDetail } from './detail-panels';

export function renderGraph(): void {
  const feed = document.getElementById("feed")!;

  const nodeW = 180;
  const nodeH = 48;
  const gapX = 60;
  const gapY = 24;
  const padX = 40;
  const padY = 40;

  interface GNode {
    id: string;
    label: string;
    type: "goal" | "agent";
    status?: string;
    col: number;
    row: number;
    x: number;
    y: number;
    color: string;
  }

  interface GEdge { from: string; to: string; }
  interface GDepEdge { from: string; to: string; depType: "blocks" | "enables" | "shares-area"; }

  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const depEdges: GDepEdge[] = [];

  const activeGoals = state.goals.filter(g => g.status !== "complete");

  activeGoals.forEach((goal, gi) => {
    const goalNode: GNode = {
      id: goal.id, label: goal.title, type: "goal", status: goal.status,
      col: 0, row: gi, x: padX, y: padY + gi * (nodeH + gapY + 60),
      color: goal.status === "blocked" ? "var(--amber)" : "var(--blue)",
    };
    nodes.push(goalNode);

    const goalAgentNames = [...new Set(goal.steps.filter(s => s.agent && (s.state === "running" || s.state === "warn")).map(s => s.agent!))];

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

  activeGoals.forEach(goal => {
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
    activeGoals.forEach(other => {
      if (other.id <= goal.id) return;
      const shared = other.areasAffected.filter(a => goal.areasAffected.includes(a));
      if (shared.length > 0) {
        depEdges.push({ from: goal.id, to: other.id, depType: "shares-area" });
      }
    });
  });

  const agentNodes = nodes.filter(n => n.col === 1);
  const totalAgentHeight = agentNodes.length * (nodeH + gapY) - gapY;
  const totalGoalHeight = activeGoals.length * (nodeH + gapY + 60) - gapY;
  const agentStartY = padY + Math.max(0, (totalGoalHeight - totalAgentHeight) / 2);
  agentNodes.forEach((n, i) => { n.y = agentStartY + i * (nodeH + gapY); });

  const svgW = padX * 2 + nodeW * 2 + gapX;
  const svgH = Math.max(totalGoalHeight, totalAgentHeight) + padY * 2;
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  feed.innerHTML = `
    <svg class="graph-svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" style="max-height: calc(100vh - 160px);">
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="var(--border-lit)" />
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
        const midY = (y1 + y2) / 2;
        return `<path d="M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}"
          fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="${dash}"
          opacity="0.7" marker-end="url(#arrowhead)" />`;
      }).join("")}

      ${nodes.map(n => `
        <g class="graph-node" data-id="${n.id}" style="cursor: pointer;">
          <rect x="${n.x}" y="${n.y}" width="${nodeW}" height="${nodeH}" rx="8"
            fill="var(--bg-base)" stroke="${n.color}" stroke-width="${n.type === "goal" ? 2 : 1.5}" />
          <circle cx="${n.x + 14}" cy="${n.y + nodeH / 2}" r="4" fill="${n.color}"
            ${n.type === "agent" || (n.status === "active") ? 'class="graph-pulse"' : ""} />
          <text x="${n.x + 26}" y="${n.y + nodeH / 2 + 4}" font-size="12" fill="var(--text-primary)"
            font-family="var(--font-sans)" font-weight="${n.type === "goal" ? "600" : "400"}">
            ${n.label.length > 20 ? n.label.slice(0, 20) + "\u2026" : n.label}
          </text>
        </g>
      `).join("")}
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
