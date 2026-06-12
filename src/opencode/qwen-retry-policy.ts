export interface QwenPublicLimits {
  readonly requestsPerMinute: number;
  readonly tokensPerMinute: number;
  readonly requestSpacingMs: number;
}

export interface QwenRetryPolicyResult {
  readonly model: "qwen3.6-35b-a3b";
  readonly limits: QwenPublicLimits;
  readonly estimatedTokens: number;
  readonly minimumBatches: number;
  readonly attempt: number;
  readonly shouldRetry: boolean;
  readonly neverStop: true;
  readonly retryDelaysMs: readonly number[];
  readonly recoveryProtocol: readonly string[];
}

export const QWEN_PUBLIC_LIMITS: QwenPublicLimits = {
  requestsPerMinute: 20,
  tokensPerMinute: 20_000,
  requestSpacingMs: 3_000,
};

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function shouldRetry(status: unknown): boolean {
  return status === "failed" || status === "rate_limited" || status === "timeout" || status === "network_error" || status === undefined;
}

export function createQwenRetryPolicy(input: Record<string, unknown>): QwenRetryPolicyResult {
  const estimatedTokens = positiveInteger(input.estimatedTokens, 4_000);
  const attempt = positiveInteger(input.attempt, 1);
  const retryAfterMs = positiveInteger(input.retryAfterMs, QWEN_PUBLIC_LIMITS.requestSpacingMs);
  const minimumBatches = Math.max(1, Math.ceil(estimatedTokens / QWEN_PUBLIC_LIMITS.tokensPerMinute));
  const baseDelay = Math.max(retryAfterMs, QWEN_PUBLIC_LIMITS.requestSpacingMs);
  const retryDelaysMs = [baseDelay, Math.min(60_000, baseDelay * Math.max(2, attempt)), Math.min(90_000, baseDelay * Math.max(3, attempt + 1))];
  return {
    model: "qwen3.6-35b-a3b",
    limits: QWEN_PUBLIC_LIMITS,
    estimatedTokens,
    minimumBatches,
    attempt,
    shouldRetry: shouldRetry(input.status),
    neverStop: true,
    retryDelaysMs,
    recoveryProtocol: [
      "split prompts so each delegated call stays below 20000 tokens per minute",
      "space requests by at least 3000 ms because the public limit is 20 requests per minute",
      "on failure write task_checkpoint with partial result, nextSteps, and retry evidence before requeueing",
      "use public_retry instead of abandoning the job; if the prompt is too large, reduce it with context_digest or business_logic_map",
    ],
  };
}
