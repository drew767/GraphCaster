// Copyright GraphCaster. All Rights Reserved.

const OBJECT_URL_REVOKE_MS = 15_000;

export function downloadJsonFile(filename: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, OBJECT_URL_REVOKE_MS);
}

export function safeGraphDownloadBasename(graphId: string): string {
  const trimmed = graphId.trim() || "graph";
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 96);
  return (safe || "graph") + ".json";
}
