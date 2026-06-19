import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ARTIFACT_TYPES, checkArtifactMarkdown, createTinyChuPlugin, uxSourceFingerprint } from "../dist/index.js";
import { TinyChuOpenCodePlugin } from "../dist/opencode/plugin.js";
import { createPortableSymlink as symlink } from "./support/symlink.mjs";

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
    const tiny = createTinyChuPlugin({ root });
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
    const tiny = createTinyChuPlugin({ root });
    const catalog = await tiny.tools.ui_layout_catalog({ targetPath: ".", maxFiles: 5, maxElements: 10 });
    const rationale = await tiny.tools.ux_rationale_trace({ catalog, maxRationales: 10 });
    const keyword = rationale.rationales.find((item) => item.elementName === "keyword");
    assert.equal(keyword?.existenceRationale.status, "Needs Verification");
    assert.equal(keyword?.positionRationale.status, "Needs Verification");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("layout truth update rejects records without evidence-backed fingerprints", async () => {
  const root = await createUxFixture();
  try {
    const tiny = createTinyChuPlugin({ root });
    const result = await tiny.tools.layout_truth_update({
      records: [
        {
          truthId: "screen.order-search.no-evidence",
          screenId: "OrderSearch",
          elementId: "no-evidence",
          elementName: "No Evidence",
          area: "search_condition",
          existenceRationale: { status: "Verified", reason: "Claim without a source line", evidenceRefs: [] },
          positionRationale: { status: "Verified", reason: "Claim without a source line", evidenceRefs: [] },
          validationRationale: { status: "Unknown", reason: "No validation evidence", evidenceRefs: [] },
          messageRationale: { status: "Unknown", reason: "No message evidence", evidenceRefs: [] },
          sourceFingerprint: "",
          evidenceRefs: [],
          lifecycle: "verified",
          version: 1,
        },
      ],
      maxRecords: 20,
    });
    assert.match(result.rejected.join("\n"), /evidence/i);
    assert.equal(result.records.some((item) => item.truthId === "screen.order-search.no-evidence"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("layout truth update refuses source-order-only verified position rationale", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-layout-source-order-"));
  try {
    await writeFixture(root, "src/ui/UiOnly.jsx", [
      "export function UiOnly() {",
      "  return <section data-screen=\"UiOnly\"><label>Keyword<input name=\"keyword\" /></label><label>Status<select name=\"status\"><option value=\"A\">A</option></select></label></section>;",
      "}",
    ]);
    const tiny = createTinyChuPlugin({ root });
    const result = await tiny.tools.layout_truth_update({
      records: [
        {
          truthId: "ui-only.keyword",
          screenId: "UiOnly",
          elementId: "keyword",
          elementName: "keyword",
          area: "search_condition",
          existenceRationale: { status: "Needs Verification", reason: "Only UI label/input source exists", evidenceRefs: ["src/ui/UiOnly.jsx:2"] },
          positionRationale: { status: "Verified", reason: "First because of source order only", evidenceRefs: ["src/ui/UiOnly.jsx:2"] },
          validationRationale: { status: "Unknown", reason: "No backend validation evidence", evidenceRefs: [] },
          messageRationale: { status: "Unknown", reason: "No message evidence", evidenceRefs: [] },
          sourceFingerprint: "",
          evidenceRefs: ["src/ui/UiOnly.jsx:2"],
          lifecycle: "verified",
          version: 1,
        },
      ],
      maxRecords: 20,
    });
    const keyword = result.records.find((item) => item.truthId === "ui-only.keyword");
    assert.notEqual(keyword?.positionRationale.status, "Verified");
    assert.equal(keyword?.lifecycle, "needs_review");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("layout truth update refuses semantic source-order or convention verified position rationale", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-layout-semantic-source-order-"));
  try {
    await writeFixture(root, "src/ui/UiOnly.jsx", [
      "export function UiOnly() {",
      "  return <section data-screen=\"UiOnly\"><label>Keyword<input name=\"keyword\" /></label><label>Status<select name=\"status\"><option value=\"A\">A</option></select></label></section>;",
      "}",
    ]);
    const tiny = createTinyChuPlugin({ root });
    const result = await tiny.tools.layout_truth_update({
      records: [
        {
          truthId: "ui-only.keyword.semantic",
          screenId: "UiOnly",
          elementId: "keyword",
          elementName: "keyword",
          area: "search_condition",
          existenceRationale: { status: "Needs Verification", reason: "Only UI label/input source exists", evidenceRefs: ["src/ui/UiOnly.jsx:2"] },
          positionRationale: { status: "Verified", reason: "First because the input appears before Status in the JSX source and admin search forms normally put keyword first.", evidenceRefs: ["src/ui/UiOnly.jsx:2"] },
          validationRationale: { status: "Unknown", reason: "No backend validation evidence", evidenceRefs: [] },
          messageRationale: { status: "Unknown", reason: "No message evidence", evidenceRefs: [] },
          sourceFingerprint: "",
          evidenceRefs: ["src/ui/UiOnly.jsx:2"],
          lifecycle: "verified",
          version: 1,
        },
      ],
      maxRecords: 20,
    });
    const keyword = result.records.find((item) => item.truthId === "ui-only.keyword.semantic");
    assert.notEqual(keyword?.positionRationale.status, "Verified");
    assert.equal(keyword?.lifecycle, "needs_review");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("layout truth verify treats unsupported verified position rationale as review target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-layout-verify-policy-"));
  try {
    await writeFixture(root, "src/ui/UiOnly.jsx", [
      "export function UiOnly() {",
      "  return <section data-screen=\"UiOnly\"><label>Keyword<input name=\"keyword\" /></label></section>;",
      "}",
    ]);
    await mkdir(path.join(root, ".tiny", "ux"), { recursive: true });
    const text = "  return <section data-screen=\"UiOnly\"><label>Keyword<input name=\"keyword\" /></label></section>;";
    const fingerprint = `src/ui/UiOnly.jsx:2=${uxSourceFingerprint("src/ui/UiOnly.jsx", 2, text)}`;
    await writeFile(path.join(root, ".tiny", "ux", "layout-truth.json"), `${JSON.stringify([
      {
        truthId: "ui-only.keyword.verify",
        screenId: "UiOnly",
        elementId: "keyword",
        elementName: "keyword",
        area: "search_condition",
        existenceRationale: { status: "Needs Verification", reason: "Only UI label/input source exists", evidenceRefs: ["src/ui/UiOnly.jsx:2"] },
        positionRationale: { status: "Verified", reason: "First because the input appears before other fields in source and admin forms normally put keyword first.", evidenceRefs: ["src/ui/UiOnly.jsx:2"] },
        validationRationale: { status: "Unknown", reason: "No backend validation evidence", evidenceRefs: [] },
        messageRationale: { status: "Unknown", reason: "No message evidence", evidenceRefs: [] },
        sourceFingerprint: fingerprint,
        evidenceRefs: ["src/ui/UiOnly.jsx:2"],
        lifecycle: "verified",
        version: 1,
      },
    ], null, 2)}\n`, "utf8");

    const tiny = createTinyChuPlugin({ root });
    const verified = await tiny.tools.layout_truth_verify({});
    assert.equal(verified.verified.some((item) => item.truthId === "ui-only.keyword.verify"), false);
    assert.ok(verified.reviewTargets.some((item) => item.truthId === "ui-only.keyword.verify" && item.positionRationale.status !== "Verified"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("layout truth update drops existing records without evidence-backed fingerprints", async () => {
  const root = await createUxFixture();
  try {
    await mkdir(path.join(root, ".tiny", "ux"), { recursive: true });
    await writeFile(path.join(root, ".tiny", "ux", "layout-truth.json"), `${JSON.stringify([
      {
        truthId: "legacy.invalid",
        screenId: "OrderSearch",
        elementId: "legacy",
        elementName: "legacy",
        area: "search_condition",
        existenceRationale: { status: "Verified", reason: "Old invalid record", evidenceRefs: ["src/ui/DoesNotExist.jsx:1"] },
        positionRationale: { status: "Verified", reason: "Old invalid position", evidenceRefs: ["src/ui/DoesNotExist.jsx:1"] },
        validationRationale: { status: "Unknown", reason: "No validation evidence", evidenceRefs: [] },
        messageRationale: { status: "Unknown", reason: "No message evidence", evidenceRefs: [] },
        sourceFingerprint: "stale",
        evidenceRefs: ["src/ui/DoesNotExist.jsx:1"],
        lifecycle: "verified",
        version: 1,
      },
    ], null, 2)}\n`, "utf8");

    const tiny = createTinyChuPlugin({ root });
    const result = await tiny.tools.layout_truth_update({ records: [], maxRecords: 20 });
    assert.match(result.rejected.join("\n"), /existing.*legacy\.invalid/i);
    assert.equal(result.records.some((item) => item.truthId === "legacy.invalid"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("layout truth rejects symlink evidence refs that escape root", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-layout-evidence-symlink-"));
  const root = path.join(parent, "repo");
  const outside = path.join(parent, "outside");
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "secret.ts"), "export const secret = true;\n", "utf8");
    await symlink(path.join(outside, "secret.ts"), path.join(root, "src", "secret.ts"));
    const tiny = createTinyChuPlugin({ root });
    const result = await tiny.tools.layout_truth_update({
      records: [
        {
          truthId: "escape.secret",
          screenId: "Escape",
          elementId: "secret",
          elementName: "secret",
          area: "search_condition",
          existenceRationale: { status: "Verified", reason: "Symlink evidence should not count", evidenceRefs: ["src/secret.ts:1"] },
          positionRationale: { status: "Inferred", reason: "Not relevant", evidenceRefs: ["src/secret.ts:1"] },
          validationRationale: { status: "Unknown", reason: "No validation evidence", evidenceRefs: [] },
          messageRationale: { status: "Unknown", reason: "No message evidence", evidenceRefs: [] },
          sourceFingerprint: "",
          evidenceRefs: ["src/secret.ts:1"],
          lifecycle: "verified",
          version: 1,
        },
      ],
      maxRecords: 20,
    });
    assert.match(result.rejected.join("\n"), /fingerprint|evidence/i);
    assert.equal(result.records.some((item) => item.truthId === "escape.secret"), false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("layout truth rejects symlinked storage targets that escape root", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-layout-storage-symlink-"));
  const root = path.join(parent, "repo");
  const outside = path.join(parent, "outside");
  try {
    await mkdir(path.join(root, ".tiny"), { recursive: true });
    await mkdir(path.join(outside, "ux"), { recursive: true });
    await symlink(path.join(outside, "ux"), path.join(root, ".tiny", "ux"));
    const tiny = createTinyChuPlugin({ root });
    await assert.rejects(() => tiny.tools.layout_truth_update({ records: [] }), /outside.*root|outside configured root/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("layout truth rejects symlinked layout truth files that escape root", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-layout-file-symlink-"));
  const root = path.join(parent, "repo");
  const outside = path.join(parent, "outside");
  try {
    await mkdir(path.join(root, ".tiny", "ux"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "layout-truth.json"), "[]\n", "utf8");
    await symlink(path.join(outside, "layout-truth.json"), path.join(root, ".tiny", "ux", "layout-truth.json"));
    const tiny = createTinyChuPlugin({ root });
    await assert.rejects(() => tiny.tools.layout_truth_update({ records: [] }), /outside.*root|outside configured root/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("layout truth rejects dangling symlinked layout truth files before write", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-layout-dangling-file-symlink-"));
  const root = path.join(parent, "repo");
  const outside = path.join(parent, "outside");
  try {
    await mkdir(path.join(root, ".tiny", "ux"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(path.join(outside, "missing-layout-truth.json"), path.join(root, ".tiny", "ux", "layout-truth.json"));
    const tiny = createTinyChuPlugin({ root });
    await assert.rejects(() => tiny.tools.layout_truth_update({ records: [] }), /symlink|outside.*root|outside configured root/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("layout truth rejects intermediate symlink under ux without outside side effects", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-layout-intermediate-symlink-"));
  const root = path.join(parent, "repo");
  const outside = path.join(parent, "outside");
  try {
    await mkdir(path.join(root, ".tiny", "ux"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(root, ".tiny", "ux", "link"));
    const tiny = createTinyChuPlugin({ root });
    await assert.rejects(
      () => tiny.tools.layout_truth_update({ path: ".tiny/ux/link/sub/layout-truth.json", records: [] }),
      /symlink|outside.*root|outside configured root/i,
    );
    await assert.rejects(() => readdir(path.join(outside, "sub")), /ENOENT/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("layout truth report emits PowerShell-safe stale commands", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-layout-pwsh-report-"));
  const evidencePath = "src/screen'; semi.ts";
  const evidenceLine = "export const customer = true;";
  const elementName = "customer'; Write-Host PWNED; '\nnext";
  const evidenceRef = `${evidencePath}:1`;
  try {
    await writeFixture(root, evidencePath, [evidenceLine]);
    await mkdir(path.join(root, ".tiny", "ux"), { recursive: true });
    await writeFile(path.join(root, ".tiny", "ux", "layout-truth.json"), `${JSON.stringify([
      {
        truthId: "hostile.command",
        screenId: "Hostile",
        elementId: "hostile",
        elementName,
        area: "search_condition",
        existenceRationale: { status: "Verified", reason: "Direct source evidence", evidenceRefs: [evidenceRef] },
        positionRationale: { status: "Verified", reason: "Direct rendered layout evidence", evidenceRefs: [evidenceRef] },
        validationRationale: { status: "Unknown", reason: "No validation evidence", evidenceRefs: [] },
        messageRationale: { status: "Unknown", reason: "No message evidence", evidenceRefs: [] },
        sourceFingerprint: `stale:${uxSourceFingerprint(evidencePath, 1, evidenceLine)}`,
        evidenceRefs: [evidenceRef],
        lifecycle: "verified",
        version: 1,
      },
    ], null, 2)}\n`, "utf8");
    const tiny = createTinyChuPlugin({ root });
    const report = await tiny.tools.layout_truth_report({});
    const staleLine = report.markdown.split(/\r?\n/).find((line) => line.includes("rg -n --"));
    assert.ok(staleLine);
    assert.doesNotMatch(staleLine, /'\\''/);
    assert.match(staleLine, /'customer''; Write-Host PWNED; ''\\nnext'/);
    assert.match(staleLine, /'src\/screen''; semi\.ts'/);
    assert.equal(report.markdown.split(/\r?\n/).some((line) => line.startsWith("next")), false);
    assert.equal(report.markdown.split(/\r?\n/).some((line) => line.startsWith("semi.ts")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("UI UX policy docs define layout truth update rules", async () => {
  const repoRoot = path.resolve(".");
  const architecture = await readFile(path.join(repoRoot, ".tiny/rules/architecture-patterns.md"), "utf8");
  const usage = await readFile(path.join(repoRoot, "HOW_TO_USE.md"), "utf8");
  const policyDocs = `${architecture}\n${usage}`;
  assert.match(policyDocs, /purpose -> state -> data -> action -> feedback -> record/);
  assert.match(policyDocs, /layout_truth_verify before reuse/);
  assert.match(policyDocs, /stale\/missing.*review targets/i);
  assert.match(policyDocs, /source-order-only.*Verified/i);
  assert.match(policyDocs, /convention-only.*Verified/i);
});

test("layout truth memory verifies, marks stale, and rejects unsafe paths", async () => {
  const root = await createUxFixture();
  try {
    const tiny = createTinyChuPlugin({ root });
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
