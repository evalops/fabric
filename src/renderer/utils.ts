export function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

export function formatDuration(startedAt: number, completedAt?: number): string {
  const end = completedAt || Date.now();
  const secs = Math.floor((end - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export function stringToColor(str: string): string {
  const colors = ["#5b5fc7", "#2da44e", "#d4811e", "#0969da", "#cf222e", "#8250df", "#0a7b83", "#b35900"];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Truncate multi-line output: show first N + last N lines with a collapsible middle.
 * Inspired by Codex CLI exec_cell output truncation.
 */
export function truncateOutput(text: string, headLines = 5, tailLines = 5): string {
  const lines = text.split("\n");
  if (lines.length <= headLines + tailLines + 2) {
    // Short enough to show in full
    return `<div class="output-truncated">${escapeHtml(text)}</div>`;
  }
  const head = lines.slice(0, headLines).map(escapeHtml).join("\n");
  const tail = lines.slice(-tailLines).map(escapeHtml).join("\n");
  const hidden = lines.length - headLines - tailLines;
  const mid = lines.slice(headLines, -tailLines).map(escapeHtml).join("\n");
  return `<div class="output-truncated">${head}\n<span class="output-truncated-ellipsis" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.textContent=this.textContent.includes('+')?'- collapse ${hidden} lines':'+ ${hidden} lines hidden'">+ ${hidden} lines hidden</span><span style="display:none">${mid}</span>\n${tail}</div>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Render a unified diff with theme-aware syntax coloring (Codex-inspired).
 * Parses unified diff format into colored add/del/context lines.
 */
export function renderDiff(file: string, diffText: string): string {
  const lines = diffText.split("\n");
  let adds = 0, dels = 0;
  const rendered = lines.map(line => {
    if (line.startsWith("@@")) return `<div class="diff-line diff-line-hunk">${escapeHtml(line)}</div>`;
    if (line.startsWith("+")) { adds++; return `<div class="diff-line diff-line-add">${escapeHtml(line)}</div>`; }
    if (line.startsWith("-")) { dels++; return `<div class="diff-line diff-line-del">${escapeHtml(line)}</div>`; }
    return `<div class="diff-line diff-line-ctx">${escapeHtml(line) || " "}</div>`;
  }).join("");

  return `<div class="diff-block">
    <div class="diff-file-header">
      <span>${escapeHtml(file)}</span>
      <div class="diff-stats">
        ${adds > 0 ? `<span class="diff-stats-add">+${adds}</span>` : ""}
        ${dels > 0 ? `<span class="diff-stats-del">-${dels}</span>` : ""}
      </div>
    </div>
    ${rendered}
  </div>`;
}

/**
 * Render a thinking/reasoning block (Cline-inspired collapsible reasoning section).
 */
export function renderThinkingBlock(agent: string, text: string, time: number, collapsed = true): string {
  return `<div class="thinking-block ${collapsed ? "collapsed" : ""}">
    <div class="thinking-header">
      <span class="thinking-chevron">&#9660;</span>
      <span class="thinking-label">thinking</span>
      <span class="thinking-agent">${escapeHtml(agent)}</span>
      <span class="thinking-time">${relativeTime(time)}</span>
    </div>
    <div class="thinking-body">${escapeHtml(text)}</div>
  </div>`;
}

/** Generate an inline SVG sparkline from an array of values */
export function sparkline(values: number[], width = 60, height = 16, color = "var(--accent)"): string {
  if (values.length < 2) return "";
  const max = Math.max(...values, 0.01);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${i * step},${height - ((v - min) / range) * (height - 2) - 1}`).join(" ");
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="vertical-align: middle; overflow: visible;">
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}
