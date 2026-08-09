const IDEMPOTENT_METHODS = new Set(["get", "head", "options"]);
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

export function shouldRetryApiRequest(input: {
  method?: string;
  status?: number | null;
  code?: string | null;
}) {
  const method = String(input.method || "get").trim().toLowerCase();
  if (!IDEMPOTENT_METHODS.has(method)) {
    return false;
  }
  if (input.status && RETRYABLE_STATUS.has(input.status)) {
    return true;
  }
  return RETRYABLE_CODES.has(String(input.code || "").toUpperCase());
}

export function retryDelayMs(attempt: number, retryAfterHeader?: unknown) {
  const retryAfterSeconds = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(5_000, retryAfterSeconds * 1_000);
  }
  return Math.min(2_000, 200 * 2 ** Math.max(0, attempt));
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
