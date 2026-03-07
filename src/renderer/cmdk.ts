import type { CmdkAction } from './types';
import { state, getTotalCost, callbacks, toggleDarkMode } from './state';
import { showToast } from './toasts';

function getCmdkActions(query: string): { group: string; items: CmdkAction[] }[] {
  const q = query.toLowerCase().trim();

  const createMatch = q.match(/^(?:create|new|add|start|make)\s+(?:goal|task)?:?\s*(.+)/);
  if (createMatch) {
    return [{
      group: "Create goal",
      items: [{
        icon: "+",
        text: `Create: "${createMatch[1]}"`,
        hint: "enter to create",
        action: () => { closeCmdk(); callbacks.switchView("__create:" + createMatch[1]); },
      }],
    }];
  }

  // Steering: "steer: <message>" sends to the first active goal
  const steerMatch = q.match(/^steer:?\s*(.+)/);
  if (steerMatch) {
    const activeGoals = state.goals.filter(g => g.status === "active");
    if (activeGoals.length === 0) {
      return [{ group: "Steering", items: [{ icon: "\u2192", text: "No active goals to steer", hint: "", action: () => closeCmdk() }] }];
    }
    return [{
      group: "Steering",
      items: activeGoals.map(g => ({
        icon: "\u2192",
        text: `Steer "${g.title}": ${steerMatch[1]}`,
        hint: "enter to send",
        action: () => {
          closeCmdk();
          const bridge = (window as any).fabric;
          if (bridge?.steerGoal) bridge.steerGoal(g.id, steerMatch[1]);
          else showToast("Steering", `"${steerMatch[1]}" \u2192 ${g.title}`, "var(--blue)");
        },
      })),
    }];
  }

  const commandActions: CmdkAction[] = [];
  if (q.includes("pause") || q.includes("stop")) {
    commandActions.push({ icon: "\u23f8", text: "Pause all active deployments", hint: "command", action: () => { closeCmdk(); showToast("Deployments paused", "All active deployments have been paused", "var(--amber)"); state.activityLog.unshift({ time: Date.now(), text: "<strong>you</strong> paused all active deployments" }); } });
  }
  if (q.includes("rollback") || q.includes("revert")) {
    commandActions.push({ icon: "\u21a9", text: "Rollback Deploy v2.3", hint: "command", action: () => { closeCmdk(); showToast("Rolling back", "Deploy v2.3 canary is being rolled back", "var(--red)"); state.activityLog.unshift({ time: Date.now(), text: "<strong>you</strong> triggered rollback on Deploy v2.3" }); } });
  }
  if (q.includes("budget") || q.includes("spend") || q.includes("cost")) {
    commandActions.push({ icon: "$", text: `Today's spend: $${getTotalCost().toFixed(2)}`, hint: "info", action: () => { closeCmdk(); callbacks.switchView("costs"); } });
  }
  if (q.includes("dark") || q.includes("light") || q.includes("theme") || q.includes("mode")) {
    commandActions.push({ icon: state.darkMode ? "\u2600" : "\u263e", text: `Switch to ${state.darkMode ? "light" : "dark"} mode`, hint: "theme", action: () => { closeCmdk(); toggleDarkMode(); } });
  }
  if (q.includes("agent") && !q.includes("how")) {
    const matchedAgents = state.agents.filter(a => a.name.includes(q.replace("agent", "").trim()) || q === "agent" || q === "agents");
    matchedAgents.slice(0, 5).forEach(a => {
      commandActions.push({ icon: a.status === "working" ? "\u25cf" : "\u25cb", text: a.name, hint: a.status, action: () => { closeCmdk(); callbacks.openAgentDetail(a.id); } });
    });
  }

  const goalActions: CmdkAction[] = state.goals
    .filter(g => g.title.toLowerCase().includes(q) || q === "")
    .map(g => ({
      icon: g.status === "complete" ? "\u2713" : g.status === "blocked" ? "!" : "\u25cf",
      text: g.title,
      hint: `${Math.round(g.progress)}%`,
      action: () => { closeCmdk(); callbacks.openGoalDetail(g.id); },
    }));

  const navActions: CmdkAction[] = [
    { icon: "!", text: "Needs You", hint: "view", action: () => { closeCmdk(); callbacks.switchView("needs-you"); } },
    { icon: "\u25c7", text: "All Work", hint: "view", action: () => { closeCmdk(); callbacks.switchView("all-work"); } },
    { icon: "\u22ee", text: "Activity", hint: "view", action: () => { closeCmdk(); callbacks.switchView("activity"); } },
    { icon: "\u2726", text: "Agents", hint: "view", action: () => { closeCmdk(); callbacks.switchView("agents"); } },
    { icon: "\u25ce", text: "Graph", hint: "view", action: () => { closeCmdk(); callbacks.switchView("graph"); } },
    { icon: "$", text: "Costs", hint: "view", action: () => { closeCmdk(); callbacks.switchView("costs"); } },
    { icon: "\u2699", text: "Settings", hint: "view", action: () => { closeCmdk(); callbacks.switchView("settings"); } },
  ].filter(a => a.text.toLowerCase().includes(q) || q === "");

  const groups: { group: string; items: CmdkAction[] }[] = [];
  if (commandActions.length) groups.push({ group: "Commands", items: commandActions });
  if (q.length === 0 || goalActions.length) groups.push({ group: "Goals", items: goalActions.length ? goalActions : state.goals.map(g => ({
    icon: g.status === "complete" ? "\u2713" : g.status === "blocked" ? "!" : "\u25cf",
    text: g.title, hint: `${Math.round(g.progress)}%`,
    action: () => { closeCmdk(); callbacks.openGoalDetail(g.id); },
  }))});
  if (navActions.length) groups.push({ group: "Navigate", items: navActions });
  return groups;
}

export function renderCmdkResults(query: string): void {
  const results = document.getElementById("cmdk-results")!;
  const groups = getCmdkActions(query);

  if (query.length > 2 && groups.every(g => g.items.length === 0)) {
    results.innerHTML = `<div class="cmdk-response">${getSmartResponse(query)}</div>`;
    (window as any).__cmdkItems = [];
    return;
  }

  let idx = 0;
  results.innerHTML = groups.map(group => `
    <div class="cmdk-group-label">${group.group}</div>
    ${group.items.map(item => {
      const html = `
        <div class="cmdk-item${idx === state.cmdkSelectedIdx ? " selected" : ""}" data-idx="${idx}">
          <span class="cmdk-item-icon">${item.icon}</span>
          <span class="cmdk-item-text">${item.text}</span>
          ${item.hint ? `<span class="cmdk-item-hint">${item.hint}</span>` : ""}
        </div>
      `;
      idx++;
      return html;
    }).join("")}
  `).join("");

  const allItems = groups.flatMap(g => g.items);
  (window as any).__cmdkItems = allItems;

  results.querySelectorAll(".cmdk-item").forEach(el => {
    el.addEventListener("mouseenter", () => {
      state.cmdkSelectedIdx = parseInt((el as HTMLElement).dataset.idx || "0");
      results.querySelectorAll(".cmdk-item").forEach(e => e.classList.remove("selected"));
      el.classList.add("selected");
    });
    el.addEventListener("click", () => {
      const i = parseInt((el as HTMLElement).dataset.idx || "0");
      allItems[i]?.action();
    });
  });
}

function getSmartResponse(query: string): string {
  const q = query.toLowerCase();
  if (q.includes("deploy") || q.includes("v2.3") || q.includes("canary")) {
    return `<strong>Deploy v2.3</strong> is ${Math.round(state.goals[0].progress)}% complete. Canary is running at 5% traffic in us-east-1 with a 0.03% error rate (threshold: 0.1%). 3 agents working on it.<br><br><span class="cmdk-response-action" data-goal="g1">View goal \u2192</span>`;
  }
  if (q.includes("billing") || q.includes("anomaly")) {
    return `The <strong>billing investigation</strong> is ${Math.round(state.goals[1].progress)}% complete. 3 suspicious clusters found in Q1 data. Next step: cross-reference with promos.<br><br><span class="cmdk-response-action" data-goal="g2">View goal \u2192</span>`;
  }
  if (q.includes("auth") || q.includes("oauth")) {
    return `The <strong>OAuth 2.1 refactor</strong> is blocked at ${Math.round(state.goals[2].progress)}%. Waiting on auth-sdk v4. Migration plan approved.<br><br><span class="cmdk-response-action" data-goal="g3">View goal \u2192</span>`;
  }
  if (q.includes("latency") || q.includes("p95")) {
    return `<strong>API latency</strong> optimization is ${Math.round(state.goals[3].progress)}% complete. Current P95: 187ms (target: 200ms). Load test in progress.<br><br><span class="cmdk-response-action" data-goal="g4">View goal \u2192</span>`;
  }
  if (q.includes("status") || q.includes("overview") || q.includes("how") || q.includes("what")) {
    const active = state.goals.filter(g => g.status === "active").length;
    const blocked = state.goals.filter(g => g.status === "blocked").length;
    const working = state.agents.filter(a => a.status === "working").length;
    return `<strong>${active} goals active</strong>, ${blocked} blocked. ${working} agents working, ${state.agents.length - working} idle. Spend today: <strong>$${getTotalCost().toFixed(2)}</strong>. ${state.attentionItems.length} items need your attention.`;
  }
  return `Try: <strong>"status"</strong> for an overview, a goal name, <strong>"create: [description]"</strong> to start a new goal, <strong>"steer: [message]"</strong> to redirect an active goal, <strong>"pause"</strong> for commands, or <strong>"dark mode"</strong>.`;
}

export function openCmdk(): void {
  const overlay = document.getElementById("cmdk-overlay")!;
  const input = document.getElementById("cmdk-input") as HTMLInputElement;
  overlay.classList.add("open");
  input.value = "";
  input.focus();
  state.cmdkSelectedIdx = 0;
  renderCmdkResults("");
}

export function closeCmdk(): void {
  document.getElementById("cmdk-overlay")!.classList.remove("open");
}
