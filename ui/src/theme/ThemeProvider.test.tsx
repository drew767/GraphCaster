// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";

import { ThemeProvider, useTheme } from "./ThemeProvider";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

interface MockMql {
  matches: boolean;
  listeners: Array<(ev: MediaQueryListEvent) => void>;
  addEventListener: (event: string, cb: (ev: MediaQueryListEvent) => void) => void;
  removeEventListener: (event: string, cb: (ev: MediaQueryListEvent) => void) => void;
  dispatch: (matches: boolean) => void;
}

function installMatchMedia(initial: boolean): MockMql {
  const mql: MockMql = {
    matches: initial,
    listeners: [],
    addEventListener(event, cb) {
      if (event === "change") {
        this.listeners.push(cb);
      }
    },
    removeEventListener(event, cb) {
      if (event === "change") {
        this.listeners = this.listeners.filter((l) => l !== cb);
      }
    },
    dispatch(matches: boolean) {
      this.matches = matches;
      const ev = { matches } as MediaQueryListEvent;
      for (const l of [...this.listeners]) {
        l(ev);
      }
    },
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => mql as unknown as MediaQueryList,
  });
  return mql;
}

function Probe({ onState }: { onState: (state: ReturnType<typeof useTheme>) => void }) {
  const state = useTheme();
  onState(state);
  return null;
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("theme-light", "theme-dark");
  });

  afterEach(() => {
    document.documentElement.classList.remove("theme-light", "theme-dark");
  });

  it("defaults to system theme and resolves via matchMedia", () => {
    installMatchMedia(true);
    let captured!: ReturnType<typeof useTheme>;
    render(
      <ThemeProvider>
        <Probe onState={(s) => (captured = s)} />
      </ThemeProvider>,
    );
    expect(captured.theme).toBe("system");
    expect(captured.resolvedTheme).toBe("dark");
    expect(document.documentElement.classList.contains("theme-dark")).toBe(true);
    expect(document.documentElement.classList.contains("theme-light")).toBe(false);
  });

  it("setTheme updates documentElement class and persists", () => {
    installMatchMedia(false);
    let captured!: ReturnType<typeof useTheme>;
    render(
      <ThemeProvider>
        <Probe onState={(s) => (captured = s)} />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("theme-light")).toBe(true);

    act(() => {
      captured.setTheme("dark");
    });

    expect(captured.theme).toBe("dark");
    expect(captured.resolvedTheme).toBe("dark");
    expect(document.documentElement.classList.contains("theme-dark")).toBe(true);
    expect(document.documentElement.classList.contains("theme-light")).toBe(false);
    expect(window.localStorage.getItem("gc.theme")).toBe("dark");
  });

  it("reacts to matchMedia change events when in system mode", () => {
    const mql = installMatchMedia(false);
    let captured!: ReturnType<typeof useTheme>;
    render(
      <ThemeProvider>
        <Probe onState={(s) => (captured = s)} />
      </ThemeProvider>,
    );
    expect(captured.resolvedTheme).toBe("light");

    act(() => {
      mql.dispatch(true);
    });

    expect(captured.resolvedTheme).toBe("dark");
    expect(document.documentElement.classList.contains("theme-dark")).toBe(true);
  });

  it("reads initial theme from localStorage", () => {
    window.localStorage.setItem("gc.theme", "dark");
    installMatchMedia(false);
    let captured!: ReturnType<typeof useTheme>;
    render(
      <ThemeProvider>
        <Probe onState={(s) => (captured = s)} />
      </ThemeProvider>,
    );
    expect(captured.theme).toBe("dark");
    expect(captured.resolvedTheme).toBe("dark");
  });
});
