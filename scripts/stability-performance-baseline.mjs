import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import {
  buildContextPacket,
  createTinyChuPlugin,
  loadContextBundle,
  PublicDispatcher,
  TaskStore,
  WikiBundler,
} from "../dist/index.js";

const DEFAULT_SECTION = "all";

function elapsedSince(start) {
  return Number((performance.now() - start).toFixed(3));
}

async function writeFixtureFile(root, relative, text) {
  const absolute = path.join(root, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

async function createRoot(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createFileBackedFixture() {
  const root = await createRoot("tiny-chu-perf-file-backed-");
  await writeFixtureFile(root, "AGENTS.md", "# Root Agent\n\nUse deterministic local fixtures.\n");
  await writeFixtureFile(root, "src/feature/AGENTS.md", "# Feature Agent\n\nPrefer nearest context.\n");
  await writeFixtureFile(root, ".tiny/rules/architecture.md", "# Architecture\n\nKeep file-backed state sorted.\n");
  await writeFixtureFile(root, ".github/copilot-instructions.md", "# Copilot\n\nStay inside root.\n");
  await writeFixtureFile(root, "src/feature/item.ts", "export const item = 'context target';\n");
  await writeFixtureFile(root, "docs/wiki/context.md", "# Context\n\nContext loading contract.\n");
  await writeFixtureFile(root, "docs/wiki/state.md", "# State\n\nState loading contract.\n");
  await writeFixtureFile(root, "docs/wiki/perf.md", "# Performance\n\nPerformance characterization.\n");
  await writeFixtureFile(root, ".tiny/wiki/index.json", `${JSON.stringify({
    version: 1,
    documents: [
      { id: "context", path: "docs/wiki/context.md", canonical: true, tags: ["core"] },
      { id: "state", path: "docs/wiki/state.md", canonical: true, tags: ["state"] },
      { id: "perf", path: "docs/wiki/perf.md", tags: ["perf"] },
    ],
  }, null, 2)}\n`);
  return root;
}

async function runFileBackedBaseline() {
  const root = await createFileBackedFixture();
  const contextStart = performance.now();
  const context = await loadContextBundle(root, "src/feature/item.ts");
  const contextPacket = await buildContextPacket({ root, targetPath: "src/feature/item.ts", maxChars: 4_000 });
  const contextElapsedMs = elapsedSince(contextStart);

  const wikiStart = performance.now();
  const wiki = await new WikiBundler(root).bundle(["context", "perf"]);
  const wikiElapsedMs = elapsedSince(wikiStart);

  const taskStore = new TaskStore({ root });
  const dispatcher = new PublicDispatcher({ root });
  const tasksStart = performance.now();
  for (let index = 0; index < 6; index += 1) {
    const task = await taskStore.create({ title: `Task ${index}`, notes: [`note-${index}`] });
    await taskStore.checkpoint(task.id, { summary: `checkpoint ${index}-a`, evidenceRefs: [`src/feature/item.ts:${index + 1}`] });
    await taskStore.checkpoint(task.id, { summary: `checkpoint ${index}-b`, nextSteps: [`next-${index}`] });
  }
  const tasks = await taskStore.list();
  const reloadedTasks = await Promise.all(tasks.map((task) => taskStore.get(task.id)));
  const tasksElapsedMs = elapsedSince(tasksStart);

  const publicStart = performance.now();
  for (let index = 0; index < 4; index += 1) {
    await dispatcher.dispatch({ prompt: `Analyze packet ${index}`, mustReturn: ["findings", "evidence"] });
  }
  const publicJobs = await dispatcher.list();
  const publicElapsedMs = elapsedSince(publicStart);

  const checkpointCount = reloadedTasks.reduce((sum, task) => sum + (task?.checkpoints.length ?? 0), 0);
  const elapsedMs = Number((contextElapsedMs + wikiElapsedMs + tasksElapsedMs + publicElapsedMs).toFixed(3));
  return {
    rootKind: "temp",
    elapsedMs,
    counts: {
      contextDocuments: context.documents.length,
      contextPacketRefs: contextPacket.evidence.length,
      wikiDocuments: wiki.refs.length,
      tasks: tasks.length,
      checkpoints: checkpointCount,
      publicJobs: publicJobs.length,
    },
    context: {
      elapsedMs: contextElapsedMs,
      documentCount: context.documents.length,
      textBytes: Buffer.byteLength(context.text, "utf8"),
      packetEvidenceCount: contextPacket.evidence.length,
      packetTextBytes: Buffer.byteLength(JSON.stringify(contextPacket), "utf8"),
    },
    wiki: {
      elapsedMs: wikiElapsedMs,
      documentCount: wiki.refs.length,
      textBytes: Buffer.byteLength(wiki.text, "utf8"),
    },
    tasks: {
      elapsedMs: tasksElapsedMs,
      count: tasks.length,
      checkpointCount,
    },
    publicJobs: {
      elapsedMs: publicElapsedMs,
      count: publicJobs.length,
    },
    checkpoints: {
      count: checkpointCount,
      maxPerTask: Math.max(...reloadedTasks.map((task) => task?.checkpoints.length ?? 0)),
    },
  };
}

async function createScannerFixture() {
  const root = await createRoot("tiny-chu-perf-scanners-");
  await writeFixtureFile(root, "src/ui/CheckoutButton.tsx", "export function CheckoutButton(){ return <button onClick={submitOrder}>Buy</button>; }\n");
  await writeFixtureFile(root, "src/ui/api-client.ts", "export const submitOrder = () => axios.post('/api/orders', { orderId: order.id, customerId: customer.id });\n");
  await writeFixtureFile(root, "src/api/routes.ts", "router.post('/api/orders').handler(createOrder)\n");
  await writeFixtureFile(root, "src/db/orders.sql", "SELECT order_id, customer_id, total_amount FROM orders WHERE total_amount >= 100;\n");
  await writeFixtureFile(root, "src/domain/pricing.ts", [
    "export function canCharge(order, customer) {",
    "  return order.total_amount >= customer.credit_limit && order.status !== 'cancelled';",
    "}",
  ].join("\n"));
  await writeFixtureFile(root, "src/main/java/OrderDto.java", "public class OrderDto { private String orderId; private String customerId; }\n");
  for (let index = 0; index < 24; index += 1) {
    await writeFixtureFile(root, `src/zz-generated/generated-${String(index).padStart(2, "0")}.ts`, `export const rule${index} = account.balance >= ${index};\n`);
  }
  return root;
}

async function runScannerBaseline() {
  const root = await createScannerFixture();
  const plugin = createTinyChuPlugin({ root });
  const maxFiles = 20;
  const maxItemsPerFile = 4;
  const maxEndpoints = 4;

  const repoStart = performance.now();
  const repoMap = await plugin.tools.repo_map({ targetPath: "src", maxFiles });
  const repoElapsedMs = elapsedSince(repoStart);

  const businessStart = performance.now();
  const businessLogicMap = await plugin.tools.business_logic_map({ targetPath: "src", maxFiles, maxItemsPerFile });
  const businessElapsedMs = elapsedSince(businessStart);

  const extensionStart = performance.now();
  const extensionScan = await plugin.tools.api_contract_catalog({ targetPath: ".", maxFiles, maxEndpoints, maxEvidenceRefs: 8 });
  const extensionElapsedMs = elapsedSince(extensionStart);

  const elapsedMs = Number((repoElapsedMs + businessElapsedMs + extensionElapsedMs).toFixed(3));
  return {
    rootKind: "temp",
    elapsedMs,
    caps: { maxFiles, maxItemsPerFile, maxEndpoints },
    counts: {
      repoMapFiles: repoMap.files.length,
      businessLogicFiles: businessLogicMap.files.length,
      apiContracts: extensionScan.contracts.length,
    },
    repoMap: {
      elapsedMs: repoElapsedMs,
      scannedFiles: repoMap.scannedFiles,
      files: repoMap.files.length,
      layers: repoMap.layers.map((layer) => layer.name),
      dataFlowHints: repoMap.dataFlowHints.length,
    },
    businessLogicMap: {
      elapsedMs: businessElapsedMs,
      scannedFiles: businessLogicMap.scannedFiles,
      files: businessLogicMap.files.length,
      maxComparisonsPerFile: Math.max(0, ...businessLogicMap.files.map((file) => file.comparisons.length)),
      maxColumnsPerFile: Math.max(0, ...businessLogicMap.files.map((file) => file.columns.length)),
    },
    extensionScan: {
      elapsedMs: extensionElapsedMs,
      contracts: extensionScan.contracts.length,
      mismatches: extensionScan.mismatches.length,
      verifiedContracts: extensionScan.contracts.filter((contract) => contract.status === "Verified").length,
    },
  };
}

export async function runStabilityPerformanceBaseline(options = {}) {
  const section = options.section ?? DEFAULT_SECTION;
  const started = performance.now();
  const fileBacked = section === "all" || section === "file-backed" ? await runFileBackedBaseline() : undefined;
  const scanners = section === "all" || section === "scanners" ? await runScannerBaseline() : undefined;
  const counts = { ...(fileBacked?.counts ?? {}), ...(scanners?.counts ?? {}) };
  return {
    schemaVersion: 1,
    section,
    elapsedMs: elapsedSince(started),
    ...(fileBacked ? fileBacked : {}),
    ...(scanners ? scanners : {}),
    counts,
  };
}

function cliArgs(argv) {
  const result = { section: DEFAULT_SECTION, out: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--section" && argv[index + 1]) {
      result.section = argv[index + 1];
      index += 1;
    } else if (item === "--out" && argv[index + 1]) {
      result.out = argv[index + 1];
      index += 1;
    }
  }
  return result;
}

async function main() {
  const args = cliArgs(process.argv.slice(2));
  const baseline = await runStabilityPerformanceBaseline({ section: args.section });
  const json = `${JSON.stringify(baseline, null, 2)}\n`;
  if (args.out) {
    await mkdir(path.dirname(args.out), { recursive: true });
    await writeFile(args.out, json, "utf8");
  } else {
    process.stdout.write(json);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
