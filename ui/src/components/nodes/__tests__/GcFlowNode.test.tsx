// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import type { NodeProps } from "@xyflow/react";
import type { GcNodeData } from "../../../graph/toReactFlow";

/* ── shared mocks ── */
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    Handle: ({ type, id: hid }: { type: string; id?: string }) => (
      <div data-testid={`handle-${type}-${hid ?? "default"}`} />
    ),
    Position: { Left: "left", Right: "right" },
  };
});

vi.mock("../../../graph/useGcEffectiveNodeTier", () => ({
  useGcEffectiveNodeTier: () => "full",
}));

vi.mock("../../GcConnectionDragContext", () => ({
  useGcConnectionDrag: () => null,
  GcConnectionDragContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
}));

vi.mock("../../nodes/GcFlowTargetHandle", () => ({
  GcFlowTargetHandle: () => <div data-testid="target-handle" />,
}));

vi.mock("../../ui/Icon/Icon", () => ({
  Icon: ({ name }: { name: string }) => <svg data-icon={name} />,
}));

vi.mock("../../ui/Tooltip/Tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactElement }) => children,
}));

vi.mock("../../../graph/nodes/NodeHoverToolbar", () => ({
  NodeHoverToolbar: () => <div data-testid="node-hover-toolbar-mock" />,
}));

vi.mock("../../ndv/useNdvStore", () => ({
  useNdvStore: (selector: (s: { openNdv: () => void }) => unknown) =>
    selector({ openNdv: () => {} }),
}));

/* ── helper ── */
function makeProps(data: Partial<GcNodeData>, selected = false): NodeProps {
  return {
    id: "test-node",
    data: {
      graphNodeType: "task",
      label: "Test",
      raw: {},
      ...data,
    } as GcNodeData,
    selected,
    dragging: false,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    zIndex: 1,
    type: "gcNode",
    width: 180,
    height: 80,
    sourcePosition: undefined,
    targetPosition: undefined,
  } as unknown as NodeProps;
}

async function importGcFlowNode() {
  const mod = await import("../GcFlowNode");
  return mod.GcFlowNode;
}

/* ─────────────────────────────────────────────────────────
   UX64 — border state classes
   ───────────────────────────────────────────────────────── */
describe("GcFlowNode UX64 — state CSS classes", () => {
  it("running state applies gc-flow-node--running class", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ runOverlayPhase: "running" })} />,
    );
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--running")).toBe(true);
  });

  it("success state applies gc-flow-node--run-success class", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ runOverlayPhase: "success" })} />,
    );
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--run-success")).toBe(true);
  });

  it("failed state applies gc-flow-node--run-error class", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ runOverlayPhase: "failed" })} />,
    );
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--run-error")).toBe(true);
  });

  it("selected applies gc-flow-node--selected class", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({}, true)} />);
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--selected")).toBe(true);
  });

  it("gcPinned applies gc-flow-node--pinned class", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({ gcPinned: true })} />);
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--pinned")).toBe(true);
  });

  it("idle node has no run-state classes", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({})} />);
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--running")).toBe(false);
    expect(node?.classList.contains("gc-flow-node--run-success")).toBe(false);
    expect(node?.classList.contains("gc-flow-node--run-error")).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────
   UX65 — running animation class
   ───────────────────────────────────────────────────────── */
describe("GcFlowNode UX65 — conic-gradient running animation", () => {
  it("running phase adds gc-flow-node--running (::before pseudo applied via class)", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ runOverlayPhase: "running" })} />,
    );
    expect(container.querySelector(".gc-flow-node--running")).not.toBeNull();
  });

  it("waiting/skipped phase adds gc-flow-node--waiting", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ runOverlayPhase: "skipped" })} />,
    );
    expect(container.querySelector(".gc-flow-node--waiting")).not.toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────
   UX66 — status badge priority
   ───────────────────────────────────────────────────────── */
describe("GcFlowNode UX66 — status badges priority", () => {
  it("error badge shown on failed run", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ runOverlayPhase: "failed" })} />,
    );
    const badge = container.querySelector(".gc-flow-node__status-badge--error");
    expect(badge).not.toBeNull();
  });

  it("error takes priority over pinned", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ gcPinned: true, runOverlayPhase: "failed" })} />,
    );
    expect(container.querySelector(".gc-flow-node__status-badge--error")).not.toBeNull();
    expect(container.querySelector(".gc-flow-node__status-badge--pinned")).toBeNull();
  });

  it("pinned badge shown when pinned and success (pinned has higher priority than success)", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ gcPinned: true, runOverlayPhase: "success" })} />,
    );
    expect(container.querySelector(".gc-flow-node__status-badge--pinned")).not.toBeNull();
    expect(container.querySelector(".gc-flow-node__status-badge--success")).toBeNull();
  });

  it("success badge shown on successful run", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ runOverlayPhase: "success" })} />,
    );
    const badge = container.querySelector(".gc-flow-node__status-badge--success");
    expect(badge).not.toBeNull();
  });

  it("no status badges when idle with no special state", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({})} />);
    expect(container.querySelector(".gc-flow-node__status-icons")).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────
   UX66 — iteration count badge
   ───────────────────────────────────────────────────────── */
describe("GcFlowNode UX66 — iteration count badge", () => {
  it("renders iteration count when iterationCount > 1 on success", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode
        {...makeProps({ runOverlayPhase: "success", raw: { iterationCount: 5 } })}
      />,
    );
    const iterBadge = container.querySelector(".gc-flow-node__iter-count");
    expect(iterBadge).not.toBeNull();
    expect(iterBadge?.textContent).toBe("5");
  });

  it("no iteration badge when count is 1", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode
        {...makeProps({ runOverlayPhase: "success", raw: { iterationCount: 1 } })}
      />,
    );
    expect(container.querySelector(".gc-flow-node__iter-count")).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────
   UX67 — settings icons
   ───────────────────────────────────────────────────────── */
describe("GcFlowNode UX67 — settings icons", () => {
  it("settings icons container rendered when alwaysOutputData set", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ raw: { alwaysOutputData: true } })} />,
    );
    const settingsArea = container.querySelector(".gc-flow-node__settings-icons");
    expect(settingsArea).not.toBeNull();
  });

  it("always-output-data icon present when alwaysOutputData=true", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ raw: { alwaysOutputData: true } })} />,
    );
    expect(container.querySelector("[data-icon='always-output-data']")).not.toBeNull();
  });

  it("execute-once icon present when executeOnce=true", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ raw: { executeOnce: true } })} />,
    );
    expect(container.querySelector("[data-icon='execute-once']")).not.toBeNull();
  });

  it("retry-on-fail icon present when retryOnFail=true", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ raw: { retryOnFail: true } })} />,
    );
    expect(container.querySelector("[data-icon='retry-on-fail']")).not.toBeNull();
  });

  it("no settings icons when no settings flags", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({ raw: {} })} />);
    expect(container.querySelector(".gc-flow-node__settings-icons")).toBeNull();
  });

  it("multiple settings icons rendered together", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode
        {...makeProps({ raw: { retryOnFail: true, continueOnError: true } })}
      />,
    );
    expect(container.querySelector("[data-icon='retry-on-fail']")).not.toBeNull();
    expect(container.querySelector("[data-icon='continue-on-error']")).not.toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────
   UX64 — Trigger node border-radius class
   ───────────────────────────────────────────────────────── */
describe("GcFlowNode UX64 — trigger node special border", () => {
  it("trigger_webhook gets gc-flow-node--trigger_webhook class", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode
        {...makeProps({ graphNodeType: "trigger_webhook", label: "Webhook" })}
      />,
    );
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--trigger_webhook")).toBe(true);
  });

  it("trigger_schedule gets gc-flow-node--trigger_schedule class", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode
        {...makeProps({ graphNodeType: "trigger_schedule", label: "Schedule" })}
      />,
    );
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--trigger_schedule")).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────
   F73 preservation — muted / bypassed / pinned
   ───────────────────────────────────────────────────────── */
describe("GcFlowNode F73 — muted/bypassed/pinned preservation", () => {
  it("muted node has gc-flow-node--muted class", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({ gcMuted: true })} />);
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--muted")).toBe(true);
  });

  it("muted node also has gc-node--muted class", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({ gcMuted: true })} />);
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-node--muted")).toBe(true);
  });

  it("non-muted node does not have gc-node--muted class", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({})} />);
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-node--muted")).toBe(false);
  });

  it("bypassed node has gc-flow-node--bypassed class and bypass badge", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({ gcBypassed: true })} />);
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--bypassed")).toBe(true);
    expect(container.querySelector(".gc-flow-node__bypass-badge")).not.toBeNull();
  });

  it("pinned node has gc-flow-node--pinned class and lock icon", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({ gcPinned: true })} />);
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--pinned")).toBe(true);
    expect(container.querySelector(".gc-flow-node__state-lock")).not.toBeNull();
  });

  it("normal node has no state classes", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({})} />);
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--muted")).toBe(false);
    expect(node?.classList.contains("gc-flow-node--bypassed")).toBe(false);
    expect(node?.classList.contains("gc-flow-node--pinned")).toBe(false);
    expect(container.querySelector(".gc-flow-node__bypass-badge")).toBeNull();
    expect(container.querySelector(".gc-flow-node__state-lock")).toBeNull();
  });

  it("muted takes precedence over bypassed in class selection", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ gcMuted: true, gcBypassed: true })} />,
    );
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--muted")).toBe(true);
    expect(node?.classList.contains("gc-flow-node--bypassed")).toBe(false);
  });

  it("bypass badge shows aria/title key", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({ gcBypassed: true })} />);
    const badge = container.querySelector(".gc-flow-node__bypass-badge");
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute("title")).toBe("app.canvas.bypassedBadge");
  });

  it("lock badge shows aria/title key", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({ gcPinned: true })} />);
    const lock = container.querySelector(".gc-flow-node__state-lock");
    expect(lock).not.toBeNull();
    expect(lock?.getAttribute("title")).toBe("app.canvas.pinnedBadge");
  });
});

/* ─────────────────────────────────────────────────────────
   UX86 — Pin-data inline preview
   ───────────────────────────────────────────────────────── */
describe("GcFlowNode UX86 — pin-data inline preview", () => {
  it("shows pin label when gcPin.enabled is true on a task node", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode
        {...makeProps({
          graphNodeType: "task",
          raw: { gcPin: { enabled: true } },
        })}
      />,
    );
    expect(container.querySelector(".gc-flow-node__pin-label")).not.toBeNull();
  });

  it("does not show pin label when gcPin.enabled is false", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode
        {...makeProps({
          graphNodeType: "task",
          raw: { gcPin: { enabled: false } },
        })}
      />,
    );
    expect(container.querySelector(".gc-flow-node__pin-label")).toBeNull();
  });

  it("does not show pin label on non-task node types even if gcPin present", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode
        {...makeProps({
          graphNodeType: "http_request",
          raw: { gcPin: { enabled: true } },
        })}
      />,
    );
    expect(container.querySelector(".gc-flow-node__pin-label")).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────
   UX87 — Disabled node strike-through (single-io muted)
   ───────────────────────────────────────────────────────── */
describe("GcFlowNode UX87 — disabled strike-through", () => {
  it("muted merge node (single-io, no error out) gets gc-flow-node--muted-single-io class", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ graphNodeType: "merge", gcMuted: true })} />,
    );
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--muted-single-io")).toBe(true);
  });

  it("muted task node (has error output) does NOT get muted-single-io class", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ graphNodeType: "task", gcMuted: true })} />,
    );
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--muted-single-io")).toBe(false);
  });
});
