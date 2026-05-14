// Copyright GraphCaster. All Rights Reserved.

import type { Workflow } from "./types";

export function exportWorkflowJson(workflow: Workflow): void {
  const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${workflow.name || workflow.id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
