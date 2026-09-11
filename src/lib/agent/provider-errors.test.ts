import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { APICallError } from "ai";
import {
  classifyProviderError,
  isHardFailCode,
  isRetryableDiagnosisCode,
} from "./provider-errors";

describe("provider-errors", () => {
  it("classifies auth as hard fail", () => {
    const err = new APICallError({
      message: "invalid api key",
      url: "https://example",
      requestBodyValues: {},
      statusCode: 401,
      responseHeaders: {},
      responseBody: "unauthorized",
      isRetryable: false,
    });
    const c = classifyProviderError(err);
    assert.equal(c.code, "auth");
    assert.equal(isHardFailCode(c.code), true);
  });

  it("classifies 429 as retryable rpm", () => {
    const err = new APICallError({
      message: "rate limit Please retry in 2.5s",
      url: "https://example",
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: {},
      responseBody: "resource_exhausted",
      isRetryable: true,
    });
    const c = classifyProviderError(err);
    assert.equal(c.code, "rpm");
    assert.equal(isRetryableDiagnosisCode(c.code), true);
    assert.ok((c.retryAfterMs ?? 0) >= 2500);
  });

  it("classifies timeout", () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    const c = classifyProviderError(err);
    assert.equal(c.code, "timeout");
    assert.equal(c.retryable, true);
  });
});
