// Copyright GraphCaster. All Rights Reserved.

import { downloadJsonFile } from "./downloadJson";

export async function saveJsonWithFilePickerOrDownload(
  suggestedName: string,
  data: unknown,
): Promise<void> {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });

  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: suggestedName.toLowerCase().endsWith(".json")
          ? suggestedName
          : `${suggestedName}.json`,
        types: [
          {
            description: "Graph JSON",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw e;
      }
    }
  }

  const base = suggestedName.toLowerCase().endsWith(".json")
    ? suggestedName
    : `${suggestedName}.json`;
  downloadJsonFile(base, data);
}
