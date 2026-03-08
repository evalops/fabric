import type { CmdkAction } from './types';
import { state, getTotalCost, callbacks, toggleDarkMode, saveTemplates } from './state';
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

  // Batch creation: "batch: desc1 | desc2 | desc3"
  const batchMatch = q.match(/^batch:?\s*(.+)/);
  if (batchMatch) {
    const descriptions = batchMatch[1].split("|").map(d => d.trim()).filter(Boolean);
    if (descriptions.length >= 2) {
      return [{
        group: "Batch create",
        items: [{
          icon: "\u229e",
          text: `Create ${descriptions.length} goals in batch`,
          hint: "enter to create all",
          action: () => {
            closeCmdk();
            const bridge = (window as any).fabric;
            if (bridge?.createGoal) {
              descriptions.forEach(d => bridge.createGoal(d));
              showToast("Batch created", `${descriptions.length} goals launched`, "var(--accent)");
            }
          },
        }],
      }];
    }
  }

  // Template: "save template: name" saves current query as template
  const saveTemplateMatch = q.match(/^save\s+template:?\s*(.+)/);
  if (saveTemplateMatch) {
    return [{
      group: "Templates",
      items: [{
        icon: "\u2606",
        text: `Save template: "${saveTemplateMatch[1]}"`,
        hint: "saves for reuse",
        action: () => {
          closeCmdk();
          state.templates.push({
            id: `tmpl-${Date.now()}`,
            name: saveTemplateMatch[1],
            description: saveTemplateMatch[1],
            createdAt: Date.now(),
          });
          saveTemplates();
          showToast("Template saved", `"${saveTemplateMatch[1]}" saved`, "var(--accent)");
        },
      }],
    }];
  }

  // Show templates when user types "template"
  if (q.includes("template") && state.templates.length > 0) {
    return [{
      group: "Templates",
      items: state.templates.map(t => ({
        icon: "\u2605",
        text: t.name,
        hint: "template",
        action: () => { closeCmdk(); callbacks.switchView("__create:" + t.description); },
      })),
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
    // Per-goal pause for active goals
    const activeGoals = state.goals.filter(g => g.status === "active");
    if (activeGoals.length > 0) {
      activeGoals.forEach(g => {
        commandActions.push({
          icon: "\u23f8",
          text: `Pause "${g.title}"`,
          hint: `${Math.round(g.progress)}%`,
          action: () => {
            closeCmdk();
            const bridge = (window as any).fabric;
            if (bridge?.pauseGoal) bridge.pauseGoal(g.id);
            showToast("Goal paused", `"${g.title}" has been paused`, "var(--amber)");
            state.activityLog.unshift({ time: Date.now(), text: `<strong>you</strong> paused "${g.title}"` });
          },
        });
      });
      if (activeGoals.length > 1) {
        commandActions.push({
          icon: "\u23f8",
          text: `Pause all ${activeGoals.length} active goals`,
          hint: "command",
          action: () => {
            closeCmdk();
            const bridge = (window as any).fabric;
            activeGoals.forEach(g => { if (bridge?.pauseGoal) bridge.pauseGoal(g.id); });
            showToast("All paused", `${activeGoals.length} active goals have been paused`, "var(--amber)");
            state.activityLog.unshift({ time: Date.now(), text: `<strong>you</strong> paused all ${activeGoals.length} active goals` });
          },
        });
      }
    }
  }
  if (q.includes("resume") || q.includes("restart") || q.includes("retry")) {
    const pausedGoals = state.goals.filter(g => g.status !== "active" && g.status !== "complete");
    pausedGoals.forEach(g => {
      commandActions.push({
        icon: "\u25b6",
        text: `Resume "${g.title}"`,
        hint: g.outcome?.replace(/_/g, " ") || g.status,
        action: () => {
          closeCmdk();
          const bridge = (window as any).fabric;
          if (bridge?.resumeGoal) bridge.resumeGoal(g.id);
          showToast("Goal resumed", `"${g.title}" is being resumed`, "var(--accent)");
          state.activityLog.unshift({ time: Date.now(), text: `<strong>you</strong> resumed "${g.title}"` });
        },
      });
    });
  }
  if (q.includes("budget") || q.includes("spend") || q.includes("cost")) {
    commandActions.push({ icon: "$", text: `Today's spend: $${getTotalCost().toFixed(2)}`, hint: "info", action: () => { closeCmdk(); callbacks.switchView("costs"); } });
  }
  if (q.includes("dark") || q.includes("light") || q.includes("theme") || q.includes("mode")) {
    commandActions.push({ icon: "\u25D1", text: `Switch to ${state.darkMode ? "light" : "dark"} mode`, hint: "theme", action: () => { closeCmdk(); toggleDarkMode(); } });
  }
  if (q.includes("cancel") || q.includes("abort") || q.includes("kill")) {
    const activeGoals = state.goals.filter(g => g.status === "active");
    activeGoals.forEach(g => {
      commandActions.push({
        icon: "\u2717",
        text: `Cancel "${g.title}"`,
        hint: `${Math.round(g.progress)}%`,
        action: () => {
          closeCmdk();
          const bridge = (window as any).fabric;
          if (bridge?.cancelGoal) bridge.cancelGoal(g.id);
          g.status = "failed";
          g.outcome = "user_abort";
          showToast("Goal cancelled", `"${g.title}" has been cancelled`, "var(--red)");
          state.activityLog.unshift({ time: Date.now(), text: `<strong>you</strong> cancelled "${g.title}"` });
        },
      });
    });
  }
  if (q.includes("agent") && !q.includes("how")) {
    const matchedAgents = state.agents.filter(a => a.name.includes(q.replace("agent", "").trim()) || q === "agent" || q === "agents");
    matchedAgents.slice(0, 5).forEach(a => {
      commandActions.push({ icon: a.status === "working" ? "\u25cf" : "\u25cb", text: a.name, hint: a.status, action: () => { closeCmdk(); callbacks.openAgentDetail(a.id); } });
    });
  }
  if (q.includes("export") || q.includes("download") || q.includes("report")) {
    commandActions.push({
      icon: "\u2913",
      text: "Export activity log (JSON)",
      hint: `${state.activityLog.length} entries`,
      action: () => {
        closeCmdk();
        const data = JSON.stringify(state.activityLog, null, 2);
        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `fabric-activity-${new Date().toISOString().slice(0, 10)}.json`;
        a.click(); URL.revokeObjectURL(url);
        showToast("Exported", "Activity log saved", "var(--accent)");
      },
    });
    commandActions.push({
      icon: "\u2913",
      text: "Export cost report (JSON)",
      hint: `$${getTotalCost().toFixed(2)} total`,
      action: () => {
        closeCmdk();
        const report = state.goals.map(g => ({
          id: g.id, title: g.title, status: g.status, costUsd: g.costUsd,
          inputTokens: g.inputTokens, outputTokens: g.outputTokens,
          turnCount: g.turnCount, outcome: g.outcome,
          duration: (g.completedAt || Date.now()) - g.startedAt,
        }));
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `fabric-costs-${new Date().toISOString().slice(0, 10)}.json`;
        a.click(); URL.revokeObjectURL(url);
        showToast("Exported", "Cost report saved", "var(--accent)");
      },
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
    { icon: "\u2709", text: "Chat", hint: "view", action: () => { closeCmdk(); callbacks.switchView("chat"); } },
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

  // Dynamic goal search — find goals matching any words in the query
  const words = q.split(/\s+/).filter(w => w.length > 2);
  const matchedGoal = state.goals.find(g =>
    words.some(w => g.title.toLowerCase().includes(w) || g.summary.toLowerCase().includes(w))
  );
  if (matchedGoal) {
    const doneSteps = matchedGoal.steps.filter(s => s.state === "done").length;
    const totalSteps = matchedGoal.steps.length;
    const stepsInfo = totalSteps > 0 ? ` ${doneSteps}/${totalSteps} steps complete.` : "";
    const outcomeInfo = matchedGoal.outcome ? ` Outcome: ${matchedGoal.outcome.replace(/_/g, " ")}.` : "";
    const retryInfo = matchedGoal.retryCount > 0 ? ` (${matchedGoal.retryCount} retries)` : "";
    return `<strong>${matchedGoal.title}</strong> is ${Math.round(matchedGoal.progress)}% complete (${matchedGoal.status}).${stepsInfo}${outcomeInfo}${retryInfo} Cost: $${matchedGoal.costUsd.toFixed(2)}, ${matchedGoal.turnCount} turns.<br><br><span class="cmdk-response-action" data-goal="${matchedGoal.id}">View goal \u2192</span>`;
  }

  if (q.includes("status") || q.includes("overview") || q.includes("how") || q.includes("what")) {
    const active = state.goals.filter(g => g.status === "active").length;
    const blocked = state.goals.filter(g => g.status === "blocked").length;
    const failed = state.goals.filter(g => g.status === "failed").length;
    const working = state.agents.filter(a => a.status === "working").length;
    const totalRetries = state.goals.reduce((sum, g) => sum + (g.retryCount || 0), 0);
    const retryNote = totalRetries > 0 ? ` ${totalRetries} retries in flight.` : "";
    return `<strong>${active} goals active</strong>, ${blocked} blocked${failed > 0 ? `, ${failed} failed` : ""}. ${working} agents working, ${state.agents.length - working} idle. Spend today: <strong>$${getTotalCost().toFixed(2)}</strong>. ${state.attentionItems.length} items need your attention.${retryNote}`;
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
