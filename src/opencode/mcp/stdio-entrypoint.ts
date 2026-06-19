import { fileURLToPath } from "node:url";
import { createTinyChuPlugin } from "../tiny-plugin.js";
import { startMcpStdioLoop } from "./server.js";

export async function startDefaultTinyMcpStdioLoop(): Promise<void> {
  const tiny = createTinyChuPlugin({ root: process.cwd() });
  await startMcpStdioLoop({ registry: tiny.registry, input: process.stdin, output: process.stdout });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void startDefaultTinyMcpStdioLoop();
}
