// Copyright GraphCaster. All Rights Reserved.

import type { GraphDocumentJson } from "../../graph/types";

export type ExportDocumentOptions = {
  /** When false, do not call onExportRemovedDanglingEdges (history / internal snapshots). Default true. */
  notifyRemovedDanglingEdges?: boolean;
};

export type GraphCanvasHandle = {
  exportDocument: (options?: ExportDocumentOptions) => GraphDocumentJson;
  focusNode: (nodeId: string) => void;
  removeNodesById: (ids: readonly string[]) => void;
};
