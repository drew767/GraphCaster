// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

vi.mock("../../toast/ToastProvider", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import VariablesPage from "./Variables";
import { variablesApi } from "../../api/variables";

function renderPage() {
  return render(
    <MemoryRouter>
      <VariablesPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  globalThis.localStorage.clear();
  vi.clearAllMocks();
});

describe("VariablesPage", () => {
  it("renders heading and new-variable button", async () => {
    renderPage();
    expect(screen.getByTestId("variables-page")).toBeTruthy();
    expect(screen.getByTestId("variable-new-btn")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("app.settings.variables.emptyTitle")).toBeTruthy();
    });
  });

  it("creates a variable through localStorage shim and renders it", async () => {
    renderPage();

    fireEvent.click(screen.getByTestId("variable-new-btn"));

    const keyInput = await screen.findByTestId("variable-key-input");
    fireEvent.change(keyInput, { target: { value: "my_key" } });

    const valueInput = screen.getByTestId("variable-value-input");
    fireEvent.change(valueInput, { target: { value: "hello" } });

    fireEvent.click(screen.getByTestId("variable-modal-submit"));

    await waitFor(() => {
      expect(screen.getByText("my_key")).toBeTruthy();
    });
    expect(mockToast.success).toHaveBeenCalled();

    const stored = await variablesApi.list();
    expect(stored).toHaveLength(1);
    expect(stored[0].key).toBe("my_key");
    expect(stored[0].value).toBe("hello");
  });

  it("rejects invalid keys", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("variable-new-btn"));

    const keyInput = await screen.findByTestId("variable-key-input");
    fireEvent.change(keyInput, { target: { value: "Bad Key!" } });

    await waitFor(() => {
      expect(screen.getByTestId("variable-key-error").textContent).toContain("keyInvalid");
    });
  });

  it("edits an existing variable", async () => {
    await variablesApi.create({
      key: "edit_me",
      value: "old",
      type: "string",
      isSecret: false,
    });

    renderPage();

    const editBtn = await screen.findByTestId(/^variable-edit-/);
    fireEvent.click(editBtn);

    const valueInput = await screen.findByTestId("variable-value-input");
    fireEvent.change(valueInput, { target: { value: "new" } });

    fireEvent.click(screen.getByTestId("variable-modal-submit"));

    await waitFor(async () => {
      const stored = await variablesApi.list();
      expect(stored[0].value).toBe("new");
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("deletes a variable after confirmation", async () => {
    await variablesApi.create({
      key: "to_delete",
      value: "x",
      type: "string",
      isSecret: false,
    });

    renderPage();

    const deleteBtn = await screen.findByTestId(/^variable-delete-/);
    fireEvent.click(deleteBtn);

    const confirmBtn = await screen.findByText("app.settings.variables.deleteConfirm");
    fireEvent.click(confirmBtn);

    await waitFor(async () => {
      const stored = await variablesApi.list();
      expect(stored).toHaveLength(0);
    });
  });

  it("masks secret values and reveals on eye toggle", async () => {
    const created = await variablesApi.create({
      key: "secret_api",
      value: "super-secret-token",
      type: "string",
      isSecret: true,
    });

    renderPage();

    const valueCell = await screen.findByTestId(`variable-value-${created.id}`);
    expect(valueCell.textContent).not.toContain("super-secret-token");
    expect(valueCell.textContent).toMatch(/^•+$/);

    const reveal = screen.getByTestId(`variable-reveal-${created.id}`);
    fireEvent.click(reveal);

    await waitFor(() => {
      expect(
        screen.getByTestId(`variable-value-${created.id}`).textContent,
      ).toBe("super-secret-token");
    });

    fireEvent.click(reveal);
    await waitFor(() => {
      expect(
        screen.getByTestId(`variable-value-${created.id}`).textContent,
      ).toMatch(/^•+$/);
    });
  });
});
