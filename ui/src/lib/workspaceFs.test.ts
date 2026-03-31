// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { workspaceDiskFingerprintConflicts } from "./workspaceFs";

describe("workspaceDiskFingerprintConflicts", () => {
  it("returns false when both timestamps and sizes match", () => {
    const fp = { lastModifiedMs: 1700000000000, sizeBytes: 42 };
    expect(workspaceDiskFingerprintConflicts(fp, { ...fp })).toBe(false);
  });

  it("returns true when lastModified differs", () => {
    const a = { lastModifiedMs: 100, sizeBytes: 10 };
    const b = { lastModifiedMs: 200, sizeBytes: 10 };
    expect(workspaceDiskFingerprintConflicts(a, b)).toBe(true);
  });

  it("returns true when size differs", () => {
    const a = { lastModifiedMs: 100, sizeBytes: 10 };
    const b = { lastModifiedMs: 100, sizeBytes: 99 };
    expect(workspaceDiskFingerprintConflicts(a, b)).toBe(true);
  });
});
