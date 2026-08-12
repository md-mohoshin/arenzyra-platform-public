import assert from "node:assert/strict";
import test from "node:test";
import {
  retryDelayMs,
  screenshotApiRequestTimeoutMs,
  shouldRetryApiRequest,
} from "./api-request-policy";

test("screenshot API requests allow OCR to finish without lowering larger timeouts", () => {
  assert.equal(screenshotApiRequestTimeoutMs(10_000), 120_000);
  assert.equal(screenshotApiRequestTimeoutMs(180_000), 180_000);
});

test("only transient idempotent API requests are retried", () => {
  assert.equal(shouldRetryApiRequest({ method: "get", status: 503 }), true);
  assert.equal(shouldRetryApiRequest({ method: "GET", code: "ETIMEDOUT" }), true);
  assert.equal(shouldRetryApiRequest({ method: "post", status: 503 }), false);
  assert.equal(shouldRetryApiRequest({ method: "patch", code: "ECONNRESET" }), false);
  assert.equal(shouldRetryApiRequest({ method: "get", status: 400 }), false);
});

test("retry delays are bounded and honor numeric Retry-After", () => {
  assert.equal(retryDelayMs(0), 200);
  assert.equal(retryDelayMs(10), 2_000);
  assert.equal(retryDelayMs(0, "3"), 3_000);
  assert.equal(retryDelayMs(0, "30"), 5_000);
});
