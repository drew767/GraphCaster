// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { DateTimeInput } from "../DateTimeInput";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "app.ndv.parameters.types.dateTime.now": "Now",
        "app.ndv.parameters.types.dateTime.placeholder": "Pick date & time",
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock("../../../ui/Button/Button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    "data-testid": testId,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    "data-testid"?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} data-testid={testId}>
      {children}
    </button>
  ),
}));

describe("DateTimeInput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T10:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits ISO string on change", () => {
    const onChange = vi.fn();
    render(<DateTimeInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByTestId("param-datetime-input"), {
      target: { value: "2026-05-12T12:30" },
    });
    expect(onChange).toHaveBeenCalled();
    const arg = onChange.mock.calls[0][0] as string;
    expect(arg).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(new Date(arg).toString()).not.toBe("Invalid Date");
  });

  it("Now button sets current time", () => {
    const onChange = vi.fn();
    render(<DateTimeInput value="" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("param-datetime-now"));
    expect(onChange).toHaveBeenCalledWith("2026-05-12T10:00:00.000Z");
  });
});
