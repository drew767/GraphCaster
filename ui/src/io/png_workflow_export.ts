// Copyright GraphCaster. All Rights Reserved.

import type { GraphDocumentJson } from "../graph/types";
import { injectTextChunk } from "./png_chunks";

const PNG_WORKFLOW_CHUNK_KEY = "workflow";

/**
 * Render the canvas element to a PNG data URL using html-to-image,
 * inject the workflow JSON as a tEXt chunk, and return a Blob.
 *
 * The returned PNG is compatible with ComfyUI's convention:
 * the workflow is stored in a `tEXt` chunk with key "workflow".
 */
export async function exportPngWithWorkflow(
  canvasElement: HTMLElement,
  workflow: GraphDocumentJson,
): Promise<Blob> {
  // Lazy-import html-to-image to keep initial bundle size small
  const { toPng } = await import("html-to-image");

  const dataUrl = await toPng(canvasElement, {
    backgroundColor: "#1a1a2e",
    cacheBust: true,
  });

  const pngBytes = dataUrlToBytes(dataUrl);
  const workflowJson = JSON.stringify(workflow);
  const pngWithWorkflow = injectTextChunk(pngBytes, PNG_WORKFLOW_CHUNK_KEY, workflowJson);

  return new Blob([pngWithWorkflow], { type: "image/png" });
}

/**
 * Trigger a browser download of a Blob with the given file name.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const base64 = dataUrl.slice(comma + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
