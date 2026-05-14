// Copyright GraphCaster. All Rights Reserved.

/**
 * Generates a canvas thumbnail PNG Blob using html-to-image.
 *
 * Reuses the same lazy import pattern as F75 (png_workflow_export.ts).
 */
export async function generateCanvasThumbnail(
  canvasElement: HTMLElement,
  options?: { width?: number; height?: number },
): Promise<Blob> {
  const width = options?.width ?? 256;
  const height = options?.height ?? 160;

  const { toPng } = await import("html-to-image");

  const dataUrl = await toPng(canvasElement, {
    backgroundColor: "#1a1a2e",
    cacheBust: true,
    width,
    height,
  });

  return dataUrlToBlob(dataUrl);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const base64 = dataUrl.slice(comma + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: "image/png" });
}
