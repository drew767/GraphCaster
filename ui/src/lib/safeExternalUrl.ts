// Copyright GraphCaster. All Rights Reserved.

export function safeExternalHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const t = raw.trim();
  if (t === "") {
    return null;
  }
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }
    return u.href;
  } catch {
    return null;
  }
}
