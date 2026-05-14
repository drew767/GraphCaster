// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { CredentialUsagesDrawer, type CredentialUsage } from "./CredentialUsagesDrawer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts) {
        return Object.entries(opts).reduce<string>(
          (s, [k, v]) => s.replace(`{{${k}}}`, String(v)),
          key,
        );
      }
      return key;
    },
  }),
}));

describe("CredentialUsagesDrawer", () => {
  it("shows empty state when no usages returned", async () => {
    const loader = vi.fn().mockResolvedValue([] as CredentialUsage[]);
    render(
      <CredentialUsagesDrawer
        open
        credentialId="cred-1"
        credentialName="OpenAI"
        onClose={() => undefined}
        loadUsages={loader}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("credential-usages-empty")).toBeInTheDocument(),
    );
    expect(loader).toHaveBeenCalledWith("cred-1");
  });

  it("renders workflow rows with links and node ids", async () => {
    const items: CredentialUsage[] = [
      { workflowId: "wf1", workflowName: "First", nodeIds: ["nodeA", "nodeB"] },
      { workflowId: "wf2", workflowName: "Second", nodeIds: ["x"] },
    ];
    render(
      <CredentialUsagesDrawer
        open
        credentialId="cred-2"
        credentialName="Anthropic"
        onClose={() => undefined}
        loadUsages={async () => items}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("credential-usages-list")).toBeInTheDocument(),
    );
    const link1 = screen.getByTestId("credential-usages-link-wf1") as HTMLAnchorElement;
    expect(link1.getAttribute("href")).toBe("/workflow/wf1");
    expect(screen.getByTestId("credential-usages-item-wf2")).toBeInTheDocument();
  });

  it("shows error state when loader rejects", async () => {
    render(
      <CredentialUsagesDrawer
        open
        credentialId="cred-3"
        credentialName="GHCR"
        onClose={() => undefined}
        loadUsages={async () => {
          throw new Error("network");
        }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("credential-usages-error")).toBeInTheDocument(),
    );
  });
});
