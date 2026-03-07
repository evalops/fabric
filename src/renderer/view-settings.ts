import { state, DEFAULT_SETTINGS, saveSettings, saveTemplates } from './state';

type SettingsTab = "general" | "security" | "governance" | "notifications" | "templates" | "data";

let activeTab: SettingsTab = "general";

function showSettingsSaved(): void {
  const el = document.querySelector(".settings-saved");
  if (!el) return;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1500);
}

// ── Helpers for list-based settings (comma-separated text → string[]) ───

function listToStr(arr: string[]): string {
  return arr.join(", ");
}

function strToList(str: string): string[] {
  return str.split(",").map(s => s.trim()).filter(Boolean);
}

function settingsRow(label: string, hint: string, control: string): string {
  return `<div class="settings-row">
    <div class="settings-row-info">
      <div class="settings-row-label">${label}</div>
      <div class="settings-row-hint">${hint}</div>
    </div>
    ${control}
  </div>`;
}

function switchControl(id: string, checked: boolean): string {
  return `<label class="settings-switch">
    <input type="checkbox" id="${id}" ${checked ? "checked" : ""} />
    <span class="settings-switch-track"></span>
  </label>`;
}

function numberControl(id: string, value: number, min: number, max: number, step: number): string {
  return `<input class="settings-input settings-number" id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" />`;
}

function textControl(id: string, value: string, placeholder: string, mono = false): string {
  return `<input class="settings-input${mono ? " mono" : ""}" id="${id}" type="text" placeholder="${placeholder}" value="${escHtml(value)}" />`;
}

function textareaControl(id: string, value: string, placeholder: string, rows = 3): string {
  return `<textarea class="settings-input settings-textarea" id="${id}" rows="${rows}" placeholder="${placeholder}">${escHtml(value)}</textarea>`;
}

function selectControl(id: string, value: string, options: { value: string; label: string }[]): string {
  return `<select class="settings-select" id="${id}">
    ${options.map(o => `<option value="${o.value}"${value === o.value ? " selected" : ""}>${o.label}</option>`).join("")}
  </select>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Tab Content Renderers ──────────────────────────────

function renderGeneralTab(): string {
  const masked = state.settings.apiKey ? "\u2022".repeat(8) + state.settings.apiKey.slice(-4) : "";
  return `
    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Appearance</div>
        <div class="settings-card-desc">Control the look and feel of Fabric</div>
      </div>
      ${settingsRow("Theme", "Choose between light, dark, or follow your system preference", `
        <div class="settings-theme-group">
          <div class="settings-theme-option${state.settings.theme === "light" ? " active" : ""}" data-theme="light">Light</div>
          <div class="settings-theme-option${state.settings.theme === "dark" ? " active" : ""}" data-theme="dark">Dark</div>
          <div class="settings-theme-option${state.settings.theme === "system" ? " active" : ""}" data-theme="system">System</div>
        </div>
      `)}
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">API Configuration</div>
        <div class="settings-card-desc">Configure your Anthropic API key for agent execution</div>
      </div>
      ${settingsRow("API Key", "Your Anthropic API key. Stored locally, never sent anywhere except the Anthropic API.", `
        <input class="settings-input mono" id="settings-api-key" type="password" placeholder="sk-ant-..." value="${masked}" />
      `)}
      ${settingsRow("Model", "Default model used for orchestration and subagents", selectControl("settings-model", state.settings.model, [
        { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
        { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
        { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
      ]))}
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Agent Defaults</div>
        <div class="settings-card-desc">Default limits applied to each new goal</div>
      </div>
      ${settingsRow("Budget per goal", "Maximum spend in USD before a goal is paused", numberControl("settings-budget", state.settings.maxBudgetUsd, 0.5, 50, 0.5))}
      ${settingsRow("Max turns per goal", "Maximum agent conversation turns before stopping", numberControl("settings-max-turns", state.settings.maxTurns, 5, 200, 5))}
      ${settingsRow("Show agent messages", "Display raw agent text in the activity feed", switchControl("settings-agent-messages", state.settings.showAgentMessages))}
    </div>`;
}

function renderSecurityTab(): string {
  return `
    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Tool Permissions</div>
        <div class="settings-card-desc">Control which tools agents are allowed to invoke. An empty allowlist means all tools are permitted.</div>
      </div>
      ${settingsRow("Tool allowlist", "Comma-separated list of tools agents may use (e.g. Read, Grep, Glob). Empty = all allowed.",
        textControl("sec-tool-allowlist", listToStr(state.settings.toolAllowlist), "Read, Grep, Glob, Edit..."))}
      ${settingsRow("Tool blocklist", "Tools that are never allowed, even if on the allowlist",
        textControl("sec-tool-blocklist", listToStr(state.settings.toolBlocklist), "Bash, Write..."))}
      ${settingsRow("Human approval tools", "Tools that require human confirmation before each invocation",
        textControl("sec-human-approval-tools", listToStr(state.settings.humanApprovalTools), "Bash, Edit, Write..."))}
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">File System Sandbox</div>
        <div class="settings-card-desc">Restrict which directories agents can access. Prevents data exfiltration and accidental modifications outside project boundaries.</div>
      </div>
      ${settingsRow("Allowed paths", "Directories agents may read/write. Empty = unrestricted.",
        textareaControl("sec-sandbox-paths", listToStr(state.settings.sandboxPaths), "/Users/you/projects, /tmp/fabric-work", 2))}
      ${settingsRow("Blocked paths", "Directories agents must never access, regardless of sandbox",
        textareaControl("sec-blocked-paths", listToStr(state.settings.blockedPaths), "~/.ssh, ~/.aws, ~/.config/gcloud", 2))}
      ${settingsRow("Disable file content sharing", "Agents can only reference file paths in API calls, never send file contents",
        switchControl("sec-disable-file-content", state.settings.disableFileContentSharing))}
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Network Restrictions</div>
        <div class="settings-card-desc">Limit which external domains agents can reach via fetch or webhooks.</div>
      </div>
      ${settingsRow("Allowed domains", "Outbound domains agents may contact. Empty = unrestricted.",
        textareaControl("sec-allowed-domains", listToStr(state.settings.allowedDomains), "api.anthropic.com, github.com, hooks.slack.com", 2))}
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Output Sanitization</div>
        <div class="settings-card-desc">Automatically redact sensitive patterns from agent output before it is displayed or logged.</div>
      </div>
      ${settingsRow("Redaction patterns", "Regex patterns to auto-redact from output (one per line). Matches are replaced with [REDACTED].",
        textareaControl("sec-redact-patterns", state.settings.redactPatterns.join("\n"), "sk-ant-[A-Za-z0-9]+\nAIza[A-Za-z0-9_-]{35}\n\\b\\d{3}-\\d{2}-\\d{4}\\b", 3))}
    </div>`;
}

function renderGovernanceTab(): string {
  return `
    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Spend Limits</div>
        <div class="settings-card-desc">Set aggregate spending caps to prevent runaway costs. Set to 0 for unlimited.</div>
      </div>
      ${settingsRow("Daily spend cap", "Maximum total spend per day across all goals (USD)",
        numberControl("gov-daily-cap", state.settings.dailySpendCapUsd, 0, 1000, 1))}
      ${settingsRow("Weekly spend cap", "Maximum total spend per week across all goals (USD)",
        numberControl("gov-weekly-cap", state.settings.weeklySpendCapUsd, 0, 5000, 5))}
      ${settingsRow("Cost approval threshold", "Pause and request approval when a single goal exceeds this cost (USD). 0 = off.",
        numberControl("gov-cost-approval", state.settings.costApprovalThresholdUsd, 0, 100, 0.5))}
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Execution Limits</div>
        <div class="settings-card-desc">Prevent resource exhaustion and runaway agents.</div>
      </div>
      ${settingsRow("Max concurrent goals", "Limit how many goals can run simultaneously. 0 = unlimited.",
        numberControl("gov-max-concurrent", state.settings.maxConcurrentGoals, 0, 50, 1))}
      ${settingsRow("Turn approval threshold", "Require approval when a goal exceeds this many turns. 0 = off.",
        numberControl("gov-turn-approval", state.settings.turnApprovalThreshold, 0, 500, 10))}
      ${settingsRow("Max consecutive errors", "Auto-pause a goal after this many consecutive errors",
        numberControl("gov-max-errors", state.settings.maxConsecutiveErrors, 1, 50, 1))}
      ${settingsRow("Require goal confirmation", "Ask for human confirmation before starting any new goal",
        switchControl("gov-require-confirm", state.settings.requireGoalConfirmation))}
    </div>`;
}

function renderNotificationsTab(): string {
  return `
    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">In-App Notifications</div>
        <div class="settings-card-desc">Control how Fabric alerts you about events</div>
      </div>
      ${settingsRow("Toast notifications", "Show pop-up notifications for important events",
        switchControl("settings-toast", state.settings.toastNotifications))}
      ${settingsRow("Sound notifications", "Play a sound when an agent needs your attention",
        switchControl("settings-sound", state.settings.soundNotifications))}
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Audit Logging</div>
        <div class="settings-card-desc">Track all goal creation, tool invocations, and steering actions for compliance.</div>
      </div>
      ${settingsRow("Enable audit log", "Write detailed audit events for every goal and tool invocation",
        switchControl("audit-enabled", state.settings.auditLogEnabled))}
      ${settingsRow("Audit webhook URL", "POST audit events to an external SIEM or log aggregator",
        textControl("audit-webhook-url", state.settings.auditWebhookUrl, "https://siem.example.com/api/events", true))}
    </div>`;
}

function renderTemplatesTab(): string {
  return `
    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Goal Templates</div>
        <div class="settings-card-desc">Save and reuse common goal patterns. Create templates via command palette: "save template: description"</div>
      </div>
      ${state.templates.length === 0
        ? `<div style="color: var(--text-muted); font-size: 13px; padding: 8px 0;">No templates yet. Use the command palette (Cmd+K) and type "save template: your goal description" to create one.</div>`
        : `<div style="display: flex; flex-direction: column; gap: 4px;">
        ${state.templates.map(t => `
          <div class="template-row">
            <span style="font-size: 13px; flex: 1;">${escHtml(t.name)}</span>
            ${t.model ? `<span style="font-size: 11px; color: var(--text-muted);">${escHtml(t.model)}</span>` : ""}
            <button class="template-use-btn btn btn-primary" data-template-id="${t.id}" style="padding: 4px 10px; font-size: 11px;">Use</button>
            <button class="template-delete-btn btn btn-danger" data-template-id="${t.id}" style="padding: 4px 8px; font-size: 11px;">\u00d7</button>
          </div>
        `).join("")}
      </div>`
      }
    </div>`;
}

function renderDataTab(): string {
  return `
    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Access Control</div>
        <div class="settings-card-desc">Configure authentication and session management. SSO integration requires server-side configuration.</div>
      </div>
      ${settingsRow("SSO Provider", "Single sign-on integration (requires server restart to take effect)",
        selectControl("ac-sso-provider", state.settings.ssoProvider, [
          { value: "none", label: "None (local only)" },
          { value: "okta", label: "Okta" },
          { value: "azure-ad", label: "Azure AD / Entra ID" },
          { value: "google", label: "Google Workspace" },
          { value: "custom-saml", label: "Custom SAML 2.0" },
        ]))}
      ${settingsRow("SSO Entity / Tenant ID", "Your identity provider's entity ID or tenant identifier",
        textControl("ac-sso-entity", state.settings.ssoEntityId, "https://sso.example.com/entity-id", true))}
      ${settingsRow("Session timeout", "Auto-lock after inactivity (minutes). 0 = never.",
        numberControl("ac-session-timeout", state.settings.sessionTimeoutMinutes, 0, 1440, 5))}
      ${settingsRow("API IP allowlist", "Only allow API access from these IPs/CIDRs. Empty = all.",
        textareaControl("ac-ip-allowlist", listToStr(state.settings.apiIpAllowlist), "10.0.0.0/8, 192.168.1.0/24", 2))}
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Data & Privacy</div>
        <div class="settings-card-desc">Control data retention and privacy protections.</div>
      </div>
      ${settingsRow("Data retention", "Automatically purge activity and cost data older than this many days. 0 = keep forever.",
        numberControl("data-retention", state.settings.dataRetentionDays, 0, 3650, 1))}
      ${settingsRow("PII detection", "Scan agent output for personally identifiable information (SSN, emails, phone numbers)",
        switchControl("data-pii-detect", state.settings.piiDetection))}
      ${settingsRow("Auto-redact PII", "Automatically replace detected PII with [REDACTED] in logs and display",
        switchControl("data-pii-redact", state.settings.piiAutoRedact))}
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Export</div>
        <div class="settings-card-desc">Download your data for analysis or backup</div>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button class="btn btn-primary" id="export-goals-json">Export Goals (JSON)</button>
        <button class="btn btn-primary" id="export-goals-csv">Export Goals (CSV)</button>
        <button class="btn" id="export-activity-json">Export Activity (JSON)</button>
      </div>
    </div>`;
}

// ── Tabs definition ───────────────────────────────────

const TABS: { id: SettingsTab; icon: string; label: string }[] = [
  { id: "general", icon: "\u2699", label: "General" },
  { id: "security", icon: "\u26e8", label: "Security" },
  { id: "governance", icon: "\u2696", label: "Governance" },
  { id: "notifications", icon: "\ud83d\udd14", label: "Notifications" },
  { id: "templates", icon: "\ud83d\udccb", label: "Templates" },
  { id: "data", icon: "\ud83d\udee1", label: "Data & Access" },
];

function renderTabContent(): string {
  switch (activeTab) {
    case "general": return renderGeneralTab();
    case "security": return renderSecurityTab();
    case "governance": return renderGovernanceTab();
    case "notifications": return renderNotificationsTab();
    case "templates": return renderTemplatesTab();
    case "data": return renderDataTab();
  }
}

// ── Main Render ───────────────────────────────────────

export function renderSettings(): void {
  const feed = document.getElementById("feed")!;

  feed.innerHTML = `<div class="settings-view">
    <div class="settings-tabs">
      ${TABS.map(t => `
        <button class="settings-tab${activeTab === t.id ? " active" : ""}" data-tab="${t.id}">
          <span class="settings-tab-icon">${t.icon}</span>
          <span>${t.label}</span>
        </button>
      `).join("")}
    </div>
    <div class="settings-tab-content">
      ${renderTabContent()}
    </div>
    <div class="settings-footer-bar">
      <button class="settings-reset" id="settings-reset">Reset all settings to defaults</button>
      <span class="settings-saved">Saved</span>
    </div>
  </div>`;

  // ── Wire tab switching ────────────────────────────
  feed.querySelectorAll(".settings-tab").forEach(el => {
    el.addEventListener("click", () => {
      activeTab = (el as HTMLElement).dataset.tab as SettingsTab;
      renderSettings();
    });
  });

  // ── Wire controls based on active tab ─────────────
  switch (activeTab) {
    case "general": wireGeneralTab(); break;
    case "security": wireSecurityTab(); break;
    case "governance": wireGovernanceTab(); break;
    case "notifications": wireNotificationsTab(); break;
    case "templates": wireTemplatesTab(); break;
    case "data": wireDataTab(); break;
  }

  // Reset button
  document.getElementById("settings-reset")!.addEventListener("click", () => {
    state.settings = { ...DEFAULT_SETTINGS };
    saveSettings();
    renderSettings();
    showSettingsSaved();
  });
}

// ── Tab wiring ────────────────────────────────────────

function wireGeneralTab(): void {
  // Theme
  document.querySelectorAll(".settings-theme-option").forEach(el => {
    el.addEventListener("click", () => {
      const theme = (el as HTMLElement).dataset.theme as "light" | "dark" | "system";
      state.settings.theme = theme;
      saveSettings();
      document.querySelectorAll(".settings-theme-option").forEach(o =>
        o.classList.toggle("active", (o as HTMLElement).dataset.theme === theme)
      );
      showSettingsSaved();
    });
  });

  // API Key
  const apiKeyInput = document.getElementById("settings-api-key") as HTMLInputElement | null;
  if (apiKeyInput) {
    let apiKeyFocused = false;
    apiKeyInput.addEventListener("focus", () => {
      if (!apiKeyFocused) {
        apiKeyFocused = true;
        apiKeyInput.type = "text";
        apiKeyInput.value = state.settings.apiKey;
      }
    });
    apiKeyInput.addEventListener("blur", () => {
      apiKeyFocused = false;
      state.settings.apiKey = apiKeyInput.value;
      saveSettings();
      apiKeyInput.type = "password";
      apiKeyInput.value = state.settings.apiKey ? "\u2022".repeat(8) + state.settings.apiKey.slice(-4) : "";
      showSettingsSaved();
    });
  }

  wireSelect("settings-model", v => { state.settings.model = v; });
  wireNumber("settings-budget", v => { state.settings.maxBudgetUsd = v; }, DEFAULT_SETTINGS.maxBudgetUsd);
  wireNumber("settings-max-turns", v => { state.settings.maxTurns = v; }, DEFAULT_SETTINGS.maxTurns);
  wireCheckbox("settings-agent-messages", v => { state.settings.showAgentMessages = v; });
}

function wireSecurityTab(): void {
  wireTextList("sec-tool-allowlist", v => { state.settings.toolAllowlist = v; });
  wireTextList("sec-tool-blocklist", v => { state.settings.toolBlocklist = v; });
  wireTextList("sec-human-approval-tools", v => { state.settings.humanApprovalTools = v; });
  wireTextList("sec-sandbox-paths", v => { state.settings.sandboxPaths = v; });
  wireTextList("sec-blocked-paths", v => { state.settings.blockedPaths = v; });
  wireTextList("sec-allowed-domains", v => { state.settings.allowedDomains = v; });
  wireCheckbox("sec-disable-file-content", v => { state.settings.disableFileContentSharing = v; });

  // Redact patterns are newline-separated, not comma-separated
  const redactEl = document.getElementById("sec-redact-patterns") as HTMLTextAreaElement | null;
  if (redactEl) {
    redactEl.addEventListener("change", () => {
      state.settings.redactPatterns = redactEl.value.split("\n").map(s => s.trim()).filter(Boolean);
      saveSettings();
      showSettingsSaved();
    });
  }
}

function wireGovernanceTab(): void {
  wireNumber("gov-daily-cap", v => { state.settings.dailySpendCapUsd = v; }, 0);
  wireNumber("gov-weekly-cap", v => { state.settings.weeklySpendCapUsd = v; }, 0);
  wireNumber("gov-cost-approval", v => { state.settings.costApprovalThresholdUsd = v; }, 0);
  wireNumber("gov-max-concurrent", v => { state.settings.maxConcurrentGoals = v; }, 0);
  wireNumber("gov-turn-approval", v => { state.settings.turnApprovalThreshold = v; }, 0);
  wireNumber("gov-max-errors", v => { state.settings.maxConsecutiveErrors = v; }, DEFAULT_SETTINGS.maxConsecutiveErrors);
  wireCheckbox("gov-require-confirm", v => { state.settings.requireGoalConfirmation = v; });
}

function wireNotificationsTab(): void {
  wireCheckbox("settings-toast", v => { state.settings.toastNotifications = v; });
  wireCheckbox("settings-sound", v => { state.settings.soundNotifications = v; });
  wireCheckbox("audit-enabled", v => { state.settings.auditLogEnabled = v; });
  wireText("audit-webhook-url", v => { state.settings.auditWebhookUrl = v; });
}

function wireTemplatesTab(): void {
  document.querySelectorAll(".template-use-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.templateId;
      const template = state.templates.find(t => t.id === id);
      if (template) {
        const bridge = (window as any).fabric;
        if (bridge?.createGoal) {
          bridge.createGoal(template.description);
          showSettingsSaved();
        }
      }
    });
  });

  document.querySelectorAll(".template-delete-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.templateId;
      state.templates = state.templates.filter(t => t.id !== id);
      saveTemplates();
      renderSettings();
    });
  });
}

function wireDataTab(): void {
  wireSelect("ac-sso-provider", v => { state.settings.ssoProvider = v as any; });
  wireText("ac-sso-entity", v => { state.settings.ssoEntityId = v; });
  wireNumber("ac-session-timeout", v => { state.settings.sessionTimeoutMinutes = v; }, 0);
  wireTextList("ac-ip-allowlist", v => { state.settings.apiIpAllowlist = v; });
  wireNumber("data-retention", v => { state.settings.dataRetentionDays = v; }, 0);
  wireCheckbox("data-pii-detect", v => { state.settings.piiDetection = v; });
  wireCheckbox("data-pii-redact", v => { state.settings.piiAutoRedact = v; });

  // Export buttons
  document.getElementById("export-goals-json")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.goals, null, 2)], { type: "application/json" });
    downloadBlob(blob, `fabric-goals-${new Date().toISOString().slice(0, 10)}.json`);
  });

  document.getElementById("export-goals-csv")?.addEventListener("click", () => {
    const header = "id,title,status,outcome,progress,costUsd,inputTokens,outputTokens,turnCount,retryCount";
    const rows = state.goals.map(g =>
      `${g.id},"${g.title.replace(/"/g, '""')}",${g.status},${g.outcome || ""},${g.progress},${g.costUsd},${g.inputTokens},${g.outputTokens},${g.turnCount},${g.retryCount}`
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    downloadBlob(blob, `fabric-goals-${new Date().toISOString().slice(0, 10)}.csv`);
  });

  document.getElementById("export-activity-json")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.activityLog, null, 2)], { type: "application/json" });
    downloadBlob(blob, `fabric-activity-${new Date().toISOString().slice(0, 10)}.json`);
  });
}

// ── Generic wiring helpers ────────────────────────────

function wireCheckbox(id: string, setter: (v: boolean) => void): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (el) el.addEventListener("change", () => { setter(el.checked); saveSettings(); showSettingsSaved(); });
}

function wireNumber(id: string, setter: (v: number) => void, fallback: number): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (el) el.addEventListener("change", () => { setter(parseFloat(el.value) || fallback); saveSettings(); showSettingsSaved(); });
}

function wireSelect(id: string, setter: (v: string) => void): void {
  const el = document.getElementById(id) as HTMLSelectElement | null;
  if (el) el.addEventListener("change", () => { setter(el.value); saveSettings(); showSettingsSaved(); });
}

function wireText(id: string, setter: (v: string) => void): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (el) el.addEventListener("blur", () => { setter(el.value); saveSettings(); showSettingsSaved(); });
}

function wireTextList(id: string, setter: (v: string[]) => void): void {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (el) el.addEventListener("blur", () => { setter(strToList(el.value)); saveSettings(); showSettingsSaved(); });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
