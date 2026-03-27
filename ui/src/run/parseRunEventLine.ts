// Copyright GraphCaster. All Rights Reserved.

export function parseRunEventLine(line: string): unknown | null {
  const s = line.trim();
  if (s.length === 0) {
    return null;
  }
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}
