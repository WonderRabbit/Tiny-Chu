import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyInfiPlugin } from "../dist/index.js";

test("context_digest returns bounded evidence snippets with line metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-context-digest-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "feature.ts"), [
    "export function alpha() {",
    "  return 'alpha';",
    "}",
    "export function beta() {",
    "  return 'beta';",
    "}",
    "export function gamma() {",
    "  return 'gamma';",
    "}",
  ].join("\n"), "utf8");
  const plugin = createTinyInfiPlugin({ root });
  const digest = await plugin.tools.context_digest({
    targetPath: "src/feature.ts",
    query: "beta",
    maxSnippetChars: 28,
    maxSnippets: 1,
  });
  assert.deepEqual(digest.snippets, [{ file: "src/feature.ts", line: 4, text: "export function beta() {" }]);
  assert.ok(digest.snippets.every((snippet) => snippet.text.length <= 28));
  assert.doesNotMatch(JSON.stringify(digest), /gamma/);
});

test("resume_packet summarizes the latest active task checkpoint", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-resume-packet-"));
  const plugin = createTinyInfiPlugin({ root });
  const task = await plugin.tools.task_create({ title: "Small-model resilience", priority: "high" });
  await plugin.tools.task_update({ id: task.id, status: "in_progress" });
  await plugin.tools.task_checkpoint({
    id: task.id,
    summary: "mapped the missing tool surface",
    nextSteps: ["add failing tests", "implement tools"],
    openQuestions: ["should digest use ripgrep-compatible globs?"],
  });
  const packet = await plugin.tools.resume_packet({ id: task.id });
  assert.equal(packet.activeGoal.id, task.id);
  assert.equal(packet.activeGoal.title, "Small-model resilience");
  assert.equal(packet.latestCheckpoint.summary, "mapped the missing tool surface");
  assert.deepEqual(packet.nextSteps, ["add failing tests", "implement tools"]);
  assert.deepEqual(packet.openQuestions, ["should digest use ripgrep-compatible globs?"]);
});

test("chunked_write_plan returns chunks bounded by maxChunkChars", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-chunked-plan-"));
  const plugin = createTinyInfiPlugin({ root });
  const markdown = "# Plan\n\n- [ ] gather context\n- [ ] write tests\n- [ ] verify red\n";
  const plan = await plugin.tools.chunked_write_plan({
    path: ".tiny/plans/SMALL.md",
    markdown,
    maxChunkChars: 24,
  });
  assert.ok(plan.chunks.length > 1);
  assert.ok(plan.chunks.every((chunk) => chunk.text.length <= 24));
  assert.equal(plan.chunks.map((chunk) => chunk.text).join(""), markdown);
});

test("tool_usage_plan gives a bounded small-model command sequence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-tool-plan-"));
  const plugin = createTinyInfiPlugin({ root });
  const plan = await plugin.tools.tool_usage_plan({
    objective: "trace a web button to database write and produce a flowchart",
    artifactType: "flowchart",
  });
  assert.equal(plan.objective, "trace a web button to database write and produce a flowchart");
  assert.ok(plan.modelBudget.maxInputTokens <= 1800);
  assert.ok(plan.steps.length <= 8);
  assert.ok(plan.steps.some((step) => step.nativeTool === "fd"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "legacy_repo_index"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "ui_action_trace"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "api_backend_trace"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "integration_catalog"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "traceability_matrix"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "evidence_qa"));
});

test("tool_usage_plan adds qwen retry policy for delegated public work", async () => {
  const plugin = createTinyInfiPlugin();
  const plan = await plugin.tools.tool_usage_plan({
    objective: "delegate qwen analysis and recover from rate limit",
  });
  assert.ok(plan.steps.length <= 8);
  assert.ok(plan.steps.some((step) => step.tinyTool === "qwen_retry_policy"));
  assert.ok(plan.stopRules.some((rule) => rule.includes("public Qwen failures")));
});

test("tool_usage_plan keeps qwen retry policy for delegated Mermaid artifacts", async () => {
  const plugin = createTinyInfiPlugin();
  const plan = await plugin.tools.tool_usage_plan({
    objective: "delegate qwen analysis and produce a flowchart",
    artifactType: "flowchart",
  });
  assert.ok(plan.steps.length <= 8);
  assert.ok(plan.steps.some((step) => step.tinyTool === "mermaid_check"));
  assert.ok(plan.steps.some((step) => step.tinyTool === "qwen_retry_policy"));
});

test("repo_map summarizes architecture layers and data flow hints", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-repo-map-"));
  await mkdir(path.join(root, "src", "ui"), { recursive: true });
  await mkdir(path.join(root, "src", "api"), { recursive: true });
  await mkdir(path.join(root, "src", "db"), { recursive: true });
  await writeFile(path.join(root, "src", "ui", "CheckoutButton.tsx"), "export function CheckoutButton() { return <button onClick={submitOrder}>Buy</button>; }\n", "utf8");
  await writeFile(path.join(root, "src", "api", "order-controller.ts"), "app.post('/orders', async (req) => saveOrder(req.body));\n", "utf8");
  await writeFile(path.join(root, "src", "db", "order-repository.ts"), "export const saveOrder = (order) => sql`INSERT INTO orders ${order}`;\n", "utf8");
  const plugin = createTinyInfiPlugin({ root });
  const map = await plugin.tools.repo_map({ maxFiles: 20 });
  assert.ok(map.files.length <= 20);
  assert.deepEqual(map.layers.map((layer) => layer.name), ["ui", "api", "database"]);
  assert.ok(map.dataFlowHints.some((hint) => hint.from === "ui" && hint.to === "api"));
  assert.ok(map.dataFlowHints.some((hint) => hint.from === "api" && hint.to === "database"));
  assert.ok(map.recommendedCommands.some((command) => command.includes("rg --json")));
  assert.ok(map.recommendedCommands.some((command) => command.includes("ast-grep")));
});

test("repo_map prioritizes an explicit file target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-repo-map-file-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), "export const ignored = true;\n", "utf8");
  await writeFile(path.join(root, "src", "z-target.ts"), "export function TargetButton() { return <button>Save</button>; }\n", "utf8");
  const plugin = createTinyInfiPlugin({ root });
  const map = await plugin.tools.repo_map({ targetPath: "src/z-target.ts", maxFiles: 1 });
  assert.deepEqual(map.files.map((file) => file.path), ["src/z-target.ts"]);
  assert.equal(map.files[0].layer, "ui");
});

test("business_logic_map extracts bounded variables columns and comparisons", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-business-logic-"));
  await mkdir(path.join(root, "src", "domain"), { recursive: true });
  await mkdir(path.join(root, "src", "db"), { recursive: true });
  await writeFile(path.join(root, "src", "domain", "pricing.ts"), [
    "export function canCharge(order, customer) {",
    "  const totalAmount = order.totalAmount;",
    "  return totalAmount >= customer.creditLimit && order.status !== 'cancelled';",
    "}",
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "src", "db", "orders.sql"), [
    "SELECT order_id, customer_id, total_amount",
    "FROM orders",
    "WHERE customer_id = $1 AND total_amount >= 100",
  ].join("\n"), "utf8");
  const plugin = createTinyInfiPlugin({ root });
  const map = await plugin.tools.business_logic_map({ targetPath: "src", maxFiles: 10, maxItemsPerFile: 8 });
  assert.ok(map.files.length <= 10);
  assert.ok(map.files.some((file) => file.variables.includes("order.totalAmount")));
  assert.ok(map.files.some((file) => file.columns.includes("customer_id")));
  assert.ok(map.files.some((file) => file.comparisons.some((comparison) => comparison.operator === ">=")));
  assert.ok(map.recommendedCommands.some((command) => command.includes("ast-grep")));
});

test("business_logic_map prioritizes an explicit file target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-business-file-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), "export const ignored = account.balance >= 0;\n", "utf8");
  await writeFile(path.join(root, "src", "z-target.ts"), "export const approved = order.total_amount >= customer.credit_limit;\n", "utf8");
  const plugin = createTinyInfiPlugin({ root });
  const map = await plugin.tools.business_logic_map({ targetPath: "src/z-target.ts", maxFiles: 1, maxItemsPerFile: 8 });
  assert.deepEqual(map.files.map((file) => file.path), ["src/z-target.ts"]);
  assert.ok(map.files[0].columns.includes("total_amount"));
  assert.ok(map.files[0].comparisons.some((comparison) => comparison.left === "order.total_amount" && comparison.operator === ">="));
});

test("business_logic_map ignores jsx tags while preserving real comparisons", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-business-jsx-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "View.tsx"), "export function View(){ return <button disabled={total >= limit}>Pay</button>; }\n", "utf8");
  const plugin = createTinyInfiPlugin({ root });
  const map = await plugin.tools.business_logic_map({ targetPath: "src/View.tsx", maxFiles: 1, maxItemsPerFile: 8 });
  const comparisons = map.files[0].comparisons;
  assert.ok(comparisons.some((comparison) => comparison.left === "total" && comparison.operator === ">=" && comparison.right === "limit"));
  assert.ok(!comparisons.some((comparison) => comparison.left === "return" && comparison.operator === "<"));
});

test("qwen_retry_policy encodes public delegate limits and non-stop recovery", async () => {
  const plugin = createTinyInfiPlugin();
  const policy = await plugin.tools.qwen_retry_policy({ estimatedTokens: 45000, attempt: 2, status: "rate_limited" });
  assert.equal(policy.model, "qwen3.6-35b-a3b");
  assert.equal(policy.limits.requestsPerMinute, 20);
  assert.equal(policy.limits.tokensPerMinute, 20000);
  assert.equal(policy.neverStop, true);
  assert.equal(policy.shouldRetry, true);
  assert.ok(policy.minimumBatches >= 3);
  assert.ok(policy.retryDelaysMs.every((delay) => delay >= 3000));
});

test("orchestration_health summarizes recoverable queue state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-health-"));
  const plugin = createTinyInfiPlugin({ root });
  await plugin.tools.public_dispatch({ prompt: "Analyze checkout flow", mustReturn: ["findings"] });
  const health = await plugin.tools.orchestration_health({});
  assert.equal(health.qwen.limits.requestsPerMinute, 20);
  assert.equal(health.qwen.limits.tokensPerMinute, 20000);
  assert.ok(health.publicJobs.total >= 1);
  assert.ok(health.recoverySteps.some((step) => step.includes("public_retry")));
  assert.ok(health.recoverySteps.some((step) => step.includes("task_checkpoint")));
});

test("orchestration_health treats checkpointed public jobs as attention", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-health-checkpointed-"));
  const plugin = createTinyInfiPlugin({ root });
  const job = await plugin.tools.public_dispatch({ prompt: "Analyze checkout flow", mustReturn: ["findings"] });
  await plugin.tools.public_checkpoint({ id: job.id, summary: "partial worker result", result: "half done" });
  const health = await plugin.tools.orchestration_health({});
  assert.equal(health.status, "attention");
  assert.equal(health.publicJobs.retryable, 1);
});

test("rules_snapshot writes architecture rules for future implementations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-infi-rules-"));
  const plugin = createTinyInfiPlugin({ root });
  const snapshot = await plugin.tools.rules_snapshot({
    evidenceRefs: ["src/opencode/tiny-plugin.ts", "src/opencode/plugin.ts", "test/small-model-resilience.test.mjs"],
  });
  assert.equal(snapshot.path, ".tiny/rules/architecture-patterns.md");
  assert.ok(snapshot.rules.some((rule) => rule.includes("createTinyInfiPlugin")));
  const markdown = await readFile(path.join(root, ".tiny", "rules", "architecture-patterns.md"), "utf8");
  assert.match(markdown, /OpenCode tool bridge/);
  assert.match(markdown, /Evidence refs/);
});
