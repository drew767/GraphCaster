// Copyright GraphCaster. All Rights Reserved.

import React, { useEffect, useState } from "react";

import "./KeyboardShortcut.css";

export interface KeyboardShortcutProps {
  keys: string | string[];
  separator?: React.ReactNode;
  size?: "xsmall" | "small" | "medium";
  variant?: "default" | "outlined";
}

const MAC_MAP: Record<string, string> = {
  ctrl: "⌃",
  control: "⌃",
  cmd: "⌘",
  command: "⌘",
  meta: "⌘",
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
  enter: "↵",
  return: "↵",
  backspace: "⌫",
  delete: "⌫",
  tab: "⇥",
  esc: "⎋",
  escape: "⎋",
};

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    navigator.platform.includes("Mac") ||
    navigator.userAgent.includes("Mac")
  );
}

function resolveKey(key: string, mac: boolean): string {
  if (mac) {
    const mapped = MAC_MAP[key.toLowerCase()];
    if (mapped) return mapped;
  }
  return key;
}

function parseKeys(keys: string | string[]): string[] {
  if (Array.isArray(keys)) return keys;
  return keys.split("+").map((k) => k.trim());
}

export function KeyboardShortcut({
  keys,
  separator = "+",
  size = "small",
  variant = "default",
}: KeyboardShortcutProps) {
  const [mac, setMac] = useState(false);

  useEffect(() => {
    setMac(isMac());
  }, []);

  const parts = parseKeys(keys).map((k) => resolveKey(k, mac));

  return (
    <span
      className={[
        "gc-kbd",
        `gc-kbd--${size}`,
        `gc-kbd--${variant}`,
      ].join(" ")}
      aria-label={Array.isArray(keys) ? keys.join("+") : keys}
    >
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <span className="gc-kbd__sep" aria-hidden="true">
              {separator}
            </span>
          )}
          <kbd className="gc-kbd__key">{part}</kbd>
        </React.Fragment>
      ))}
    </span>
  );
}
