import { describe, it } from "node:test";
import assert from "node:assert";
import React from "react";
import { renderToString } from "ink";
import { ApiErrorMessage } from "./api-error-message.js";
import { ThemeProvider } from "./theme-context.js";
import { resolveTheme } from "./theme.js";

const testTheme = resolveTheme();

function renderStatic(props: { message: string; httpStatus?: number; code?: number; onRetry?: () => void }): string {
  return renderToString(
    <ThemeProvider theme={testTheme}>
      <ApiErrorMessage {...props} />
    </ThemeProvider>,
  );
}

describe("ApiErrorMessage", () => {
  it("renders the error message", () => {
    const out = renderStatic({ message: "Rate limit exceeded" });
    assert.ok(out.includes("Rate limit exceeded"));
  });

  it("renders HTTP status and code", () => {
    const out = renderStatic({ message: "Rate limit exceeded", httpStatus: 429, code: 3040 });
    assert.ok(out.includes("HTTP 429"));
    assert.ok(out.includes("code: 3040"));
  });

  it("shows the report hint", () => {
    const out = renderStatic({ message: "Something went wrong" });
    assert.ok(out.includes("Type /report to send diagnostic info"));
  });

  it("shows retry UI for HTTP 429", () => {
    const out = renderStatic({ message: "Rate limit exceeded", httpStatus: 429, onRetry: () => {} });
    assert.ok(out.includes("Try again"));
    assert.ok(out.includes("Dismiss"));
  });

  it("shows retry UI for code 3040", () => {
    const out = renderStatic({ message: "Gateway error", code: 3040, onRetry: () => {} });
    assert.ok(out.includes("Try again"));
    assert.ok(out.includes("Dismiss"));
  });

  it("shows retry UI for HTTP 500", () => {
    const out = renderStatic({ message: "Server error", httpStatus: 500, onRetry: () => {} });
    assert.ok(out.includes("Try again"));
    assert.ok(out.includes("Dismiss"));
  });

  it("does not show retry UI for non-retryable errors", () => {
    const out = renderStatic({ message: "Bad request", httpStatus: 400, onRetry: () => {} });
    assert.ok(!out.includes("Try again"));
    assert.ok(!out.includes("Dismiss"));
  });

  it("does not show retry UI when onRetry is not provided", () => {
    const out = renderStatic({ message: "Rate limit exceeded", httpStatus: 429 });
    assert.ok(!out.includes("Try again"));
    assert.ok(!out.includes("Dismiss"));
  });

  it("renders retry UI only when both retryable and onRetry provided", () => {
    // Non-retryable + onRetry → no retry UI
    const nonRetryable = renderStatic({ message: "Bad request", httpStatus: 400, onRetry: () => {} });
    assert.ok(!nonRetryable.includes("Try again"));

    // Retryable + no onRetry → no retry UI
    const noHandler = renderStatic({ message: "Rate limit exceeded", httpStatus: 429 });
    assert.ok(!noHandler.includes("Try again"));

    // Retryable + onRetry → retry UI shown
    const withHandler = renderStatic({ message: "Rate limit exceeded", httpStatus: 429, onRetry: () => {} });
    assert.ok(withHandler.includes("Try again"));
    assert.ok(withHandler.includes("Dismiss"));
  });
});
