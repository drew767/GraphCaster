// Copyright Aura. All Rights Reserved.

import { describe, it, expect } from "vitest";
import { getNodeIcon, getNodeCategoryFromType, NODE_ICONS } from "./nodeIcons";

describe("nodeIcons", () => {
  it("returns icon for 'start' node type", () => {
    expect(getNodeIcon("start")).toBe(NODE_ICONS.start);
  });

  it("returns icon for 'task' node type", () => {
    expect(getNodeIcon("task")).toBe(NODE_ICONS.task);
  });

  it("returns icon for 'ai_route' node type", () => {
    expect(getNodeIcon("ai_route")).toBe(NODE_ICONS.ai_route);
  });

  it("returns icon for 'graph_ref' node type", () => {
    expect(getNodeIcon("graph_ref")).toBe(NODE_ICONS.graph_ref);
  });

  it("returns icon for 'comment' node type", () => {
    expect(getNodeIcon("comment")).toBe(NODE_ICONS.comment);
  });

  it("returns default icon for unknown node type", () => {
    expect(getNodeIcon("unknown")).toBe(NODE_ICONS.default);
  });
});

describe("getNodeCategoryFromType", () => {
  it("returns 'flow' for start node", () => {
    expect(getNodeCategoryFromType("start")).toBe("flow");
  });

  it("returns 'flow' for exit node", () => {
    expect(getNodeCategoryFromType("exit")).toBe("flow");
  });

  it("returns 'flow' for fork node", () => {
    expect(getNodeCategoryFromType("fork")).toBe("flow");
  });

  it("returns 'flow' for merge node", () => {
    expect(getNodeCategoryFromType("merge")).toBe("flow");
  });

  it("returns 'run_ai' for task node", () => {
    expect(getNodeCategoryFromType("task")).toBe("run_ai");
  });

  it("returns 'run_ai' for mcp_tool node", () => {
    expect(getNodeCategoryFromType("mcp_tool")).toBe("run_ai");
  });

  it("returns 'run_ai' for ai_route node", () => {
    expect(getNodeCategoryFromType("ai_route")).toBe("run_ai");
  });

  it("returns 'run_ai' for llm_agent node", () => {
    expect(getNodeCategoryFromType("llm_agent")).toBe("run_ai");
  });

  it("returns 'nested' for graph_ref node", () => {
    expect(getNodeCategoryFromType("graph_ref")).toBe("nested");
  });

  it("returns 'notes' for comment node", () => {
    expect(getNodeCategoryFromType("comment")).toBe("notes");
  });

  it("returns 'notes' for group node", () => {
    expect(getNodeCategoryFromType("group")).toBe("notes");
  });

  it("returns 'default' for unknown node", () => {
    expect(getNodeCategoryFromType("unknown")).toBe("default");
  });
});
