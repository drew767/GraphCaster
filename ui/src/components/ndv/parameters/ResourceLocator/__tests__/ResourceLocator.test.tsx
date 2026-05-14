// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

import { ResourceLocator, type ResourceLocatorValue } from "../ResourceLocator";

/* ── i18n mock ───────────────────────────────────────────────────── */

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "app.ndv.resourceLocator.mode.id": "By ID",
        "app.ndv.resourceLocator.mode.url": "By URL",
        "app.ndv.resourceLocator.mode.list": "From list",
        "app.ndv.resourceLocator.placeholder.id": "Enter resource ID",
        "app.ndv.resourceLocator.placeholder.url": "Paste URL",
        "app.ndv.resourceLocator.placeholder.list": "Select…",
        "app.ndv.resourceLocator.listTrigger.empty": "Select…",
        "app.ndv.resourceLocator.modePickerAriaLabel": "Resource locator mode",
        "app.ndv.resourceLocator.idInput.ariaLabel": "Resource ID",
        "app.ndv.resourceLocator.urlInput.ariaLabel": "Resource URL",
        "app.ndv.resourceLocator.dropdown.ariaLabel": "Options",
        "app.ndv.resourceLocator.dropdown.searchPlaceholder": "Search…",
        "app.ndv.resourceLocator.dropdown.searchAriaLabel": "Search options",
        "app.ndv.resourceLocator.dropdown.noMatches": "No matches",
        "app.ndv.resourceLocator.dropdown.loadMore": "Load more",
        "app.ndv.resourceLocator.dropdown.retry": "Retry",
        "app.ndv.resourceLocator.dropdown.slowNotice":
          "This is taking a while…",
      };
      return map[key] ?? key;
    },
  }),
}));

/* ── @tanstack/react-virtual mock ────────────────────────────────── */

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 44,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 44,
        size: 44,
        key: String(i),
        measureElement: () => {},
      })),
    measureElement: (_el: unknown) => {},
  }),
}));

/* ── Radix Select mock ───────────────────────────────────────────── */

vi.mock("@radix-ui/react-select", () => {
  const Root = ({
    children,
    onValueChange,
    value,
    disabled,
  }: {
    children: React.ReactNode;
    onValueChange?: (v: string) => void;
    value?: string;
    disabled?: boolean;
  }) => (
    <div data-testid="rx-select-root" data-value={value} data-disabled={disabled}>
      {React.Children.map(children, (child) =>
        React.cloneElement(child as React.ReactElement, { onValueChange }),
      )}
    </div>
  );

  const Trigger = React.forwardRef<
    HTMLButtonElement,
    {
      children: React.ReactNode;
      onValueChange?: (v: string) => void;
      className?: string;
      id?: string;
      "aria-label"?: string;
      "data-testid"?: string;
      disabled?: boolean;
    }
  >(({ children, "data-testid": testId, className, "aria-label": ariaLabel }, ref) => (
    <button ref={ref} data-testid={testId} className={className} aria-label={ariaLabel}>
      {children}
    </button>
  ));
  Trigger.displayName = "Trigger";

  const Content = ({ children }: { children: React.ReactNode }) => (
    <div role="listbox">{children}</div>
  );
  const Item = ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
  }) => (
    <div
      role="option"
      aria-selected={false}
      aria-disabled={disabled}
      onClick={() => onValueChange?.(value)}
    >
      {children}
    </div>
  );
  const ItemText = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const Icon = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const Portal = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const Viewport = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const ScrollUpButton = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const ScrollDownButton = ({ children }: { children: React.ReactNode }) => <>{children}</>;

  return { Root, Trigger, Content, Item, ItemText, Icon, Portal, Viewport, ScrollUpButton, ScrollDownButton };
});

/* ── Helpers ─────────────────────────────────────────────────────── */

const noop = () => {};

function makeLoadOptions(
  opts = [
    { id: "1", name: "Alpha", description: "First" },
    { id: "2", name: "Beta" },
  ],
  cursor?: string,
) {
  return vi.fn().mockResolvedValue({ options: opts, nextCursor: cursor });
}

function defaultValue(
  overrides?: Partial<ResourceLocatorValue>,
): ResourceLocatorValue {
  return { mode: "id", value: "", ...overrides };
}

/* ── 1. Renders mode picker + default mode ───────────────────────── */

describe("ResourceLocator", () => {
  it("renders mode picker and shows default ID mode input", () => {
    render(
      <ResourceLocator
        value={defaultValue()}
        onChange={noop}
        loadOptions={makeLoadOptions()}
      />,
    );
    // mode picker trigger present
    expect(screen.getByTestId("rl-mode-select")).toBeInTheDocument();
    // ID input present (default mode = id)
    expect(screen.getByTestId("rl-id-input")).toBeInTheDocument();
  });

  /* ── 2. Switches modes ─────────────────────────────────────────── */

  it("shows URL input after switching to url mode", () => {
    const onChange = vi.fn();
    render(
      <ResourceLocator
        value={defaultValue({ mode: "url" })}
        onChange={onChange}
        loadOptions={makeLoadOptions()}
      />,
    );
    expect(screen.getByTestId("rl-url-input")).toBeInTheDocument();
    expect(screen.queryByTestId("rl-id-input")).toBeNull();
  });

  it("shows list trigger after switching to list mode", () => {
    render(
      <ResourceLocator
        value={defaultValue({ mode: "list" })}
        onChange={noop}
        loadOptions={makeLoadOptions()}
      />,
    );
    expect(screen.getByTestId("rl-list-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("rl-id-input")).toBeNull();
  });

  /* ── 3. ID mode: type → onChange emits ──────────────────────────── */

  it("emits onChange with new value on ID input change", () => {
    const onChange = vi.fn();
    render(
      <ResourceLocator
        value={defaultValue({ mode: "id", value: "" })}
        onChange={onChange}
        loadOptions={makeLoadOptions()}
      />,
    );
    const input = screen.getByTestId("rl-id-input");
    fireEvent.change(input, { target: { value: "abc123" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "id", value: "abc123" }),
    );
  });

  /* ── 4. URL mode: paste URL → parseUrl called → ID extracted ────── */

  it("calls parseUrl and extracts ID in URL mode", () => {
    const parseUrl = vi.fn().mockReturnValue("extracted-id");
    const onChange = vi.fn();
    render(
      <ResourceLocator
        value={defaultValue({ mode: "url", value: "" })}
        onChange={onChange}
        loadOptions={makeLoadOptions()}
        parseUrl={parseUrl}
      />,
    );
    const input = screen.getByTestId("rl-url-input");
    fireEvent.change(input, { target: { value: "https://example.com/res/42" } });
    expect(parseUrl).toHaveBeenCalledWith("https://example.com/res/42");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ value: "extracted-id" }),
    );
  });

  /* ── 5. List mode: click → dropdown opens, fetches options ──────── */

  it("opens dropdown and fetches options on list trigger click", async () => {
    const loadOptions = makeLoadOptions();
    render(
      <ResourceLocator
        value={defaultValue({ mode: "list" })}
        onChange={noop}
        loadOptions={loadOptions}
      />,
    );
    const trigger = screen.getByTestId("rl-list-trigger");
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(loadOptions).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
    });
  });

  /* ── 6. Search filters list ─────────────────────────────────────── */

  it("re-fetches on search query change", async () => {
    const loadOptions = vi.fn().mockResolvedValue({ options: [] });
    render(
      <ResourceLocator
        value={defaultValue({ mode: "list" })}
        onChange={noop}
        loadOptions={loadOptions}
      />,
    );
    fireEvent.click(screen.getByTestId("rl-list-trigger"));
    await waitFor(() => expect(loadOptions).toHaveBeenCalledTimes(1));

    const searchInput = await screen.findByPlaceholderText("Search…");
    fireEvent.change(searchInput, { target: { value: "alp" } });

    await waitFor(() => expect(loadOptions).toHaveBeenCalledTimes(2));
    expect(loadOptions).toHaveBeenLastCalledWith("alp", undefined);
  });

  /* ── 7. Pagination via Load more ───────────────────────────────── */

  it("shows Load more button when nextCursor present and clicking appends", async () => {
    const loadOptions = vi.fn()
      .mockResolvedValueOnce({
        options: [{ id: "1", name: "Alpha" }],
        nextCursor: "cursor1",
      })
      .mockResolvedValueOnce({
        options: [{ id: "2", name: "Beta" }],
        nextCursor: undefined,
      });

    render(
      <ResourceLocator
        value={defaultValue({ mode: "list" })}
        onChange={noop}
        loadOptions={loadOptions}
      />,
    );
    fireEvent.click(screen.getByTestId("rl-list-trigger"));

    await waitFor(() => expect(screen.getByText("Load more")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Load more"));

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
    });
    expect(loadOptions).toHaveBeenCalledWith("", "cursor1");
  });

  /* ── 8. Loading state spinner ───────────────────────────────────── */

  it("shows spinner while options are loading", async () => {
    let resolve!: (v: { options: never[]; nextCursor?: string }) => void;
    const loadOptions = vi.fn(
      () =>
        new Promise<{ options: never[]; nextCursor?: string }>((res) => {
          resolve = res;
        }),
    );

    render(
      <ResourceLocator
        value={defaultValue({ mode: "list" })}
        onChange={noop}
        loadOptions={loadOptions}
      />,
    );
    fireEvent.click(screen.getByTestId("rl-list-trigger"));

    expect(await screen.findByRole("status")).toBeInTheDocument();

    act(() => resolve({ options: [] }));
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });

  /* ── 9. Slow-fetch warning at 5s ───────────────────────────────── */

  it(
    "shows slow-fetch warning after 5 seconds",
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      let resolve!: (v: { options: never[] }) => void;
      const loadOptions = vi.fn(
        () =>
          new Promise<{ options: never[] }>((res) => {
            resolve = res;
          }),
      );

      render(
        <ResourceLocator
          value={defaultValue({ mode: "list" })}
          onChange={noop}
          loadOptions={loadOptions}
        />,
      );

      fireEvent.click(screen.getByTestId("rl-list-trigger"));

      // Advance past debounce (200ms) so doFetch is called
      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      // Advance past the slow-fetch threshold (5000ms)
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      await waitFor(() =>
        expect(screen.getByText("This is taking a while…")).toBeInTheDocument(),
      );

      act(() => resolve({ options: [] }));
      vi.useRealTimers();
    },
    15000,
  );

  /* ── 10. Error state + retry ────────────────────────────────────── */

  it(
    "shows error message and retry button on fetch failure",
    async () => {
      const loadOptions = vi
        .fn()
        .mockRejectedValue(new Error("Network error"));
      render(
        <ResourceLocator
          value={defaultValue({ mode: "list" })}
          onChange={noop}
          loadOptions={loadOptions}
        />,
      );
      fireEvent.click(screen.getByTestId("rl-list-trigger"));

      await waitFor(
        () => expect(screen.getByText("Network error")).toBeInTheDocument(),
        { timeout: 10000 },
      );
      expect(screen.getByText("Retry")).toBeInTheDocument();

      // Retry re-fetches
      loadOptions.mockResolvedValueOnce({
        options: [{ id: "1", name: "Alpha" }],
      });
      fireEvent.click(screen.getByText("Retry"));

      await waitFor(
        () => expect(screen.getByText("Alpha")).toBeInTheDocument(),
        { timeout: 10000 },
      );
    },
    15000,
  );

  /* ── 11. Keyboard navigation arrows + Enter ─────────────────────── */

  it(
    "arrow down highlights next item and Enter selects it",
    async () => {
      const onChange = vi.fn();
      const loadOptions = makeLoadOptions();
      render(
        <ResourceLocator
          value={defaultValue({ mode: "list" })}
          onChange={onChange}
          loadOptions={loadOptions}
        />,
      );
      fireEvent.click(screen.getByTestId("rl-list-trigger"));
      await waitFor(
        () => expect(screen.getByText("Alpha")).toBeInTheDocument(),
        { timeout: 10000 },
      );

      // Arrow down moves hover to index 1 (Beta)
      fireEvent.keyDown(window, { key: "ArrowDown", bubbles: true });
      // Press Enter to select Beta
      fireEvent.keyDown(window, { key: "Enter", bubbles: true });

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          value: "2",
          cachedName: "Beta",
          mode: "list",
        }),
      );
    },
    15000,
  );

  /* ── 12. Esc closes dropdown ────────────────────────────────────── */

  it(
    "Esc key closes the dropdown",
    async () => {
      const loadOptions = makeLoadOptions();
      render(
        <ResourceLocator
          value={defaultValue({ mode: "list" })}
          onChange={noop}
          loadOptions={loadOptions}
        />,
      );
      fireEvent.click(screen.getByTestId("rl-list-trigger"));
      await waitFor(
        () => expect(screen.getByText("Alpha")).toBeInTheDocument(),
        { timeout: 10000 },
      );

      fireEvent.keyDown(window, { key: "Escape", bubbles: true });

      await waitFor(
        () => expect(screen.queryByText("Alpha")).not.toBeInTheDocument(),
        { timeout: 10000 },
      );
    },
    15000,
  );
});
