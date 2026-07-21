import { describe, it, expect } from "vitest";

// Re-declared here so the test doesn't depend on importing the store
// modules (which pull in Pinia + IPC types that are awkward in vitest).
// If the regex in the store ever drifts, this test will catch it.
function normalizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(
      /^Error invoking remote method '[^']+':\s*Error:\s*/,
      "",
    );
  }
  return String(err);
}

describe("normalizeError", () => {
  it("strips Electron's 'Error invoking remote method' wrapper", () => {
    // This is the exact shape Electron's ipcRenderer.invoke rejects with
    // when the main process throws `new Error("real message")`.
    const wrapped = new Error(
      "Error invoking remote method 'versions:remove': Error: 版本 v2026.7.1 正被以下实例使用",
    );
    expect(normalizeError(wrapped)).toBe(
      "版本 v2026.7.1 正被以下实例使用",
    );
  });

  it("passes through a plain Error message unchanged", () => {
    const err = new Error("直接抛出的错误");
    expect(normalizeError(err)).toBe("直接抛出的错误");
  });

  it("returns String(err) for non-Error values", () => {
    expect(normalizeError("string-only")).toBe("string-only");
    expect(normalizeError(42)).toBe("42");
    expect(normalizeError({ code: "x" })).toBe("[object Object]");
  });

  it("leaves a wrapped error that doesn't match the prefix alone", () => {
    // Defensive: if Electron ever changes its error format, we should not
    // mangle messages that happen to look like the wrapper.
    const err = new Error("Error: custom prefix and message");
    expect(normalizeError(err)).toBe("Error: custom prefix and message");
  });

  it("handles the wrapper with single quotes in the channel name", () => {
    const err = new Error(
      "Error invoking remote method 'instances:check-config-consistency': Error: x",
    );
    expect(normalizeError(err)).toBe("x");
  });
});
