export const EXPECTED_SLOTS = [
  "home_bottom",
  "home_logo",
  "home_prompt_right",
  "sidebar_content",
  "sidebar_footer",
  "sidebar_title",
];

export function createSnapshot(overrides = {}) {
  return {
    generatedAt: "2026-06-15T12:00:00.000Z",
    runtimeMode: "orchestrator_worker",
    status: "attention",
    task: {
      found: true,
      id: "T-1",
      title: "Implement dashboard",
      status: "in_progress",
      priority: "high",
      latestCheckpointSummary: "Slots wired",
      nextSteps: ["Run visual QA"],
      openQuestions: ["Confirm fallback smoke"],
      evidenceRefs: ["src/opencode/tui-plugin.ts:1"],
    },
    workflow: {
      found: true,
      runId: "W-1",
      status: "active",
      statusLine: "dashboard:W-1 0 done, 1 open, state=active",
      shouldContinue: true,
    },
    publicJobs: {
      total: 3,
      retryable: 1,
      byStatus: [{ status: "retry_wait", count: 1 }],
      nextRetryAt: "2026-06-15T12:00:15.000Z",
    },
    provider: {
      model: "qwen3.6-35b-a3b",
      health: "unknown",
      preflightAttempted: false,
      diagnostics: ["Provider preflight not requested."],
    },
    contextBudget: {
      status: "unknown",
    },
    evidence: {
      status: "warning",
      warnings: ["Open question: Confirm fallback smoke"],
      verificationCommands: ["npm test"],
    },
    warnings: [],
    interrupts: [
      {
        key: "task.open_questions.T-1",
        severity: "warning",
        title: "Open questions",
        message: "1 question needs resolution.",
      },
    ],
    ...overrides,
  };
}

export function createFakeSolidRuntime() {
  return {
    createSignal(initial) {
      let value = initial;
      return [
        () => value,
        (next) => {
          value = next;
          return value;
        },
      ];
    },
    createElement(tag) {
      return { tag, children: [] };
    },
    insert(parent, accessor) {
      parent.children.push(accessor);
      return parent;
    },
  };
}

export function renderedText(value) {
  if (typeof value === "string") return value;
  if (!value || !Array.isArray(value.children)) return "";
  return value.children.map((child) => typeof child === "function" ? child() : child).join("\n");
}

export async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

export function createDeferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function createFakeTimer() {
  const intervals = [];
  const cleared = [];
  return {
    intervals,
    cleared,
    timer: {
      setInterval(callback, ms) {
        const handle = { callback, ms };
        intervals.push(handle);
        return handle;
      },
      clearInterval(handle) {
        cleared.push(handle);
      },
    },
  };
}

export function createFakeApi(paths = {}) {
  const registered = [];
  const disposeCallbacks = [];
  const routes = [];
  const toasts = [];
  const attentions = [];
  const renderRequests = [];
  return {
    registered,
    disposeCallbacks,
    routes,
    toasts,
    attentions,
    renderRequests,
    api: {
      state: {
        path: {
          worktree: paths.worktree,
          directory: paths.directory,
        },
      },
      slots: {
        register(plugin) {
          registered.push(plugin);
          return "tiny-chu.dashboard.slot";
        },
      },
      lifecycle: {
        onDispose(callback) {
          disposeCallbacks.push(callback);
          return () => undefined;
        },
      },
      route: {
        register(routeDefinitions) {
          routes.push(routeDefinitions);
          return () => undefined;
        },
      },
      ui: {
        toast(input) {
          toasts.push(input);
        },
      },
      attention: {
        async notify(input) {
          attentions.push(input);
          return { ok: true, notification: true, sound: true };
        },
      },
      renderer: {
        requestRender() {
          renderRequests.push("requestRender");
        },
      },
    },
  };
}

export function pluginMeta() {
  return {
    id: "tiny-chu.logo",
    source: "file",
    spec: "./plugins/tiny-chu-tui.ts",
    target: "tui",
    first_time: 0,
    last_time: 0,
    time_changed: 0,
    load_count: 1,
    fingerprint: "test",
    state: "first",
  };
}
