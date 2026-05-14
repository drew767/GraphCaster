// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts) {
        let result = k;
        Object.entries(opts).forEach(([key, val]) => {
          result = result.replace(`{{${key}}}`, String(val));
        });
        return result;
      }
      return k;
    },
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import SsoPage from "./Sso";

function renderPage() {
  return render(
    <MemoryRouter>
      <SsoPage />
    </MemoryRouter>,
  );
}

describe("SSO settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockFetch.mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => ({}),
    });
  });

  it("renders the page root element", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sso-page")).toBeInTheDocument();
    });
  });

  it("shows SAML, OIDC, provisioning and SP info cards", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sso-saml-card")).toBeInTheDocument();
    });
    expect(screen.getByTestId("sso-oidc-card")).toBeInTheDocument();
    expect(screen.getByTestId("sso-provisioning-card")).toBeInTheDocument();
    expect(screen.getByTestId("sso-sp-info")).toBeInTheDocument();
  });

  it("shows backend-missing notice when API returns 404", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sso-backend-missing")).toBeInTheDocument();
    });
  });

  it("SAML form is hidden until enable toggle is on", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sso-saml-enable")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("sso-saml-form")).toBeNull();
    fireEvent.click(screen.getByTestId("sso-saml-enable"));
    await waitFor(() => {
      expect(screen.getByTestId("sso-saml-form")).toBeInTheDocument();
    });
  });

  it("OIDC form is hidden until enable toggle is on", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sso-oidc-enable")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("sso-oidc-form")).toBeNull();
    fireEvent.click(screen.getByTestId("sso-oidc-enable"));
    await waitFor(() => {
      expect(screen.getByTestId("sso-oidc-form")).toBeInTheDocument();
    });
  });

  it("group-role mapping table adds and removes rows", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sso-mapping-add")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("sso-mapping-add"));
    await waitFor(() => {
      const rows = screen.getAllByText("app.settings.sso.remove");
      expect(rows.length).toBe(1);
    });
    fireEvent.click(screen.getByText("app.settings.sso.remove"));
    await waitFor(() => {
      expect(screen.queryByText("app.settings.sso.remove")).toBeNull();
    });
  });

  it("metadata XML upload populates the textarea and parsed login URL", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sso-saml-enable")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("sso-saml-enable"));
    await waitFor(() => {
      expect(screen.getByTestId("sso-saml-metadata-file")).toBeInTheDocument();
    });

    const xml = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata">
  <IDPSSODescriptor>
    <KeyDescriptor>
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data>
          <X509Certificate>MIICERT==</X509Certificate>
        </X509Data>
      </KeyInfo>
    </KeyDescriptor>
    <SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/slo"/>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso"/>
  </IDPSSODescriptor>
</EntityDescriptor>`;

    const file = new File([xml], "metadata.xml", { type: "application/xml" });
    const input = screen.getByTestId("sso-saml-metadata-file") as HTMLInputElement;

    Object.defineProperty(input, "files", {
      value: [file],
      writable: false,
    });
    fireEvent.change(input);

    await waitFor(() => {
      const ta = screen.getByTestId("sso-saml-metadata") as HTMLTextAreaElement;
      expect(ta.value).toContain("EntityDescriptor");
    });

    await waitFor(() => {
      const login = screen.getByTestId("sso-saml-login-url") as HTMLInputElement;
      expect(login.value).toBe("https://idp.example.com/sso");
    });

    const logout = screen.getByTestId("sso-saml-logout-url") as HTMLInputElement;
    expect(logout.value).toBe("https://idp.example.com/slo");

    const cert = screen.getByTestId("sso-saml-cert") as HTMLTextAreaElement;
    expect(cert.value).toContain("MIICERT==");
  });

  it("Test SSO button shows result text", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/sso/test")) {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: async () => ({ ok: true, message: "" }),
        });
      }
      return Promise.resolve({
        status: 404,
        ok: false,
        json: async () => ({}),
      });
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sso-saml-enable")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("sso-saml-enable"));
    await waitFor(() => {
      expect(screen.getByTestId("sso-btn-test")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("sso-btn-test"));
    await waitFor(() => {
      expect(screen.getByTestId("sso-test-result")).toHaveTextContent(
        "app.settings.sso.testOpenedTab",
      );
    });
  });
});
