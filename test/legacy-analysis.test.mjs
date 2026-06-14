import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";

async function writeFixtureFile(root, relativePath, lines) {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, lines.join("\n"), "utf8");
}

async function createLegacyFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-legacy-"));
  await writeFixtureFile(root, "package.json", [
    "{\"dependencies\":{\"react\":\"16.14.0\",\"redux-saga\":\"1.1.3\",\"axios\":\"0.21.4\"}}",
  ]);
  await writeFixtureFile(root, "pom.xml", [
    "<project>",
    "  <groupId>com.example</groupId>",
    "  <artifactId>legacy</artifactId>",
    "</project>",
  ]);
  await writeFixtureFile(root, "src/ui/OrderPage.jsx", [
    "import React from 'react';",
    "import { useDispatch } from 'react-redux';",
    "import { submitOrder } from '../state/orderActions';",
    "export function OrderPage() {",
    "  const dispatch = useDispatch();",
    "  const handleSubmitOrder = () => dispatch(submitOrder());",
    "  return <button onClick={handleSubmitOrder}>Submit Order</button>;",
    "}",
  ]);
  await writeFixtureFile(root, "src/state/orderActions.js", [
    "export const SUBMIT_ORDER = 'SUBMIT_ORDER';",
    "export const submitOrder = () => ({ type: SUBMIT_ORDER });",
  ]);
  await writeFixtureFile(root, "src/state/orderSaga.js", [
    "import { takeEvery, call } from 'redux-saga/effects';",
    "import { SUBMIT_ORDER } from './orderActions';",
    "import { createOrder } from '../api/orderClient';",
    "export function* watchSubmitOrder() { yield takeEvery(SUBMIT_ORDER, submitOrderWorker); }",
    "export function* submitOrderWorker(action) { yield call(createOrder, action.payload); }",
  ]);
  await writeFixtureFile(root, "src/api/orderClient.js", [
    "import axios from 'axios';",
    "export const createOrder = (payload) => axios.post('/api/orders', payload);",
  ]);
  await writeFixtureFile(root, "src/main/java/com/example/OrderController.java", [
    "package com.example;",
    "import org.springframework.web.bind.annotation.PostMapping;",
    "import org.springframework.web.bind.annotation.RestController;",
    "@RestController",
    "public class OrderController {",
    "  private final OrderService orderService;",
    "  @PostMapping(\"/api/orders\")",
    "  public OrderResponse createOrder(OrderRequest request) {",
    "    return orderService.createOrder(request);",
    "  }",
    "}",
  ]);
  await writeFixtureFile(root, "src/main/java/com/example/OrderService.java", [
    "package com.example;",
    "public class OrderService {",
    "  private OrderMapper orderMapper;",
    "  private SapRfcClient sapRfcClient;",
    "  public OrderResponse createOrder(OrderRequest request) {",
    "    orderMapper.insertOrder(request);",
    "    sapRfcClient.call(\"Z_CREATE_ORDER\", request);",
    "    return new OrderResponse();",
    "  }",
    "}",
  ]);
  await writeFixtureFile(root, "src/main/java/com/example/OrderMapper.java", [
    "package com.example;",
    "public interface OrderMapper {",
    "  void insertOrder(OrderRequest request);",
    "}",
  ]);
  await writeFixtureFile(root, "src/main/java/com/example/SapRfcClient.java", [
    "package com.example;",
    "public class SapRfcClient {",
    "  public void call(String functionName, Object request) {",
    "    execute(functionName, request);",
    "  }",
    "}",
  ]);
  await writeFixtureFile(root, "src/main/resources/mappers/OrderMapper.xml", [
    "<mapper namespace=\"com.example.OrderMapper\">",
    "  <insert id=\"insertOrder\" parameterType=\"OrderRequest\">",
    "    INSERT INTO ORDERS (ORDER_ID, CUSTOMER_ID) VALUES (#{orderId}, #{customerId})",
    "  </insert>",
    "</mapper>",
  ]);
  return root;
}

test("legacy analysis tools trace a button to backend integrations when evidence exists", async () => {
  const root = await createLegacyFixture();
  const plugin = createTinyChuPlugin({ root });

  const repoIndex = await plugin.tools.legacy_repo_index({ maxFiles: 80 });
  assert.ok(repoIndex.facts.some((fact) => fact.kind === "react_component" && fact.file === "src/ui/OrderPage.jsx"));
  assert.ok(repoIndex.facts.some((fact) => fact.kind === "mybatis_mapper" && fact.symbol === "insertOrder"));
  assert.ok(repoIndex.inventoryMarkdown.includes("Detected Frameworks"));

  const uiTrace = await plugin.tools.ui_action_trace({ label: "Submit Order", index: repoIndex });
  assert.equal(uiTrace.rows[0].uiElement.label, "Submit Order");
  assert.equal(uiTrace.rows[0].eventHandler.symbol, "handleSubmitOrder");
  assert.equal(uiTrace.rows[0].reduxAction.symbol, "SUBMIT_ORDER");
  assert.equal(uiTrace.rows[0].sagaWorker.symbol, "submitOrderWorker");
  assert.equal(uiTrace.rows[0].apiClient.path, "/api/orders");
  assert.equal(uiTrace.rows[0].confidence, "verified");

  const apiTrace = await plugin.tools.api_backend_trace({ method: "POST", path: "/api/orders", index: repoIndex });
  assert.equal(apiTrace.endpoint.path, "/api/orders");
  assert.equal(apiTrace.backendEntry.symbol, "createOrder");
  assert.equal(apiTrace.service.symbol, "OrderService.createOrder");
  assert.equal(apiTrace.integration.mapperId, "insertOrder");
  assert.equal(apiTrace.integration.rfcFunction, "Z_CREATE_ORDER");

  const catalog = await plugin.tools.integration_catalog({ index: repoIndex });
  assert.equal(catalog.dbCatalog[0].mapperId, "insertOrder");
  assert.equal(catalog.dbCatalog[0].operation, "insert");
  assert.deepEqual(catalog.dbCatalog[0].tables, ["ORDERS"]);
  assert.equal(catalog.rfcCatalog[0].functionName, "Z_CREATE_ORDER");

  const matrix = await plugin.tools.traceability_matrix({
    feature: "Submit order",
    uiTrace,
    apiTrace,
    integrationCatalog: catalog,
  });
  assert.equal(matrix.rows[0].feature, "Submit order");
  assert.equal(matrix.rows[0].uiEvent, "Submit Order");
  assert.equal(matrix.rows[0].api, "POST /api/orders");
  assert.equal(matrix.rows[0].mapperSql, "insertOrder");
  assert.equal(matrix.rows[0].rfcFunction, "Z_CREATE_ORDER");
  assert.equal(matrix.rows[0].status, "complete");
  assert.ok(matrix.markdown.includes("| Submit order |"));

  const qa = await plugin.tools.evidence_qa({ repoIndex, matrix });
  assert.deepEqual(qa.criticalBlockers, []);
  assert.equal(qa.status, "pass");
});

test("legacy analysis marks missing links unknown and evidence QA flags hallucinated symbols", async () => {
  const root = await createLegacyFixture();
  const plugin = createTinyChuPlugin({ root });
  const repoIndex = await plugin.tools.legacy_repo_index({ maxFiles: 80 });

  const apiTrace = await plugin.tools.api_backend_trace({ method: "DELETE", path: "/api/orders/404", index: repoIndex });
  assert.equal(apiTrace.status, "unmatched_endpoint");
  assert.equal(apiTrace.backendEntry.confidence, "unknown");

  const matrix = await plugin.tools.traceability_matrix({
    feature: "Delete missing order",
    apiTrace,
    integrationCatalog: { dbCatalog: [], rfcCatalog: [] },
  });
  assert.equal(matrix.rows[0].status, "partial");
  assert.match(matrix.rows[0].gap, /backend/i);

  const qa = await plugin.tools.evidence_qa({
    repoIndex,
    matrix,
    referencedSymbols: ["ImaginaryController.deleteOrder"],
  });
  assert.ok(qa.criticalBlockers.some((blocker) => blocker.includes("ImaginaryController.deleteOrder")));
  assert.equal(qa.status, "fail");
});

test("legacy analysis does not link unrelated API clients from a saga worker", async () => {
  const root = await createLegacyFixture();
  await writeFixtureFile(root, "src/state/orphanSaga.js", [
    "import { takeEvery } from 'redux-saga/effects';",
    "export function* watchOrphan() { yield takeEvery('ORPHAN_ACTION', orphanWorker); }",
    "export function* orphanWorker(action) { yield action.payload; }",
  ]);
  await writeFixtureFile(root, "src/ui/OrphanPage.jsx", [
    "import React from 'react';",
    "export function OrphanPage() {",
    "  const handleOrphan = () => dispatch(orphanAction());",
    "  return <button onClick={handleOrphan}>Orphan</button>;",
    "}",
  ]);
  await writeFixtureFile(root, "src/state/orphanActions.js", [
    "export const ORPHAN_ACTION = 'ORPHAN_ACTION';",
    "export const orphanAction = () => ({ type: ORPHAN_ACTION });",
  ]);

  const plugin = createTinyChuPlugin({ root });
  const trace = await plugin.tools.ui_action_trace({ label: "Orphan", maxFiles: 120 });
  assert.equal(trace.rows[0].sagaWorker.symbol, "orphanWorker");
  assert.equal(trace.rows[0].apiClient.symbol, "Unknown");
  assert.equal(trace.rows[0].confidence, "needs_verification");
});

test("legacy analysis does not link mapper or RFC calls from unrelated services", async () => {
  const root = await createLegacyFixture();
  await writeFixtureFile(root, "src/main/java/com/example/CancelController.java", [
    "package com.example;",
    "import org.springframework.web.bind.annotation.PostMapping;",
    "@RestController",
    "public class CancelController {",
    "  private final CancelService cancelService;",
    "  @PostMapping(\"/api/cancel\")",
    "  public CancelResponse cancelOrder(CancelRequest request) {",
    "    return cancelService.cancelOrder(request);",
    "  }",
    "}",
  ]);
  await writeFixtureFile(root, "src/main/java/com/example/CancelService.java", [
    "package com.example;",
    "public class CancelService {",
    "  public CancelResponse cancelOrder(CancelRequest request) {",
    "    return new CancelResponse();",
    "  }",
    "}",
  ]);

  const plugin = createTinyChuPlugin({ root });
  const trace = await plugin.tools.api_backend_trace({ method: "POST", path: "/api/cancel", maxFiles: 120 });
  assert.equal(trace.status, "matched");
  assert.equal(trace.backendEntry.symbol, "cancelOrder");
  assert.equal(trace.service.symbol, "CancelService.cancelOrder");
  assert.equal(trace.integration.mapperId, undefined);
  assert.equal(trace.integration.rfcFunction, undefined);
  assert.match(trace.missingEvidence.join(" "), /mapper/i);
});
