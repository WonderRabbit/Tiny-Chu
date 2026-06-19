import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";

async function put(root, relativePath, lines) {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, lines.join("\n"), "utf8");
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-extension-tools-"));
  await put(root, "package.json", ["{\"dependencies\":{\"react\":\"16.14.0\",\"redux-saga\":\"1.1.3\",\"axios\":\"0.21.4\"}}"]);
  await put(root, "src/ui/OrderPage.jsx", [
    "export function OrderPage({ canApprove }) {",
    "  return <button disabled={!canApprove} onClick={submitOrder}>Submit Order</button>;",
    "}",
  ]);
  await put(root, "src/state/orderReducer.js", [
    "export const selectOrder = (state) => state.order;",
    "export function orderReducer(state = {}, action) {",
    "  switch (action.type) {",
    "    case 'SUBMIT_ORDER_SUCCESS': return { ...state, saved: true };",
    "    default: return state;",
    "  }",
    "}",
  ]);
  await put(root, "src/state/orderSaga.js", [
    "import { call, put, select } from 'redux-saga/effects';",
    "import { createOrder } from '../api/orderClient';",
    "export function* submitOrderWorker(action) {",
    "  try {",
    "    const order = yield select(selectOrder);",
    "    yield call(createOrder, { orderId: action.orderId, customerId: order.customerId });",
    "    yield put({ type: 'SUBMIT_ORDER_SUCCESS' });",
    "  } catch (error) { yield put({ type: 'SUBMIT_ORDER_FAILED', error }); }",
    "}",
  ]);
  await put(root, "src/api/orderClient.js", [
    "import axios from 'axios';",
    "axios.interceptors.request.use((config) => ({ ...config, headers: { Role: 'ORDER_ADMIN' } }));",
    "export const createOrder = (payload) => axios.post('/api/orders', { orderId: payload.orderId, customerId: payload.customerId });",
  ]);
  await put(root, "src/main/java/com/example/OrderVerticle.java", [
    "router.post('/api/orders').handler(this::createOrder);",
    "public void createOrder(RoutingContext ctx) {",
    "  if (!ctx.user().principal().containsKey('ORDER_ADMIN')) { ctx.fail(403); return; }",
    "  try { orderService.createOrder(new OrderRequest()); } catch (Exception ex) { ctx.fail(ex); }",
    "}",
  ]);
  await put(root, "src/main/java/com/example/OrderRequest.java", [
    "public class OrderRequest {",
    "  private String orderId;",
    "  private String customerId;",
    "}",
  ]);
  await put(root, "src/main/java/com/example/OrderService.java", [
    "@Transactional",
    "public class OrderService {",
    "  public void createOrder(OrderRequest request) {",
    "    orderMapper.insertOrder(request);",
    "    JCoUtil.call('Z_CREATE_ORDER', request);",
    "  }",
    "}",
  ]);
  await put(root, "src/main/resources/mappers/OrderMapper.xml", [
    "<mapper namespace=\"com.example.OrderMapper\">",
    "  <insert id=\"insertOrder\">INSERT INTO ORDERS (ORDER_ID, CUSTOMER_ID) VALUES (#{orderId}, #{customerId})</insert>",
    "</mapper>",
  ]);
  await put(root, "test/order.test.js", ["test('submits order', () => {});"]);
  return root;
}

function acceptedButtonPlan(workItems) {
  return {
    objective: "Dispatch button workers with evidence",
    scopePaths: ["src/Page.jsx"],
    workItems,
    evidenceRequirements: ["public job JSON", "button evidence refs"],
    qaCommands: ["node --test test/extension-tools.test.mjs"],
    stopConditions: ["all dispatched jobs persisted"],
    sourceOfTruthRefs: ["AGENTS.md"],
  };
}

test("extension tools produce bounded JSON evidence for small-model analysis", async () => {
  const root = await fixture();
  const plugin = createTinyChuPlugin({ root });
  const required = [
    "environment_doctor",
    "api_contract_catalog",
    "dto_schema_map",
    "redux_state_flow_map",
    "auth_permission_trace",
    "error_transaction_map",
    "test_impact_planner",
    "worker_packet_optimizer",
    "artifact_pack_manifest",
    "incremental_evidence_cache",
  ];
  for (const name of required) assert.equal(typeof plugin.tools[name], "function", `${name} tool must be registered`);

  const doctor = await plugin.tools.environment_doctor({ timeoutMs: 300 });
  assert.ok(doctor.checks.some((check) => check.name === "node"));

  const contracts = await plugin.tools.api_contract_catalog({ targetPath: ".", maxEndpoints: 10 });
  assert.ok(contracts.contracts.some((item) => item.path === "/api/orders" && item.status === "Verified"));

  const schema = await plugin.tools.dto_schema_map({ targetPath: ".", maxFiles: 40 });
  assert.ok(schema.symbols.some((item) => item.name === "orderId"));
  assert.ok(schema.links.some((item) => item.status === "Verified" || item.status === "Inferred"));

  const redux = await plugin.tools.redux_state_flow_map({ targetPath: "src", maxFiles: 20 });
  assert.ok(redux.selectors.some((item) => item.symbol === "selectOrder"));
  assert.ok(redux.writes.some((item) => item.symbol === "SUBMIT_ORDER_SUCCESS"));

  const auth = await plugin.tools.auth_permission_trace({ targetPath: ".", maxFiles: 40 });
  assert.ok(auth.conditions.some((item) => item.expression.includes("ORDER_ADMIN")));
  assert.ok(auth.risks.some((item) => item.includes("backend")));

  const errors = await plugin.tools.error_transaction_map({ targetPath: ".", maxFiles: 40 });
  assert.ok(errors.errorHandlers.some((item) => item.kind.includes("catch")));
  assert.ok(errors.transactionBoundaries.some((item) => item.kind === "transaction"));

  const impact = await plugin.tools.test_impact_planner({ changeRequest: "Change order customer validation", targetPath: "." });
  assert.ok(impact.existingTestCandidates.some((item) => item.path === "test/order.test.js"));
  assert.ok(impact.missingTestCases.length > 0);

  const packet = await plugin.tools.worker_packet_optimizer({
    objective: "Analyze order flow",
    evidenceRefs: ["src/ui/OrderPage.jsx:2", "src/main/java/com/example/OrderService.java:4"],
    dispatch: false,
  });
  assert.ok(packet.packets.length >= 1);
  assert.equal(packet.dispatchOrder.length, packet.packets.length);

  const manifest = await plugin.tools.artifact_pack_manifest({
    artifacts: [{ type: "as_is", status: "pass", evidenceRefs: ["src/ui/OrderPage.jsx:2"], qaStatus: "pass" }],
  });
  assert.equal(manifest.publishReady, false);
  assert.ok(manifest.missingArtifacts.includes("flowchart"));

  const first = await plugin.tools.incremental_evidence_cache({ targetPath: "src/ui/OrderPage.jsx" });
  await put(root, "src/ui/OrderPage.jsx", ["export function OrderPage() { return <button>Changed</button>; }"]);
  const second = await plugin.tools.incremental_evidence_cache({ targetPath: "src/ui/OrderPage.jsx", previous: first });
  assert.ok(second.staleReasons.length > 0);
  assert.ok(second.recommendedRescanTools.includes("legacy_repo_index"));
});

test("extension tools honor explicit small-model output caps", async () => {
  const root = await fixture();
  for (let index = 0; index < 12; index += 1) {
    await put(root, `src/api/client${index}.js`, [
      "import axios from 'axios';",
      `export const save${index} = (payload) => axios.post('/api/orders', { orderId: payload.orderId, customerId: payload.customerId, field${index}: payload.field${index} });`,
    ]);
    await put(root, `src/main/java/com/example/Route${index}.java`, [
      `router.post('/api/orders').handler(this::handler${index});`,
      `private String field${index};`,
    ]);
  }
  const plugin = createTinyChuPlugin({ root });

  const doctor = await plugin.tools.environment_doctor({ toolNames: ["node"], timeoutMs: 300 });
  assert.deepEqual(doctor.checks.map((check) => check.name), ["node"]);

  const contracts = await plugin.tools.api_contract_catalog({ targetPath: ".", maxEndpoints: 1, maxRequestKeys: 2, maxEvidenceRefs: 2 });
  assert.equal(contracts.contracts.length, 1);
  assert.ok(contracts.contracts.every((contract) => contract.requestKeys.length <= 2));
  assert.ok(contracts.contracts.every((contract) => contract.evidenceRefs.length <= 2));

  const schema = await plugin.tools.dto_schema_map({ targetPath: ".", maxSymbols: 3, maxLinks: 2 });
  assert.equal(schema.symbols.length, 3);
  assert.ok(schema.links.length <= 2);

  const redux = await plugin.tools.redux_state_flow_map({ targetPath: ".", maxItems: 1, maxLinks: 1 });
  assert.ok(redux.selectors.length <= 1);
  assert.ok(redux.writes.length <= 1);
  assert.ok(redux.links.length <= 1);

  const auth = await plugin.tools.auth_permission_trace({ targetPath: ".", maxConditions: 1, maxLinks: 1 });
  assert.ok(auth.conditions.length <= 1);
  assert.ok(auth.links.length <= 1);

  const errors = await plugin.tools.error_transaction_map({ targetPath: ".", maxItems: 1 });
  assert.ok(errors.errorHandlers.length <= 1);
  assert.ok(errors.transactionBoundaries.length <= 1);

  const impact = await plugin.tools.test_impact_planner({ changeRequest: "Change order flow", maxTests: 1, maxMissingTestCases: 1 });
  assert.ok(impact.existingTestCandidates.length <= 1);
  assert.ok(impact.missingTestCases.length <= 1);

  const packet = await plugin.tools.worker_packet_optimizer({
    objective: "Analyze order flow",
    evidenceRefs: ["a.ts:1", "b.ts:2", "c.ts:3", "d.ts:4", "e.ts:5"],
    maxEvidenceRefsPerPacket: 2,
    maxFilesPerPacket: 1,
    maxPackets: 2,
    dispatch: false,
  });
  assert.equal(packet.packets.length, 2);
  assert.deepEqual(packet.dispatchOrder, [1, 2]);
  assert.ok(packet.packets.every((item) => item.evidenceRefs.length <= 2));
  assert.ok(packet.packets.every((item) => item.boundedFiles.length <= 1));

  const manifest = await plugin.tools.artifact_pack_manifest({
    maxArtifacts: 2,
    artifacts: [
      { type: "as_is", status: "pass", evidenceRefs: ["a.ts:1"], qaStatus: "pass" },
      { type: "ui_definition", status: "pass", evidenceRefs: ["b.ts:2"], qaStatus: "pass" },
      { type: "test_case", status: "pass", evidenceRefs: ["c.ts:3"], qaStatus: "pass" },
    ],
  });
  assert.equal(manifest.artifacts.length, 2);
  assert.equal(manifest.omittedArtifacts, 1);

  const cache = await plugin.tools.incremental_evidence_cache({ targetPath: ".", maxInputs: 2 });
  assert.ok(cache.inputs.length <= 2);
});

test("redux and auth flow maps report omitted links for oversized linked data", async () => {
  const root = await fixture();
  for (let index = 0; index < 12; index += 1) {
    await put(root, `src/state/feature${index}.js`, [
      `export const selectFeature${index} = (state) => state.feature${index};`,
      `export function* readFeature${index}() {`,
      `  const value${index} = yield select(selectFeature${index});`,
      `  yield put({ type: 'FEATURE_${index}_READ', value: value${index} });`,
      "}",
    ]);
    await put(root, `src/ui/Auth${index}.jsx`, [
      `export function Auth${index}({ canView${index} }) {`,
      `  return <button disabled={!canView${index}}>Feature ${index}</button>;`,
      "}",
    ]);
    await put(root, `src/main/java/com/example/Auth${index}.java`, [
      `if (!ctx.user().principal().containsKey('FEATURE_${index}')) { ctx.fail(403); return; }`,
    ]);
  }
  const plugin = createTinyChuPlugin({ root });

  const redux = await plugin.tools.redux_state_flow_map({ targetPath: "src", maxItems: 40, maxLinks: 5 });
  assert.ok(redux.links.length <= 5);
  assert.ok(redux.omittedLinks > 0);

  const auth = await plugin.tools.auth_permission_trace({ targetPath: "src", maxConditions: 40, maxLinks: 5 });
  assert.ok(auth.links.length <= 5);
  assert.ok(auth.omittedLinks > 0);
});

test("evidence snapshot summarizes bounded evidence and tool plan reuse hints", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-evidence-snapshot-"));
  await put(root, ".omo/evidence/task-1.txt", ["src/a.ts:1", "ok"]);
  await put(root, ".omo/evidence/task-2.txt", ["src/b.ts:2", "ok"]);
  const plugin = createTinyChuPlugin({ root });
  const snapshot = await plugin.tools.evidence_snapshot({ evidenceDir: ".omo/evidence", maxFiles: 1 });
  assert.equal(snapshot.files.length, 1);
  assert.equal(snapshot.omittedFiles, 1);
  assert.ok(snapshot.sourceRefs.includes("src/a.ts:1"));
  const empty = await plugin.tools.evidence_snapshot({ evidenceDir: ".omo/not-real", maxFiles: 3 });
  assert.equal(empty.status, "empty");
  const plan = await plugin.tools.tool_usage_plan({ objective: "reuse previous evidence while tracing API" });
  assert.ok(plan.reuseEvidence.some((item) => item.tool === "evidence_snapshot"));
});

test("button workflow dispatch is sequential by default and capped at two", async () => {
  const root = await fixture();
  const plugin = createTinyChuPlugin({ root });
  const plan = await plugin.tools.button_workflow_plan({ targetPath: "src/ui/OrderPage.jsx", maxButtons: 10 });
  assert.equal(plan.workItems.length, 1);
  assert.equal(plan.workItems[0].label, "Submit Order");

  const task = await plugin.tools.task_create({ title: "Button workflow" });
  const many = acceptedButtonPlan(
    ["a", "b", "c"].map((id, index) => ({
      buttonId: id,
      file: "src/Page.jsx",
      line: index + 1,
      label: id,
      handler: id,
      evidenceRefs: [`src/Page.jsx:${index + 1}`],
    })),
  );
  const one = await plugin.tools.button_workflow_dispatch({ taskId: task.id, plan: many });
  assert.equal(one.dispatched.length, 1);
  assert.equal(one.remaining.length, 2);
  assert.ok(one.dispatched.every((job) => job.contract.format === "json"));
  await assert.rejects(() => plugin.tools.button_workflow_dispatch({ taskId: task.id, plan: many, maxParallel: 3 }), /maxParallel/);
});

test("seven button workflow stays one button per worker", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-seven-buttons-"));
  await put(root, "src/Page.jsx", [
    "export function Page(){ return <div>",
    "<button onClick={a}>A</button>",
    "<button onClick={b}>B</button>",
    "<button onClick={c}>C</button>",
    "<button onClick={d}>D</button>",
    "<button onClick={e}>E</button>",
    "<button onClick={f}>F</button>",
    "<button onClick={g}>G</button>",
    "</div>; }",
  ]);
  const plugin = createTinyChuPlugin({ root });
  const plan = await plugin.tools.button_workflow_plan({ targetPath: "src/Page.jsx", maxButtons: 10 });
  assert.equal(plan.workItems.length, 7);
  assert.equal(new Set(plan.workItems.map((item) => item.buttonId)).size, 7);
  const packets = plan.workItems.map((workItem) => plugin.tools.button_worker_packet({ workItem }));
  const resolved = await Promise.all(packets);
  assert.ok(resolved.every((packet) => packet.buttonIds.length === 1));
});
