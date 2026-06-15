import type { TinyChuRuntimeMode, TinyChuRuntimeModeInput } from "./tiny-plugin-types.js";

export type { TinyChuRuntimeMode, TinyChuRuntimeModeInput };

export class TinyChuRuntimeModeError extends Error {
  constructor(readonly value: unknown) {
    super(`Invalid Tiny-Chu mode: ${String(value)}`);
    this.name = "TinyChuRuntimeModeError";
  }
}

export class TinyChuModeDispatchError extends Error {
  constructor(readonly runtimeMode: TinyChuRuntimeMode, readonly toolName: string) {
    super(`Tiny-Chu ${runtimeMode} mode keeps ${toolName} packet-only; dispatch:true would write public worker queue state.`);
    this.name = "TinyChuModeDispatchError";
  }
}

export function normalizeTinyChuRuntimeMode(input: unknown): TinyChuRuntimeMode {
  if (input === undefined) return "orchestrator_worker";
  if (input === 1 || input === "1" || input === "mode1" || input === "worker" || input === "worker_only") return "worker";
  if (input === 2 || input === "2" || input === "mode2" || input === "orchestrator_worker") return "orchestrator_worker";
  throw new TinyChuRuntimeModeError(input);
}

export function isWorkerRuntimeMode(runtimeMode: TinyChuRuntimeMode): boolean {
  return runtimeMode === "worker";
}
