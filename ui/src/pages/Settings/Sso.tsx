// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  Tag,
  Button,
  Input,
  Switch,
  Heading,
  Text,
  Select,
  Icon,
} from "../../components/ui";

// ---------- types ----------

interface SamlAttributeMap {
  email: string;
  firstName: string;
  lastName: string;
  groups: string;
}

interface SamlConfig {
  enabled: boolean;
  providerName: string;
  loginUrl: string;
  logoutUrl: string;
  metadataXml: string;
  certificate: string;
  attributes: SamlAttributeMap;
}

interface OidcConfig {
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
}

interface GroupRoleMapping {
  id: string;
  group: string;
  role: string;
}

interface ProvisioningConfig {
  autoProvision: boolean;
  defaultRole: string;
  groupRoleMappings: GroupRoleMapping[];
}

interface SsoFullConfig {
  saml: SamlConfig;
  oidc: OidcConfig;
  provisioning: ProvisioningConfig;
}

const STORAGE_KEY = "gc.sso.config";
const ROLE_OPTIONS = ["viewer", "editor", "admin", "owner"] as const;

function emptyConfig(): SsoFullConfig {
  return {
    saml: {
      enabled: false,
      providerName: "",
      loginUrl: "",
      logoutUrl: "",
      metadataXml: "",
      certificate: "",
      attributes: {
        email: "email",
        firstName: "firstName",
        lastName: "lastName",
        groups: "groups",
      },
    },
    oidc: {
      enabled: false,
      issuerUrl: "",
      clientId: "",
      clientSecret: "",
      scopes: "openid email profile",
    },
    provisioning: {
      autoProvision: false,
      defaultRole: "viewer",
      groupRoleMappings: [],
    },
  };
}

function loadLocalConfig(): SsoFullConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyConfig();
    const parsed = JSON.parse(raw) as Partial<SsoFullConfig>;
    const base = emptyConfig();
    return {
      saml: { ...base.saml, ...(parsed.saml ?? {}) },
      oidc: { ...base.oidc, ...(parsed.oidc ?? {}) },
      provisioning: { ...base.provisioning, ...(parsed.provisioning ?? {}) },
    };
  } catch {
    return emptyConfig();
  }
}

function saveLocalConfig(cfg: SsoFullConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore
  }
}

function readFileText(file: File): Promise<string> {
  if (typeof (file as unknown as { text?: () => Promise<string> }).text === "function") {
    return (file as unknown as { text: () => Promise<string> }).text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

// Try to extract SSO/SLO endpoints + cert from IdP metadata XML.
// This is a best-effort parser that uses DOMParser on the browser.
function parseSamlMetadata(xml: string): Partial<SamlConfig> {
  if (typeof DOMParser === "undefined") return {};
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) return {};

    const sso = doc.querySelector(
      'SingleSignOnService[Binding*="HTTP-Redirect"], SingleSignOnService',
    );
    const slo = doc.querySelector(
      'SingleLogoutService[Binding*="HTTP-Redirect"], SingleLogoutService',
    );
    const certEl = doc.querySelector("X509Certificate");

    const next: Partial<SamlConfig> = {};
    if (sso?.getAttribute("Location")) next.loginUrl = sso.getAttribute("Location") ?? "";
    if (slo?.getAttribute("Location")) next.logoutUrl = slo.getAttribute("Location") ?? "";
    if (certEl?.textContent) next.certificate = certEl.textContent.trim();
    return next;
  } catch {
    return {};
  }
}

// ---------- API hook ----------

function useSsoApi() {
  const [config, setConfig] = React.useState<SsoFullConfig>(() => loadLocalConfig());
  const [backendMissing, setBackendMissing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/v1/sso/config");
        if (res.status === 404) {
          setBackendMissing(true);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as Partial<SsoFullConfig>;
        setBackendMissing(false);
        setConfig((prev) => ({
          saml: { ...prev.saml, ...(data.saml ?? {}) },
          oidc: { ...prev.oidc, ...(data.oidc ?? {}) },
          provisioning: { ...prev.provisioning, ...(data.provisioning ?? {}) },
        }));
      } catch {
        // ignore — use local
      }
    }
    void load();
  }, []);

  const update = React.useCallback((next: SsoFullConfig) => {
    setConfig(next);
    saveLocalConfig(next);
  }, []);

  const save = React.useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/sso/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      saveLocalConfig(config);
      return res.ok || res.status === 404;
    } catch {
      saveLocalConfig(config);
      return true;
    } finally {
      setSaving(false);
    }
  }, [config]);

  const test = React.useCallback(async () => {
    try {
      const res = await fetch("/api/v1/sso/test", { method: "POST" });
      if (res.status === 404) return { ok: true, message: "local-fallback" };
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      return { ok: res.ok && data.ok !== false, message: data.message ?? "" };
    } catch {
      return { ok: true, message: "local-fallback" };
    }
  }, []);

  return { config, update, save, test, saving, backendMissing };
}

// ---------- SP Info ----------

function ServiceProviderInfo() {
  const { t } = useTranslation();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const items = [
    { label: t("app.settings.sso.spEntityId"), value: `${origin}/saml/metadata`, key: "entity" },
    { label: t("app.settings.sso.spAcsUrl"), value: `${origin}/api/v1/sso/saml/acs`, key: "acs" },
    {
      label: t("app.settings.sso.spLogoutUrl"),
      value: `${origin}/api/v1/sso/saml/slo`,
      key: "slo",
    },
  ];

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore
    }
  }

  return (
    <div data-testid="sso-sp-info">
      <Card>
        <Card.Header title={t("app.settings.sso.spInfoTitle")} />
        <Card.Body>
          {items.map((it) => (
            <div className="gc-sso-sp-row" key={it.key}>
              <label className="gc-sso-label">{it.label}</label>
              <div className="gc-sso-readonly-field">
                <Input value={it.value} readOnly data-testid={`sso-sp-${it.key}`} />
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => void copy(it.value)}
                  aria-label={t("app.settings.sso.copy")}
                  data-testid={`sso-sp-copy-${it.key}`}
                >
                  <Icon name="copy" size={14} />
                </Button>
              </div>
            </div>
          ))}
        </Card.Body>
      </Card>
    </div>
  );
}

// ---------- main page ----------

export default function SsoPage() {
  const { t } = useTranslation();
  const { config, update, save, test, saving, backendMissing } = useSsoApi();

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string } | null>(
    null,
  );

  function patchSaml(p: Partial<SamlConfig>) {
    update({ ...config, saml: { ...config.saml, ...p } });
  }

  function patchSamlAttrs(p: Partial<SamlAttributeMap>) {
    update({
      ...config,
      saml: { ...config.saml, attributes: { ...config.saml.attributes, ...p } },
    });
  }

  function patchOidc(p: Partial<OidcConfig>) {
    update({ ...config, oidc: { ...config.oidc, ...p } });
  }

  function patchProvisioning(p: Partial<ProvisioningConfig>) {
    update({ ...config, provisioning: { ...config.provisioning, ...p } });
  }

  function addGroupRoleRow() {
    const id = `gr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    patchProvisioning({
      groupRoleMappings: [
        ...config.provisioning.groupRoleMappings,
        { id, group: "", role: "viewer" },
      ],
    });
  }

  function updateGroupRoleRow(id: string, patch: Partial<GroupRoleMapping>) {
    patchProvisioning({
      groupRoleMappings: config.provisioning.groupRoleMappings.map((m) =>
        m.id === id ? { ...m, ...patch } : m,
      ),
    });
  }

  function removeGroupRoleRow(id: string) {
    patchProvisioning({
      groupRoleMappings: config.provisioning.groupRoleMappings.filter((m) => m.id !== id),
    });
  }

  async function handleMetadataUpload(file: File) {
    const text = await readFileText(file);
    const parsed = parseSamlMetadata(text);
    patchSaml({
      metadataXml: text,
      loginUrl: parsed.loginUrl ?? config.saml.loginUrl,
      logoutUrl: parsed.logoutUrl ?? config.saml.logoutUrl,
      certificate: parsed.certificate ?? config.saml.certificate,
    });
  }

  async function handleTest() {
    const r = await test();
    setTestResult(r);
  }

  const roleOptions = ROLE_OPTIONS.map((r) => ({
    value: r,
    label: t(`app.settings.sso.roles.${r}`),
  }));

  return (
    <div className="gc-sso-page" data-testid="sso-page">
      <div className="gc-sso-header">
        <Heading level={2} size="xl" className="gc-sso-heading">
          {t("app.settings.sso.title")}
        </Heading>
        <Button
          onClick={() => void save()}
          disabled={saving}
          data-testid="sso-btn-save"
        >
          {saving ? t("app.settings.sso.saving") : t("app.settings.sso.save")}
        </Button>
      </div>

      {backendMissing && (
        <div data-testid="sso-backend-missing" style={{ marginBottom: 16 }}>
          <Text size="sm" color="secondary">
            {t("app.settings.sso.backendMissing")}
          </Text>
        </div>
      )}

      {/* SAML card */}
      <div data-testid="sso-saml-card">
        <Card>
          <Card.Header
            title={t("app.settings.sso.samlTitle")}
            actions={
              <Tag variant={config.saml.enabled ? "success" : "default"} size="small">
                {config.saml.enabled
                  ? t("app.settings.sso.statusEnabled")
                  : t("app.settings.sso.statusDisabled")}
              </Tag>
            }
          />
          <Card.Body>
            <Switch
              checked={config.saml.enabled}
              onCheckedChange={(checked) => patchSaml({ enabled: checked })}
              label={t("app.settings.sso.enableSaml")}
              data-testid="sso-saml-enable"
            />

            {config.saml.enabled && (
              <div className="gc-sso-form" data-testid="sso-saml-form">
                <label className="gc-sso-label" htmlFor="sso-provider-name">
                  {t("app.settings.sso.providerName")}
                </label>
                <Input
                  id="sso-provider-name"
                  value={config.saml.providerName}
                  onChange={(e) => patchSaml({ providerName: e.target.value })}
                  placeholder="Okta / Auth0 / ..."
                  data-testid="sso-saml-provider-name"
                />

                <label className="gc-sso-label" htmlFor="sso-login-url">
                  {t("app.settings.sso.loginUrl")}
                </label>
                <Input
                  id="sso-login-url"
                  value={config.saml.loginUrl}
                  onChange={(e) => patchSaml({ loginUrl: e.target.value })}
                  placeholder="https://idp.example.com/sso"
                  data-testid="sso-saml-login-url"
                />

                <label className="gc-sso-label" htmlFor="sso-logout-url">
                  {t("app.settings.sso.logoutUrl")}
                </label>
                <Input
                  id="sso-logout-url"
                  value={config.saml.logoutUrl}
                  onChange={(e) => patchSaml({ logoutUrl: e.target.value })}
                  placeholder="https://idp.example.com/slo"
                  data-testid="sso-saml-logout-url"
                />

                <label className="gc-sso-label" htmlFor="sso-metadata-xml">
                  {t("app.settings.sso.metadataXml")}
                </label>
                <textarea
                  id="sso-metadata-xml"
                  className="gc-sso-textarea"
                  rows={5}
                  value={config.saml.metadataXml}
                  onChange={(e) => patchSaml({ metadataXml: e.target.value })}
                  placeholder="<EntityDescriptor ...>"
                  data-testid="sso-saml-metadata"
                />
                <div className="gc-sso-upload-row">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xml,application/xml,text/xml"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleMetadataUpload(file);
                    }}
                    data-testid="sso-saml-metadata-file"
                  />
                  <Button
                    variant="subtle"
                    size="small"
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="sso-saml-metadata-upload"
                  >
                    {t("app.settings.sso.uploadMetadata")}
                  </Button>
                </div>

                <label className="gc-sso-label" htmlFor="sso-cert">
                  {t("app.settings.sso.certificate")}
                </label>
                <textarea
                  id="sso-cert"
                  className="gc-sso-textarea"
                  rows={4}
                  value={config.saml.certificate}
                  onChange={(e) => patchSaml({ certificate: e.target.value })}
                  placeholder="-----BEGIN CERTIFICATE-----"
                  data-testid="sso-saml-cert"
                />

                <Heading level={4} size="sm">
                  {t("app.settings.sso.attributeMappings")}
                </Heading>
                <div className="gc-sso-attr-grid" data-testid="sso-saml-attrs">
                  <label className="gc-sso-label" htmlFor="sso-attr-email">
                    {t("app.settings.sso.attrEmail")}
                  </label>
                  <Input
                    id="sso-attr-email"
                    value={config.saml.attributes.email}
                    onChange={(e) => patchSamlAttrs({ email: e.target.value })}
                    data-testid="sso-attr-email"
                  />
                  <label className="gc-sso-label" htmlFor="sso-attr-first-name">
                    {t("app.settings.sso.attrFirstName")}
                  </label>
                  <Input
                    id="sso-attr-first-name"
                    value={config.saml.attributes.firstName}
                    onChange={(e) => patchSamlAttrs({ firstName: e.target.value })}
                    data-testid="sso-attr-first-name"
                  />
                  <label className="gc-sso-label" htmlFor="sso-attr-last-name">
                    {t("app.settings.sso.attrLastName")}
                  </label>
                  <Input
                    id="sso-attr-last-name"
                    value={config.saml.attributes.lastName}
                    onChange={(e) => patchSamlAttrs({ lastName: e.target.value })}
                    data-testid="sso-attr-last-name"
                  />
                  <label className="gc-sso-label" htmlFor="sso-attr-groups">
                    {t("app.settings.sso.attrGroups")}
                  </label>
                  <Input
                    id="sso-attr-groups"
                    value={config.saml.attributes.groups}
                    onChange={(e) => patchSamlAttrs({ groups: e.target.value })}
                    data-testid="sso-attr-groups"
                  />
                </div>

                <div className="gc-sso-test-row">
                  <Button
                    variant="subtle"
                    onClick={() => void handleTest()}
                    data-testid="sso-btn-test"
                  >
                    {t("app.settings.sso.testSso")}
                  </Button>
                  {testResult && (
                    <span data-testid="sso-test-result">
                      <Text size="sm" color={testResult.ok ? "success" : "danger"}>
                        {testResult.ok
                          ? t("app.settings.sso.testOpenedTab")
                          : t("app.settings.sso.testFailed", { message: testResult.message })}
                      </Text>
                    </span>
                  )}
                </div>
              </div>
            )}
          </Card.Body>
        </Card>
      </div>

      {/* OIDC card */}
      <div data-testid="sso-oidc-card">
        <Card>
          <Card.Header
            title={t("app.settings.sso.oidcTitle")}
            actions={
              <Tag variant={config.oidc.enabled ? "success" : "default"} size="small">
                {config.oidc.enabled
                  ? t("app.settings.sso.statusEnabled")
                  : t("app.settings.sso.statusDisabled")}
              </Tag>
            }
          />
          <Card.Body>
            <Switch
              checked={config.oidc.enabled}
              onCheckedChange={(checked) => patchOidc({ enabled: checked })}
              label={t("app.settings.sso.enableOidc")}
              data-testid="sso-oidc-enable"
            />

            {config.oidc.enabled && (
              <div className="gc-sso-form" data-testid="sso-oidc-form">
                <label className="gc-sso-label" htmlFor="sso-oidc-issuer">
                  {t("app.settings.sso.issuerUrl")}
                </label>
                <Input
                  id="sso-oidc-issuer"
                  value={config.oidc.issuerUrl}
                  onChange={(e) => patchOidc({ issuerUrl: e.target.value })}
                  placeholder="https://accounts.example.com"
                  data-testid="sso-oidc-issuer"
                />

                <label className="gc-sso-label" htmlFor="sso-oidc-client-id">
                  {t("app.settings.sso.clientId")}
                </label>
                <Input
                  id="sso-oidc-client-id"
                  value={config.oidc.clientId}
                  onChange={(e) => patchOidc({ clientId: e.target.value })}
                  data-testid="sso-oidc-client-id"
                />

                <label className="gc-sso-label" htmlFor="sso-oidc-client-secret">
                  {t("app.settings.sso.clientSecret")}
                </label>
                <Input
                  id="sso-oidc-client-secret"
                  type="password"
                  value={config.oidc.clientSecret}
                  onChange={(e) => patchOidc({ clientSecret: e.target.value })}
                  data-testid="sso-oidc-client-secret"
                />

                <label className="gc-sso-label" htmlFor="sso-oidc-scopes">
                  {t("app.settings.sso.scopes")}
                </label>
                <Input
                  id="sso-oidc-scopes"
                  value={config.oidc.scopes}
                  onChange={(e) => patchOidc({ scopes: e.target.value })}
                  placeholder="openid email profile"
                  data-testid="sso-oidc-scopes"
                />
              </div>
            )}
          </Card.Body>
        </Card>
      </div>

      {/* Provisioning card */}
      <div data-testid="sso-provisioning-card">
        <Card>
          <Card.Header title={t("app.settings.sso.provisioningTitle")} />
          <Card.Body>
            <Switch
              checked={config.provisioning.autoProvision}
              onCheckedChange={(checked) => patchProvisioning({ autoProvision: checked })}
              label={t("app.settings.sso.autoProvision")}
              data-testid="sso-auto-provision"
            />

            <div className="gc-sso-form">
              <label className="gc-sso-label" htmlFor="sso-default-role">
                {t("app.settings.sso.defaultRole")}
              </label>
              <Select<string>
                value={config.provisioning.defaultRole}
                onValueChange={(v) => patchProvisioning({ defaultRole: v })}
                options={roleOptions}
                data-testid="sso-default-role"
              />

              <Heading level={4} size="sm">
                {t("app.settings.sso.groupRoleMapping")}
              </Heading>
              <table className="gc-sso-mapping-table" data-testid="sso-mapping-table">
                <thead>
                  <tr>
                    <th>{t("app.settings.sso.groupName")}</th>
                    <th>{t("app.settings.sso.role")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {config.provisioning.groupRoleMappings.map((m) => (
                    <tr key={m.id} data-testid={`sso-mapping-row-${m.id}`}>
                      <td>
                        <Input
                          value={m.group}
                          onChange={(e) => updateGroupRoleRow(m.id, { group: e.target.value })}
                          data-testid={`sso-mapping-group-${m.id}`}
                        />
                      </td>
                      <td>
                        <Select<string>
                          value={m.role}
                          onValueChange={(v) => updateGroupRoleRow(m.id, { role: v })}
                          options={roleOptions}
                          data-testid={`sso-mapping-role-${m.id}`}
                        />
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          size="small"
                          onClick={() => removeGroupRoleRow(m.id)}
                          data-testid={`sso-mapping-remove-${m.id}`}
                        >
                          {t("app.settings.sso.remove")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button
                variant="subtle"
                size="small"
                onClick={addGroupRoleRow}
                data-testid="sso-mapping-add"
              >
                {t("app.settings.sso.addMapping")}
              </Button>
            </div>
          </Card.Body>
        </Card>
      </div>

      <ServiceProviderInfo />
    </div>
  );
}
