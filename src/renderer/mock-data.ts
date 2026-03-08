import type { Goal, Step } from './types';
import { state, getTotalCost, callbacks } from './state';
import { showToast } from './toasts';

const NOW = Date.now();
const MIN = 60_000;

const _rawAgents: any[] = [
  {
    id: "a-build-validator", name: "build-validator",
    capabilities: ["build-validation", "artifact-signing"],
    status: "idle", tasksCompleted: 23, avgLatency: "8s", costToday: "$0.46",
    history: [
      { time: NOW - 12 * MIN, text: "Validated build artifacts for Deploy v2.3" },
      { time: NOW - 90 * MIN, text: "Validated build artifacts for Deploy v2.2.1" },
    ],
  },
  {
    id: "a-test-runner", name: "test-runner",
    capabilities: ["integration-testing", "unit-testing", "e2e-testing"],
    status: "idle", tasksCompleted: 47, avgLatency: "45s", costToday: "$2.10",
    history: [
      { time: NOW - 8 * MIN, text: "Ran integration suite: 312/312 passed" },
      { time: NOW - 80 * MIN, text: "Ran e2e tests: 84/84 passed" },
    ],
  },
  {
    id: "a-deploy-orchestrator", name: "deploy-orchestrator",
    capabilities: ["deployment", "canary-management", "rollback"],
    status: "working", currentGoal: "Deploy v2.3 to production", currentStep: "Canary at 5% traffic",
    tasksCompleted: 12, avgLatency: "120s", costToday: "$3.80",
    history: [
      { time: NOW - 3 * MIN, text: "Started canary deployment in us-east-1" },
      { time: NOW - 45 * MIN, text: "Completed Deploy v2.2.1 rollout" },
    ],
  },
  {
    id: "a-observability", name: "observability",
    capabilities: ["monitoring", "alerting", "anomaly-detection"],
    status: "working", currentGoal: "Deploy v2.3 to production", currentStep: "Monitor for 15 minutes",
    tasksCompleted: 156, avgLatency: "1s", costToday: "$1.20",
    history: [
      { time: NOW - 3 * MIN, text: "Began monitoring canary error rate" },
      { time: NOW - 20 * MIN, text: "Detected billing anomaly pattern" },
    ],
  },
  {
    id: "a-data-analyst", name: "data-analyst",
    capabilities: ["data-analysis", "sql", "reporting"],
    status: "idle", tasksCompleted: 31, avgLatency: "18s", costToday: "$1.55",
    history: [
      { time: NOW - 6 * MIN, text: "Queried 142K transaction rows for billing investigation" },
    ],
  },
  {
    id: "a-anomaly-detector", name: "anomaly-detector",
    capabilities: ["anomaly-detection", "pattern-recognition", "clustering"],
    status: "working", currentGoal: "Investigate billing anomaly", currentStep: "Identify anomalous patterns",
    tasksCompleted: 18, avgLatency: "25s", costToday: "$2.30",
    history: [
      { time: NOW - 4 * MIN, text: "Identified 3 suspicious clusters in billing data" },
    ],
  },
  {
    id: "a-code-reviewer", name: "code-reviewer",
    capabilities: ["code-review", "security-review", "style-check"],
    status: "idle", tasksCompleted: 89, avgLatency: "4s", costToday: "$1.78",
    history: [
      { time: NOW - 30 * MIN, text: "Audited OAuth 2.0 implementation: 14 issues" },
      { time: NOW - 40 * MIN, text: "Reviewed breaking dependency changes, created 2 PRs" },
    ],
  },
  {
    id: "a-architect", name: "architect",
    capabilities: ["system-design", "migration-planning", "architecture-review"],
    status: "idle", tasksCompleted: 8, avgLatency: "35s", costToday: "$4.20",
    history: [
      { time: NOW - 20 * MIN, text: "Drafted OAuth 2.1 migration plan" },
    ],
  },
  {
    id: "a-code-gen", name: "code-gen",
    capabilities: ["code-generation", "refactoring", "implementation"],
    status: "working", currentGoal: "Refactor auth for OAuth 2.1", currentStep: "Implement PKCE flow (blocked)",
    tasksCompleted: 34, avgLatency: "8s", costToday: "$3.40",
    history: [
      { time: NOW - 15 * MIN, text: "Blocked: waiting on auth-sdk v4 release" },
    ],
  },
  {
    id: "a-profiler", name: "profiler",
    capabilities: ["performance-profiling", "bottleneck-detection"],
    status: "idle", tasksCompleted: 15, avgLatency: "12s", costToday: "$0.90",
    history: [
      { time: NOW - 45 * MIN, text: "Profiled top 20 endpoints, found 3 bottlenecks" },
    ],
  },
  {
    id: "a-db-optimizer", name: "db-optimizer",
    capabilities: ["query-optimization", "index-tuning", "schema-review"],
    status: "idle", tasksCompleted: 22, avgLatency: "15s", costToday: "$1.10",
    history: [
      { time: NOW - 25 * MIN, text: "Rewrote 3 slow queries (-73% latency)" },
    ],
  },
  {
    id: "a-infra", name: "infra",
    capabilities: ["infrastructure", "provisioning", "caching", "scaling"],
    status: "idle", tasksCompleted: 19, avgLatency: "25s", costToday: "$5.20",
    history: [
      { time: NOW - 10 * MIN, text: "Provisioned Redis cache layer (94% hit rate)" },
    ],
  },
  {
    id: "a-load-tester", name: "load-tester",
    capabilities: ["load-testing", "stress-testing", "benchmarking"],
    status: "working", currentGoal: "API latency under 200ms (P95)", currentStep: "Load test at 2x peak",
    tasksCompleted: 9, avgLatency: "120s", costToday: "$1.80",
    history: [
      { time: NOW - 5 * MIN, text: "Started 2x peak load test, current P95: 187ms" },
    ],
  },
  {
    id: "a-security-scanner", name: "security-scanner",
    capabilities: ["vulnerability-scanning", "dependency-audit", "cve-detection"],
    status: "idle", tasksCompleted: 52, avgLatency: "30s", costToday: "$0.78",
    history: [
      { time: NOW - 60 * MIN, text: "Scanned 847 production packages" },
    ],
  },
  {
    id: "a-patch-agent", name: "patch-agent",
    capabilities: ["auto-patching", "dependency-update", "pr-creation"],
    status: "idle", tasksCompleted: 41, avgLatency: "20s", costToday: "$0.62",
    history: [
      { time: NOW - 50 * MIN, text: "Auto-patched 14 non-breaking dependency updates" },
    ],
  },
  {
    id: "a-vuln-analyst", name: "vuln-analyst",
    capabilities: ["vulnerability-triage", "risk-assessment", "cve-analysis"],
    status: "idle", tasksCompleted: 28, avgLatency: "10s", costToday: "$0.56",
    history: [
      { time: NOW - 55 * MIN, text: "Triaged CVEs: 2 critical, 5 high, 12 medium" },
    ],
  },
];

const _rawGoals: any[] = [
  {
    id: "g1",
    title: "Deploy v2.3 to production",
    summary: "Running canary at 5% traffic. Error rate looks healthy so far.",
    status: "active", progress: 68, agentCount: 3,
    costUsd: 3.42, inputTokens: 284_000, outputTokens: 91_200, startedAt: NOW - 14 * MIN,
    steps: [
      { name: "Validate build artifacts", state: "done", agent: "build-validator", detail: "All checks passed", time: NOW - 12 * MIN },
      { name: "Run integration tests", state: "done", agent: "test-runner", detail: "312 passed", time: NOW - 8 * MIN },
      { name: "Canary at 5% traffic", state: "running", agent: "deploy-orchestrator", detail: "Error rate: 0.03%", time: NOW - 3 * MIN },
      { name: "Monitor for 15 minutes", state: "running", agent: "observability", detail: "8 min remaining", time: NOW - 3 * MIN },
      { name: "Full rollout", state: "waiting" },
    ],
    timeline: [
      { time: NOW - 12 * MIN, text: "<strong>build-validator</strong> verified all artifacts" },
      { time: NOW - 10 * MIN, text: "<strong>test-runner</strong> started integration suite" },
      { time: NOW - 8 * MIN, text: "<strong>test-runner</strong> completed: 312/312 passed" },
      { time: NOW - 3 * MIN, text: "<strong>deploy-orchestrator</strong> started canary in us-east-1" },
      { time: NOW - 3 * MIN, text: "<strong>observability</strong> began monitoring error rate" },
    ],
  },
  {
    id: "g2",
    title: "Investigate billing anomaly",
    summary: "Found 3 suspicious patterns in Q1 transaction data. Narrowing down.",
    status: "active", progress: 35, agentCount: 2,
    costUsd: 1.87, inputTokens: 156_000, outputTokens: 48_300, startedAt: NOW - 20 * MIN,
    steps: [
      { name: "Query transaction logs", state: "done", agent: "data-analyst", detail: "142K rows", time: NOW - 6 * MIN },
      { name: "Identify anomalous patterns", state: "running", agent: "anomaly-detector", detail: "3 clusters found", time: NOW - 4 * MIN },
      { name: "Cross-reference with promos", state: "waiting" },
      { name: "Write root cause report", state: "waiting" },
    ],
    timeline: [
      { time: NOW - 20 * MIN, text: "Goal created by <strong>you</strong>" },
      { time: NOW - 6 * MIN, text: "<strong>data-analyst</strong> queried 142K transaction rows" },
      { time: NOW - 4 * MIN, text: "<strong>anomaly-detector</strong> identified 3 suspicious clusters" },
    ],
  },
  {
    id: "g3",
    title: "Refactor auth for OAuth 2.1",
    summary: "Blocked on auth-sdk v4 dependency. Migration plan is ready.",
    status: "blocked", progress: 22, agentCount: 1,
    costUsd: 4.65, inputTokens: 412_000, outputTokens: 78_500, startedAt: NOW - 35 * MIN,
    steps: [
      { name: "Audit current OAuth 2.0 code", state: "done", agent: "code-reviewer", detail: "14 issues", time: NOW - 30 * MIN },
      { name: "Draft migration plan", state: "done", agent: "architect", detail: "Approved", time: NOW - 20 * MIN },
      { name: "Implement PKCE flow", state: "warn", agent: "code-gen", detail: "Waiting on auth-sdk v4" },
      { name: "Update client libraries", state: "waiting" },
      { name: "Security regression tests", state: "waiting" },
    ],
    timeline: [
      { time: NOW - 35 * MIN, text: "Goal created by <strong>architect</strong>" },
      { time: NOW - 30 * MIN, text: "<strong>code-reviewer</strong> audited OAuth 2.0: 14 issues found" },
      { time: NOW - 20 * MIN, text: "<strong>architect</strong> migration plan approved" },
      { time: NOW - 15 * MIN, text: "<strong>code-gen</strong> blocked: auth-sdk v4 not yet released" },
    ],
  },
  {
    id: "g4",
    title: "API latency under 200ms (P95)",
    summary: "Load testing at 2x peak. Current P95 is 187ms \u2014 looking good.",
    status: "active", progress: 81, agentCount: 4,
    costUsd: 6.80, inputTokens: 520_000, outputTokens: 185_000, startedAt: NOW - 50 * MIN,
    steps: [
      { name: "Profile top endpoints", state: "done", agent: "profiler", detail: "Bottlenecks found", time: NOW - 45 * MIN },
      { name: "Optimize slow queries", state: "done", agent: "db-optimizer", detail: "3 queries fixed", time: NOW - 25 * MIN },
      { name: "Add Redis cache", state: "done", agent: "infra", detail: "94% hit rate", time: NOW - 10 * MIN },
      { name: "Load test at 2x peak", state: "running", agent: "load-tester", detail: "P95: 187ms", time: NOW - 5 * MIN },
      { name: "Deploy to production", state: "waiting" },
    ],
    timeline: [
      { time: NOW - 50 * MIN, text: "Goal created from alert: P95 latency at 340ms" },
      { time: NOW - 45 * MIN, text: "<strong>profiler</strong> identified 3 bottleneck endpoints" },
      { time: NOW - 25 * MIN, text: "<strong>db-optimizer</strong> rewrote queries (-73% latency)" },
      { time: NOW - 10 * MIN, text: "<strong>infra</strong> provisioned Redis cache (94% hit rate)" },
      { time: NOW - 5 * MIN, text: "<strong>load-tester</strong> started 2x peak load test" },
    ],
  },
  {
    id: "g5",
    title: "Dependency security audit",
    summary: "Complete. 2 critical CVEs patched, 14 packages updated.",
    status: "complete", progress: 100, agentCount: 0,
    costUsd: 2.14, inputTokens: 198_000, outputTokens: 42_000, startedAt: NOW - 65 * MIN, completedAt: NOW - 38 * MIN,
    steps: [
      { name: "Scan 847 packages", state: "done", agent: "security-scanner", time: NOW - 60 * MIN },
      { name: "Triage CVEs", state: "done", agent: "vuln-analyst", detail: "2 critical, 5 high", time: NOW - 55 * MIN },
      { name: "Auto-patch safe updates", state: "done", agent: "patch-agent", detail: "14 updated", time: NOW - 50 * MIN },
      { name: "Review breaking changes", state: "done", agent: "code-reviewer", detail: "2 PRs created", time: NOW - 40 * MIN },
    ],
    timeline: [
      { time: NOW - 65 * MIN, text: "Scheduled audit triggered" },
      { time: NOW - 60 * MIN, text: "<strong>security-scanner</strong> scanned 847 packages" },
      { time: NOW - 55 * MIN, text: "<strong>vuln-analyst</strong> triaged: 2 critical, 5 high, 12 medium" },
      { time: NOW - 50 * MIN, text: "<strong>patch-agent</strong> auto-patched 14 packages" },
      { time: NOW - 40 * MIN, text: "<strong>code-reviewer</strong> reviewed breaking changes, created 2 PRs" },
    ],
  },
];

const _goalThinking: Record<string, { thinking: any[]; diffs: any[] }> = {
  g1: {
    thinking: [
      {
        time: NOW - 13 * MIN, agent: "build-validator",
        text: "I need to verify all build artifacts before we proceed with the canary deployment.\n\nChecking:\n1. Docker image SHA matches the CI build output\n2. All asset hashes match the manifest\n3. No unsigned artifacts in the bundle\n4. Version strings are consistent across services\n\nAll four checks pass. Proceeding to test runner.",
      },
      {
        time: NOW - 4 * MIN, agent: "deploy-orchestrator",
        text: "Starting canary at 5% traffic in us-east-1. I chose this region first because it has the highest traffic volume, giving us statistical significance faster.\n\nRollback plan: if error rate exceeds 0.1% threshold, immediately route all traffic back to v2.2.1. The load balancer config is already prepared for instant rollback.",
      },
    ],
    diffs: [
      {
        file: "deploy/canary-config.yaml", time: NOW - 4 * MIN, agent: "deploy-orchestrator",
        hunks: "@@ -12,7 +12,7 @@\n spec:\n   canary:\n-    weight: 0\n+    weight: 5\n     region: us-east-1\n-    version: v2.2.1\n+    version: v2.3.0\n     rollback_threshold: 0.1",
      },
    ],
  },
  g2: {
    thinking: [
      {
        time: NOW - 7 * MIN, agent: "data-analyst",
        text: "Running SQL query across transaction_events for the last 90 days. Looking for statistical outliers in charge amounts.\n\nI'm partitioning by merchant_id and computing z-scores for daily revenue. Any merchant with z > 3.0 on multiple days is flagged.\n\nQuery returned 142K rows in 4.2s. Found 847 transactions with z > 3.0, concentrated in 3 merchant accounts.",
      },
      {
        time: NOW - 5 * MIN, agent: "anomaly-detector",
        text: "Clustering the 847 flagged transactions using DBSCAN.\n\nCluster 1: merchant_id=M-4821, pattern is duplicate charges exactly 30s apart -- looks like a retry bug in the payment gateway.\n\nCluster 2: merchant_id=M-9102, abnormally high transaction amounts starting March 1st -- correlates with a promo code that wasn't applying the discount.\n\nCluster 3: merchant_id=M-1150, negative amounts (refunds) that never completed -- stuck in pending state.",
      },
    ],
    diffs: [],
  },
  g4: {
    thinking: [
      {
        time: NOW - 26 * MIN, agent: "db-optimizer",
        text: "Found 3 slow queries responsible for 73% of P95 latency:\n\n1. /api/billing: Full table scan on transactions (missing index on created_at)\n2. /api/search: N+1 query pattern loading user profiles\n3. /api/dashboard: Aggregation query recalculating stats on every request\n\nFix plan:\n- Add composite index (merchant_id, created_at) on transactions\n- Rewrite search to use JOIN instead of N+1\n- Add materialized view for dashboard stats with 5-minute refresh",
      },
    ],
    diffs: [
      {
        file: "src/db/queries/billing.sql", time: NOW - 25 * MIN, agent: "db-optimizer",
        hunks: "@@ -1,6 +1,8 @@\n+-- Added composite index for billing endpoint\n+CREATE INDEX CONCURRENTLY idx_txn_merchant_date ON transactions(merchant_id, created_at);\n+\n SELECT t.id, t.amount, t.status\n FROM transactions t\n-WHERE t.created_at > NOW() - INTERVAL '30 days'\n-ORDER BY t.created_at DESC;\n+WHERE t.merchant_id = $1\n+  AND t.created_at > NOW() - INTERVAL '30 days'\n+ORDER BY t.created_at DESC\n+LIMIT 100;",
      },
      {
        file: "src/api/search.ts", time: NOW - 24 * MIN, agent: "db-optimizer",
        hunks: "@@ -15,10 +15,8 @@\n-  // N+1: loading profiles one by one\n-  const results = await db.query('SELECT * FROM items WHERE ...');\n-  for (const item of results) {\n-    item.user = await db.query('SELECT * FROM users WHERE id = $1', [item.userId]);\n-  }\n+  // Rewritten: single JOIN query\n+  const results = await db.query(`\n+    SELECT i.*, u.name as user_name, u.avatar as user_avatar\n+    FROM items i\n+    JOIN users u ON u.id = i.user_id\n+    WHERE i.search_vector @@ plainto_tsquery($1)\n+    LIMIT 50\n+  `, [query]);",
      },
    ],
  },
};

const _goalInterconnections: Record<string, Partial<Goal>> = {
  g1: {
    blockedBy: ["g5"],
    enables: [],
    insights: [],
    areasAffected: ["deployment", "us-east-1", "api-gateway"],
  },
  g2: {
    blockedBy: [],
    enables: [],
    insights: [
      { id: "ins-1", fromGoalId: "g3", text: "Auth refactor may affect billing validation \u2014 OAuth tokens used in payment verification", time: NOW - 8 * MIN, relevance: "medium" },
    ],
    areasAffected: ["billing", "transactions", "reporting"],
  },
  g3: {
    blockedBy: [],
    enables: ["g1"],
    insights: [
      { id: "ins-2", fromGoalId: "g5", text: "Security audit found 3 issues related to OAuth 2.0 \u2014 these align with your migration plan", time: NOW - 30 * MIN, relevance: "high" },
    ],
    areasAffected: ["auth", "oauth", "client-libraries", "security"],
  },
  g4: {
    blockedBy: [],
    enables: ["g1"],
    insights: [
      { id: "ins-3", fromGoalId: "g2", text: "Billing investigation found /api/billing endpoint has 340ms P95 \u2014 may be related to your latency target", time: NOW - 6 * MIN, relevance: "high" },
    ],
    areasAffected: ["api-endpoints", "database", "caching", "performance"],
  },
  g5: {
    blockedBy: [],
    enables: ["g3"],
    insights: [],
    areasAffected: ["dependencies", "security", "packages"],
  },
};

function buildAgentReputation(): void {
  state.goals.forEach(g => {
    const agentNames = [...new Set(g.steps.filter((s: Step) => s.agent).map((s: Step) => s.agent!))];
    agentNames.forEach(name => {
      const agent = state.agents.find(a => a.name === name);
      if (agent && !agent.goalHistory.find(h => h.goalId === g.id)) {
        agent.goalHistory.push({ goalId: g.id, goalTitle: g.title, role: agent.capabilities[0] || "general", time: g.startedAt });
      }
    });
  });
  state.agents.forEach(a => {
    const partnerCounts: Record<string, number> = {};
    a.goalHistory.forEach(h => {
      const goal = state.goals.find(g => g.id === h.goalId);
      if (!goal) return;
      const coworkers = [...new Set(goal.steps.filter((s: Step) => s.agent && s.agent !== a.name).map((s: Step) => s.agent!))];
      coworkers.forEach(name => { partnerCounts[name] = (partnerCounts[name] || 0) + 1; });
    });
    a.frequentPartners = Object.entries(partnerCounts)
      .sort(([, x], [, y]) => y - x)
      .slice(0, 3)
      .map(([agentName, count]) => ({ agentName, count }));
  });
}

const simEvents = [
  { text: "<strong>observability</strong> checked canary error rate: 0.04%", toast: null as null | { title: string; body: string; color: string } },
  { text: "<strong>load-tester</strong> reported P95 latency at 184ms", toast: null },
  { text: "<strong>anomaly-detector</strong> narrowed billing issue to 2 merchants", toast: null },
  { text: "<strong>deploy-orchestrator</strong> expanded canary to us-west-2", toast: { title: "Canary expanded", body: "Now serving 5% traffic in us-west-2", color: "var(--blue)" } },
  { text: "<strong>code-gen</strong> still waiting on auth-sdk v4", toast: null },
  { text: "<strong>observability</strong> checked canary error rate: 0.05%", toast: null },
  { text: "<strong>profiler</strong> found new slow query in /api/search", toast: { title: "New issue detected", body: "Slow query in /api/search endpoint", color: "var(--amber)" } },
  { text: "<strong>load-tester</strong> reported P95 latency at 179ms", toast: null },
  { text: "<strong>data-analyst</strong> correlated anomaly with March promo", toast: null },
  { text: "<strong>deploy-orchestrator</strong> expanded canary to eu-west-1", toast: null },
  { text: "<strong>patch-agent</strong> created PR #482: update lodash", toast: { title: "PR created", body: "patch-agent opened PR #482 to fix CVE-2026-1847", color: "var(--green)" } },
  { text: "<strong>anomaly-detector</strong> root cause: double-charge on retry", toast: { title: "Root cause found", body: "Billing anomaly: double-charge triggered on payment retry", color: "var(--green)" } },
  { text: "<strong>load-tester</strong> completed load test \u2014 P95: 176ms", toast: { title: "Load test passed", body: "P95 latency at 176ms, under 200ms target", color: "var(--green)" } },
];

export function simulateTick(): void {
  const ev = simEvents[state.simIdx % simEvents.length];
  state.simIdx++;

  state.activityLog.unshift({ time: Date.now(), text: ev.text });
  if (state.activityLog.length > 50) state.activityLog.pop();

  if (ev.toast) showToast(ev.toast.title, ev.toast.body, ev.toast.color);

  state.goals.forEach(g => {
    if (g.status === "active") {
      if (g.progress < 95) g.progress = Math.min(95, g.progress + Math.random() * 1.5);
      g.costUsd += Math.random() * 0.15;
      g.inputTokens += Math.floor(Math.random() * 8000);
      g.outputTokens += Math.floor(Math.random() * 3000);
      g.turnCount += 1;
      // Simulate a tool call
      const tools = ["Read", "Grep", "Glob", "Edit", "Bash", "Write"];
      const tool = tools[Math.floor(Math.random() * tools.length)];
      g.toolCalls.push({
        tool,
        startedAt: Date.now(),
        durationMs: Math.floor(Math.random() * 300) + 10,
        success: Math.random() > 0.08,
        goalId: g.id,
      });
    }
  });

  // Update sidebar footer dynamically
  const footerSpend = document.getElementById("footer-spend");
  if (footerSpend) footerSpend.textContent = `$${getTotalCost().toFixed(2)} today`;
  const footerAgents = document.getElementById("footer-agents");
  if (footerAgents) {
    const working = state.agents.filter(a => a.status === "working").length;
    footerAgents.textContent = `${working}/${state.agents.length} agents`;
  }

  callbacks.renderSidebarGoals();
  callbacks.renderTitleStatus();
}

function generateToolCalls(goalId: string, steps: any[]): any[] {
  const tools = ["Read", "Grep", "Glob", "Edit", "Bash", "Write", "WebFetch", "LSP"];
  const calls: any[] = [];
  const doneSteps = steps.filter((s: any) => s.state === "done" || s.state === "running").length;
  const count = doneSteps * 3 + Math.floor(Math.random() * 5);
  for (let i = 0; i < count; i++) {
    const tool = tools[Math.floor(Math.random() * tools.length)];
    const success = Math.random() > 0.05;
    calls.push({
      tool,
      startedAt: NOW - Math.floor(Math.random() * 60) * MIN,
      durationMs: Math.floor(Math.random() * 500) + 10,
      success,
      goalId,
    });
  }
  return calls;
}

export function initMockData(): void {
  state.agents = _rawAgents.map((a: any) => ({
    ...a,
    goalHistory: [],
    frequentPartners: [],
    successRate: Math.round(92 + Math.random() * 8),
  }));

  state.goals = _rawGoals.map((g: any) => ({
    ...g,
    blockedBy: _goalInterconnections[g.id]?.blockedBy || [],
    enables: _goalInterconnections[g.id]?.enables || [],
    insights: _goalInterconnections[g.id]?.insights || [],
    areasAffected: _goalInterconnections[g.id]?.areasAffected || [],
    turnCount: Math.floor(Math.random() * 20) + 5,
    toolCalls: generateToolCalls(g.id, g.steps),
    retryCount: g.status === "blocked" ? 1 : 0,
    thinking: _goalThinking[g.id]?.thinking || [],
    diffs: _goalThinking[g.id]?.diffs || [],
  }));

  state.attentionItems = [
    {
      id: "a1", kind: "warn", label: "Approaching threshold",
      title: "Canary error rate rising",
      body: "The canary deployment for v2.3 has an error rate of 0.08%, approaching the 0.1% threshold. Errors are concentrated in the checkout endpoint.",
      context: "error rate: 0.08% / 0.1% threshold  \u00b7  ~340 users affected  \u00b7  $2.40 spent",
      actions: [
        { label: "Investigate", style: "btn-primary" },
        { label: "Continue rollout", style: "" },
        { label: "Rollback", style: "btn-danger" },
      ],
    },
    {
      id: "a2", kind: "ask", label: "New goal proposed",
      title: "Migrate auth to OAuth 2.1",
      body: "An agent proposes refactoring the auth module to the OAuth 2.1 spec. This would fix 3 of 14 security issues found in the recent audit.",
      context: "cost: ~$14  \u00b7  time: ~40 min  \u00b7  risk: low  \u00b7  fixes 3 audit issues",
      actions: [
        { label: "Approve", style: "btn-primary" },
        { label: "Edit constraints", style: "" },
        { label: "Reject", style: "btn-danger" },
      ],
    },
  ];

  state.activityLog = [
    { time: NOW - 10_000, text: "<strong>load-tester</strong> reported P95 latency at 187ms" },
    { time: NOW - 25_000, text: "<strong>observability</strong> checked canary error rate: 0.03%" },
    { time: NOW - 55_000, text: "<strong>anomaly-detector</strong> found 3 clusters in billing data" },
    { time: NOW - 80_000, text: "<strong>deploy-orchestrator</strong> started canary in us-east-1" },
    { time: NOW - 120_000, text: "<strong>infra</strong> finished provisioning Redis cache" },
    { time: NOW - 160_000, text: "<strong>data-analyst</strong> completed transaction log query" },
    { time: NOW - 200_000, text: "<strong>test-runner</strong> passed all 312 integration tests" },
    { time: NOW - 260_000, text: "<strong>db-optimizer</strong> rewrote 3 slow queries" },
    { time: NOW - 300_000, text: "<strong>security-scanner</strong> finished scanning 847 packages" },
  ];

  buildAgentReputation();
}
