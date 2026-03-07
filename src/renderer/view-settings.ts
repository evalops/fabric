import { state, DEFAULT_SETTINGS, saveSettings } from './state';

function showSettingsSaved(): void {
  const el = document.querySelector(".settings-saved");
  if (!el) return;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1500);
}

export function renderSettings(): void {
  const feed = document.getElementById("feed")!;
  const masked = state.settings.apiKey ? "\u2022".repeat(8) + state.settings.apiKey.slice(-4) : "";

  feed.innerHTML = `<div class="settings-view">
    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Appearance</div>
        <div class="settings-card-desc">Control the look and feel of Fabric</div>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Theme</div>
          <div class="settings-row-hint">Choose between light, dark, or follow your system preference</div>
        </div>
        <div class="settings-theme-group">
          <div class="settings-theme-option${state.settings.theme === "light" ? " active" : ""}" data-theme="light">Light</div>
          <div class="settings-theme-option${state.settings.theme === "dark" ? " active" : ""}" data-theme="dark">Dark</div>
          <div class="settings-theme-option${state.settings.theme === "system" ? " active" : ""}" data-theme="system">System</div>
        </div>
      </div>
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">API Configuration</div>
        <div class="settings-card-desc">Configure your Anthropic API key for agent execution</div>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">API Key</div>
          <div class="settings-row-hint">Your Anthropic API key. Stored locally, never sent anywhere except the Anthropic API.</div>
        </div>
        <input class="settings-input mono" id="settings-api-key" type="password" placeholder="sk-ant-..." value="${masked}" />
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Model</div>
          <div class="settings-row-hint">Default model used for orchestration and subagents</div>
        </div>
        <select class="settings-select" id="settings-model">
          <option value="claude-opus-4-6"${state.settings.model === "claude-opus-4-6" ? " selected" : ""}>Claude Opus 4.6</option>
          <option value="claude-sonnet-4-6"${state.settings.model === "claude-sonnet-4-6" ? " selected" : ""}>Claude Sonnet 4.6</option>
          <option value="claude-haiku-4-5-20251001"${state.settings.model === "claude-haiku-4-5-20251001" ? " selected" : ""}>Claude Haiku 4.5</option>
        </select>
      </div>
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Agent Defaults</div>
        <div class="settings-card-desc">Default limits applied to each new goal</div>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Budget per goal</div>
          <div class="settings-row-hint">Maximum spend in USD before a goal is paused</div>
        </div>
        <input class="settings-input settings-number" id="settings-budget" type="number" min="0.50" max="50" step="0.50" value="${state.settings.maxBudgetUsd}" />
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Max turns per goal</div>
          <div class="settings-row-hint">Maximum agent conversation turns before stopping</div>
        </div>
        <input class="settings-input settings-number" id="settings-max-turns" type="number" min="5" max="100" step="5" value="${state.settings.maxTurns}" />
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Show agent messages</div>
          <div class="settings-row-hint">Display raw agent text in the activity feed</div>
        </div>
        <label class="settings-switch">
          <input type="checkbox" id="settings-agent-messages" ${state.settings.showAgentMessages ? "checked" : ""} />
          <span class="settings-switch-track"></span>
        </label>
      </div>
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Notifications</div>
        <div class="settings-card-desc">Control how Fabric notifies you about events</div>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Toast notifications</div>
          <div class="settings-row-hint">Show pop-up notifications for important events</div>
        </div>
        <label class="settings-switch">
          <input type="checkbox" id="settings-toast" ${state.settings.toastNotifications ? "checked" : ""} />
          <span class="settings-switch-track"></span>
        </label>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Sound notifications</div>
          <div class="settings-row-hint">Play a sound when an agent needs your attention</div>
        </div>
        <label class="settings-switch">
          <input type="checkbox" id="settings-sound" ${state.settings.soundNotifications ? "checked" : ""} />
          <span class="settings-switch-track"></span>
        </label>
      </div>
    </div>

    <div style="display: flex; align-items: center; justify-content: space-between;">
      <button class="settings-reset" id="settings-reset">Reset all settings to defaults</button>
      <span class="settings-saved">Saved</span>
    </div>
  </div>`;

  // Wire up interactions
  feed.querySelectorAll(".settings-theme-option").forEach(el => {
    el.addEventListener("click", () => {
      const theme = (el as HTMLElement).dataset.theme as "light" | "dark" | "system";
      state.settings.theme = theme;
      saveSettings();
      feed.querySelectorAll(".settings-theme-option").forEach(o => o.classList.toggle("active", (o as HTMLElement).dataset.theme === theme));
      showSettingsSaved();
    });
  });

  const apiKeyInput = document.getElementById("settings-api-key") as HTMLInputElement;
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

  (document.getElementById("settings-model") as HTMLSelectElement).addEventListener("change", (e) => {
    state.settings.model = (e.target as HTMLSelectElement).value;
    saveSettings();
    showSettingsSaved();
  });

  (document.getElementById("settings-budget") as HTMLInputElement).addEventListener("change", (e) => {
    state.settings.maxBudgetUsd = parseFloat((e.target as HTMLInputElement).value) || DEFAULT_SETTINGS.maxBudgetUsd;
    saveSettings();
    showSettingsSaved();
  });

  (document.getElementById("settings-max-turns") as HTMLInputElement).addEventListener("change", (e) => {
    state.settings.maxTurns = parseInt((e.target as HTMLInputElement).value) || DEFAULT_SETTINGS.maxTurns;
    saveSettings();
    showSettingsSaved();
  });

  (document.getElementById("settings-agent-messages") as HTMLInputElement).addEventListener("change", (e) => {
    state.settings.showAgentMessages = (e.target as HTMLInputElement).checked;
    saveSettings();
    showSettingsSaved();
  });
  (document.getElementById("settings-toast") as HTMLInputElement).addEventListener("change", (e) => {
    state.settings.toastNotifications = (e.target as HTMLInputElement).checked;
    saveSettings();
    showSettingsSaved();
  });
  (document.getElementById("settings-sound") as HTMLInputElement).addEventListener("change", (e) => {
    state.settings.soundNotifications = (e.target as HTMLInputElement).checked;
    saveSettings();
    showSettingsSaved();
  });

  document.getElementById("settings-reset")!.addEventListener("click", () => {
    state.settings = { ...DEFAULT_SETTINGS };
    saveSettings();
    renderSettings();
    showSettingsSaved();
  });
}
