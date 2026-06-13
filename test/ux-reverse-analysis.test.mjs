import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ARTIFACT_TYPES, checkArtifactMarkdown, createTinyInfiPlugin } from "../dist/index.js";
import { TinyChuOpenCodePlugin } from "../dist/opencode/plugin.js";

async function writeFixture(root, relative, lines) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${lines.join("\n")}\n`, "utf8");
}

async function createUxFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-ux-"));
  await writeFixture(root, "src/ui/OrderSearch.jsx", [
    "import React from 'react';",
    "export function OrderSearch({ filters, dispatch }) {",
    "  const handleSearch = () => dispatch({ type: 'SEARCH_ORDERS', payload: { customerId: filters.customerId, status: filters.status, fromDate: filters.fromDate } });",
    "  return <section data-screen=\"OrderSearch\">",
    "    <div className=\"search-panel\">",
    "      <label>Customer ID<input name=\"customerId\" required maxLength={12} value={filters.customerId} /></label><label>Status<select name=\"status\" value={filters.status}><option value=\"OPEN\">Open</option><option value=\"CLOSED\">Closed</option></select></label>",
    "      <label>From Date<input name=\"fromDate\" type=\"date\" value={filters.fromDate} /></label>",
    "      <button onClick={handleSearch}>Search</button>",
    "    </div>",
    "    <DataGrid columns={[{ field: 'orderId', headerName: 'Order ID' }, { field: 'status', headerName: 'Status' }, { field: 'amount', headerName: 'Amount' }]} />",
    "    <span className=\"message\">orders.search.failure</span>",
    "  </section>;",
    "}",
  ]);
  await writeFixture(root, "src/api/orderApi.js", [
    "import axios from 'axios';",
    "export const searchOrders = (filters) => axios.get('/api/orders', { params: { customerId: filters.customerId, status: filters.status, fromDate: filters.fromDate } });",
  ]);
  await writeFixture(root, "src/main/java/com/example/OrderRequest.java", [
    "package com.example;",
    "public class OrderRequest {",
    "  private String customerId;",
    "  private String status;",
    "  private String fromDate;",
    "}",
  ]);
  await writeFixture(root, "src/main/resources/OrderMapper.xml", [
    "<mapper namespace=\"OrderMapper\">",
    "  <select id=\"searchOrders\">",
    "    SELECT ORDER_ID, STATUS, AMOUNT FROM ORDERS WHERE CUSTOMER_ID = #{customerId} AND STATUS = #{status} AND FROM_DATE &gt;= #{fromDate}",
    "  </select>",
    "</mapper>",
  ]);
  await writeFixture(root, "src/main/resources/messages.properties", [
    "orders.search.success=Search completed",
    "orders.search.failure=Search failed",
  ]);
  return root;
}

test("source-code-first UX reverse analysis produces evidence-backed report", async () => {
  assert.ok(ARTIFACT_TYPES.includes("ux_reverse_analysis"));
  const root = await createUxFixture();
  try {
    const tiny = createTinyInfiPlugin({ root });
    const toolPlan = await tiny.tools.tool_usage_plan({ objective: "reverse engineer screen UX layout rationale", artifactType: "ux_reverse_analysis" });
    assert.equal(toolPlan.steps[0].tinyTool, "ui_layout_catalog");
    assert.ok(toolPlan.verification.requiredTools.includes("layout_truth_verify"));

    const catalog = await tiny.tools.ui_layout_catalog({ targetPath: ".", maxFiles: 20, maxElements: 20, maxEvidenceRefs: 20 });
    assert.deepEqual(catalog.elements.filter((item) => item.area === "search_condition").map((item) => item.name), ["customerId", "status", "fromDate"]);
    assert.ok(catalog.elements.some((item) => item.area === "search_condition" && item.name === "customerId" && item.position.order === 1));
    assert.ok(catalog.elements.some((item) => item.area === "search_condition" && item.name === "status" && item.valueKind === "enum"));
    assert.ok(catalog.elements.some((item) => item.area === "result_field" && item.name === "orderId"));

    const rationale = await tiny.tools.ux_rationale_trace({ catalog, maxRationales: 20 });
    const customer = rationale.rationales.find((item) => item.elementName === "customerId");
    assert.equal(customer?.existenceRationale.status, "Verified");
    assert.equal(customer?.positionRationale.status, "Inferred");
    assert.ok(!Object.hasOwn(customer ?? {}, "llmHypothesis"));

    const validation = await tiny.tools.ux_validation_matrix({ catalog, maxValidationRules: 20 });
    const status = validation.fields.find((item) => item.elementName === "status");
    assert.equal(status?.valueKind, "enum");
    assert.ok(status?.clientRules.some((rule) => rule.kind === "options"));
    assert.ok(status?.serverRules.some((rule) => rule.kind === "mapper_param"));
    assert.ok(status?.messageEvidence.some((message) => message.key === "orders.search.failure"));

    const boundedReport = await tiny.tools.ux_reverse_report({
      catalog,
      rationale,
      validation: {
        fields: catalog.elements.filter((item) => item.area === "search_condition").map((item) => ({ elementName: item.name, valueKind: item.valueKind, clientRules: [], serverRules: [], messageEvidence: [], unknowns: [] })),
        unknowns: [],
        evidenceRefs: [],
      },
      maxElements: 2,
      maxRationales: 1,
      maxValidationRules: 1,
      maxEvidenceRefs: 20,
    });
    assert.match(boundedReport.markdown, /Omitted Layout Inventory: [1-9]/);
    assert.match(boundedReport.markdown, /Omitted Rationale Rows: [1-9]/);
    assert.match(boundedReport.markdown, /Omitted Validation Rows: [1-9]/);

    const report = await tiny.tools.ux_reverse_report({ catalog, rationale, validation, maxEvidenceRefs: 20 });
    assert.match(report.markdown, /## Screen Summary/);
    assert.match(report.markdown, /## Layout Inventory/);
    assert.match(report.markdown, /## Layout Truth/);
    assert.match(report.markdown, /## Existence Rationale/);
    assert.match(report.markdown, /## Position Rationale/);
    assert.match(report.markdown, /## Validation Matrix/);
    assert.match(report.markdown, /## Messages/);
    assert.match(report.markdown, /## Unknowns/);
    assert.match(report.markdown, /orders.search.failure/);
    const checked = checkArtifactMarkdown({ artifactType: "ux_reverse_analysis", markdown: report.markdown, evidenceRefs: report.evidenceRefs });
    assert.equal(checked.valid, true, JSON.stringify(checked.diagnostics));

    const hooks = await TinyChuOpenCodePlugin({
      project: { root },
      directory: root,
      worktree: root,
      client: { app: { log: async () => undefined } },
      $: async () => undefined,
    });
    for (const name of ["ui_layout_catalog", "ux_rationale_trace", "ux_validation_matrix", "layout_truth_verify", "layout_truth_update", "layout_truth_report", "ux_reverse_report"]) {
      assert.equal(typeof hooks.tool?.[name], "object", `${name} OpenCode tool missing`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("UX rationale stays conservative when only UI source order exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-ux-ui-only-"));
  try {
    await writeFixture(root, "src/ui/UiOnly.jsx", [
      "export function UiOnly() {",
      "  return <section data-screen=\"UiOnly\"><label>Keyword<input name=\"keyword\" /></label><label>Status<select name=\"status\"><option value=\"A\">A</option></select></label></section>;",
      "}",
    ]);
    const tiny = createTinyInfiPlugin({ root });
    const catalog = await tiny.tools.ui_layout_catalog({ targetPath: ".", maxFiles: 5, maxElements: 10 });
    const rationale = await tiny.tools.ux_rationale_trace({ catalog, maxRationales: 10 });
    const keyword = rationale.rationales.find((item) => item.elementName === "keyword");
    assert.equal(keyword?.existenceRationale.status, "Needs Verification");
    assert.equal(keyword?.positionRationale.status, "Needs Verification");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("layout truth memory verifies, marks stale, and rejects unsafe paths", async () => {
  const root = await createUxFixture();
  try {
    const tiny = createTinyInfiPlugin({ root });
    const catalog = await tiny.tools.ui_layout_catalog({ targetPath: ".", maxFiles: 20, maxElements: 20 });
    const rationale = await tiny.tools.ux_rationale_trace({ catalog, maxRationales: 20 });
    const first = await tiny.tools.layout_truth_update({ records: rationale.rationales, maxRecords: 20 });
    assert.equal(first.rejected.length, 0);
    assert.ok(first.records.some((item) => item.lifecycle === "verified"));

    const weaker = first.records.map((item) => ({ ...item, existenceRationale: { ...item.existenceRationale, status: "Unknown" } }));
    const second = await tiny.tools.layout_truth_update({ records: weaker, maxRecords: 20 });
    assert.ok(second.records.every((item) => item.existenceRationale.status !== "Unknown"));

    const verifyFresh = await tiny.tools.layout_truth_verify({});
    assert.ok(verifyFresh.verified.length > 0);
    assert.equal(verifyFresh.stale.length, 0);

    const uiFile = path.join(root, "src/ui/OrderSearch.jsx");
    const source = await readFile(uiFile, "utf8");
    await writeFile(uiFile, source.replace("Customer ID", "Customer Number"), "utf8");
    const verifyStale = await tiny.tools.layout_truth_verify({});
    assert.ok(verifyStale.stale.some((item) => item.elementName === "customerId"));

    const mapperPath = path.join(root, "src/main/resources/OrderMapper.xml");
    const mapperSource = await readFile(mapperPath, "utf8");
    await writeFile(uiFile, source, "utf8");
    await tiny.tools.layout_truth_update({ records: rationale.rationales, maxRecords: 20 });
    await writeFile(mapperPath, mapperSource.replace("#{customerId}", "#{buyerId}"), "utf8");
    const mapperStale = await tiny.tools.layout_truth_verify({});
    assert.ok(mapperStale.stale.some((item) => item.elementName === "customerId"));

    await writeFile(mapperPath, mapperSource, "utf8");
    await tiny.tools.layout_truth_update({ records: rationale.rationales, maxRecords: 20 });
    const uiOnlyWeaker = first.records.map((item) => ({
      ...item,
      evidenceRefs: item.evidenceRefs.slice(0, 1),
      existenceRationale: { ...item.existenceRationale, status: "Unknown", evidenceRefs: item.evidenceRefs.slice(0, 1) },
      validationRationale: { ...item.validationRationale, status: "Unknown", evidenceRefs: item.evidenceRefs.slice(0, 1) },
    }));
    await tiny.tools.layout_truth_update({ records: uiOnlyWeaker, maxRecords: 20 });
    const narrowedFresh = await tiny.tools.layout_truth_verify({});
    assert.equal(narrowedFresh.stale.length, 0);
    assert.ok(narrowedFresh.verified.some((item) => item.elementName === "customerId"));

    await writeFile(mapperPath, mapperSource.replace("#{customerId}", "#{buyerId}"), "utf8");
    const narrowedStale = await tiny.tools.layout_truth_verify({});
    assert.ok(narrowedStale.stale.some((item) => item.elementName === "customerId"));

    const report = await tiny.tools.layout_truth_report({});
    assert.match(report.markdown, /layout-truth.json/);
    assert.match(report.markdown, /customerId/);
    assert.match(report.markdown, /Stale: [1-9]/);
    assert.match(report.markdown, /## Stale Evidence Commands/);
    assert.match(report.markdown, /customerId: stale/);
    await assert.rejects(() => tiny.tools.layout_truth_update({ path: "../outside.json", records: [] }), /outside configured root/i);
    await assert.rejects(() => tiny.tools.layout_truth_update({ path: "layout-truth-outside-ux.json", records: [] }), /outside.*tiny.*ux/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
