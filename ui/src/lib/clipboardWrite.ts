// Copyright GraphCaster. All Rights Reserved.

export async function writeTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      await new Promise<void>((resolve, reject) => {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        try {
          const ok = document.execCommand("copy");
          document.body.removeChild(ta);
          if (ok) {
            resolve();
          } else {
            reject(new Error("execCommand"));
          }
        } catch (e) {
          document.body.removeChild(ta);
          reject(e);
        }
      });
      return true;
    } catch {
      return false;
    }
  }
}
