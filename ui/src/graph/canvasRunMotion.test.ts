// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  effectiveFollowRunCameraPanAnimated,
  effectiveRunEdgeAnimated,
  effectiveRunNodePulse,
  normalizeRunMotionPreference,
  runMotionAllowsEdgeAnimation,
  runMotionAllowsNodePulse,
} from "./canvasRunMotion";

describe("canvasRunMotion", () => {
  it("normalizeRunMotionPreference maps unknown to full", () => {
    expect(normalizeRunMotionPreference(null)).toBe("full");
    expect(normalizeRunMotionPreference("")).toBe("full");
    expect(normalizeRunMotionPreference("garbage")).toBe("full");
    expect(normalizeRunMotionPreference("full")).toBe("full");
  });

  it("normalizeRunMotionPreference keeps minimal and off", () => {
    expect(normalizeRunMotionPreference("minimal")).toBe("minimal");
    expect(normalizeRunMotionPreference("off")).toBe("off");
  });

  it("runMotionAllowsEdgeAnimation is true for full and minimal only", () => {
    expect(runMotionAllowsEdgeAnimation("full")).toBe(true);
    expect(runMotionAllowsEdgeAnimation("minimal")).toBe(true);
    expect(runMotionAllowsEdgeAnimation("off")).toBe(false);
  });

  it("runMotionAllowsNodePulse is true for full only", () => {
    expect(runMotionAllowsNodePulse("full")).toBe(true);
    expect(runMotionAllowsNodePulse("minimal")).toBe(false);
    expect(runMotionAllowsNodePulse("off")).toBe(false);
  });

  it("effectiveRunEdgeAnimated turns off when prefers reduced motion", () => {
    expect(effectiveRunEdgeAnimated("full", false)).toBe(true);
    expect(effectiveRunEdgeAnimated("minimal", false)).toBe(true);
    expect(effectiveRunEdgeAnimated("full", true)).toBe(false);
    expect(effectiveRunEdgeAnimated("minimal", true)).toBe(false);
    expect(effectiveRunEdgeAnimated("off", false)).toBe(false);
  });

  it("effectiveRunNodePulse turns off when prefers reduced motion", () => {
    expect(effectiveRunNodePulse("full", false)).toBe(true);
    expect(effectiveRunNodePulse("full", true)).toBe(false);
    expect(effectiveRunNodePulse("minimal", false)).toBe(false);
  });

  it("effectiveFollowRunCameraPanAnimated matches node pulse (full only)", () => {
    expect(effectiveFollowRunCameraPanAnimated("full", false)).toBe(true);
    expect(effectiveFollowRunCameraPanAnimated("full", true)).toBe(false);
    expect(effectiveFollowRunCameraPanAnimated("minimal", false)).toBe(false);
    expect(effectiveFollowRunCameraPanAnimated("minimal", true)).toBe(false);
    expect(effectiveFollowRunCameraPanAnimated("off", false)).toBe(false);
  });
});
