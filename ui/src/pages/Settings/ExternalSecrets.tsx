// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { useTranslation } from "react-i18next";
import "./ExternalSecrets.css";
import {
  Card,
  Tag,
  Button,
  Input,
  Heading,
  Text,
  Dialog,
  Spinner,
} from "../../components/ui";

type ProviderStatus = "connected" | "not_configured" | "error";

interface Provider {
  id: string;
  name: string;
  icon: string;
  status: ProviderStatus;
  description: string;
}

interface ProviderConfig {
  [key: string]: string;
}

const LOCAL_FILE_PATH = ".graphcaster/workspace.secrets.env";

function statusVariant(status: ProviderStatus): "success" | "default" | "danger" {
  if (status === "connected") return "success";
  if (status === "error") return "danger";
  return "default";
}

function useProviders() {
  const { t } = useTranslation();

  const [providers, setProviders] = React.useState<Provider[]>([
    {
      id: "local_file",
      name: t("app.settings.externalSecrets.localFile.name"),
      icon: "file",
      status: "connected",
      description: LOCAL_FILE_PATH,
    },
    {
      id: "hashicorp_vault",
      name: t("app.settings.externalSecrets.vault.name"),
      icon: "vault",
      status: "not_configured",
      description: "",
    },
    {
      id: "aws_secrets_manager",
      name: t("app.settings.externalSecrets.aws.name"),
      icon: "cloud",
      status: "not_configured",
      description: "",
    },
  ]);

  const [loading, setLoading] = React.useState(true);
  const [testingId, setTestingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/secrets/providers")
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json() as Promise<{ id: string; status: ProviderStatus; config?: Record<string, string> }[]>;
      })
      .then((data) => {
        if (cancelled) return;
        setProviders((prev) =>
          prev.map((p) => {
            const remote = data.find((d) => d.id === p.id);
            if (!remote) return p;
            return { ...p, status: remote.status };
          })
        );
      })
      .catch(() => {
        // 404 or network error — keep defaults (not_configured)
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateProvider(id: string, patch: Partial<Provider>) {
    setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  async function testProvider(id: string) {
    setTestingId(id);
    try {
      await fetch(`/api/v1/secrets/providers/${id}/test`, { method: "POST" });
      updateProvider(id, { status: "connected" });
    } catch {
      updateProvider(id, { status: "error" });
    } finally {
      setTestingId(null);
    }
  }

  async function saveProvider(id: string, config: ProviderConfig) {
    await fetch(`/api/v1/secrets/providers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    updateProvider(id, { status: "connected" });
  }

  function disconnectProvider(id: string) {
    updateProvider(id, { status: "not_configured" });
  }

  return { providers, loading, testingId, testProvider, saveProvider, disconnectProvider };
}

interface ConfigModalProps {
  provider: Provider | null;
  onClose: () => void;
  onSave: (id: string, config: ProviderConfig) => Promise<void>;
}

function ConfigModal({ provider, onClose, onSave }: ConfigModalProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = React.useState(false);
  const [fields, setFields] = React.useState<ProviderConfig>({});

  React.useEffect(() => {
    setFields({});
    setSaving(false);
  }, [provider?.id]);

  if (!provider) return null;

  function setField(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!provider) return;
    setSaving(true);
    try {
      await onSave(provider.id, fields);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function renderFields() {
    if (provider!.id === "hashicorp_vault") {
      return (
        <>
          <label className="gc-external-secrets__label" htmlFor="vault-url">
            {t("app.settings.externalSecrets.vault.url")}
          </label>
          <Input
            id="vault-url"
            value={fields["url"] ?? ""}
            onChange={(e) => setField("url", e.target.value)}
            placeholder="https://vault.example.com"
            data-testid="vault-url-input"
          />
          <label className="gc-external-secrets__label" htmlFor="vault-token">
            {t("app.settings.externalSecrets.vault.token")}
          </label>
          <Input
            id="vault-token"
            type="password"
            value={fields["token"] ?? ""}
            onChange={(e) => setField("token", e.target.value)}
            placeholder={t("app.settings.externalSecrets.vault.tokenPh")}
            data-testid="vault-token-input"
          />
        </>
      );
    }
    if (provider!.id === "aws_secrets_manager") {
      return (
        <>
          <label className="gc-external-secrets__label" htmlFor="aws-region">
            {t("app.settings.externalSecrets.aws.region")}
          </label>
          <Input
            id="aws-region"
            value={fields["region"] ?? ""}
            onChange={(e) => setField("region", e.target.value)}
            placeholder="us-east-1"
            data-testid="aws-region-input"
          />
          <label className="gc-external-secrets__label" htmlFor="aws-access-key">
            {t("app.settings.externalSecrets.aws.accessKey")}
          </label>
          <Input
            id="aws-access-key"
            value={fields["access_key_id"] ?? ""}
            onChange={(e) => setField("access_key_id", e.target.value)}
            placeholder={t("app.settings.externalSecrets.aws.accessKeyPh")}
            data-testid="aws-access-key-input"
          />
          <label className="gc-external-secrets__label" htmlFor="aws-secret-key">
            {t("app.settings.externalSecrets.aws.secretKey")}
          </label>
          <Input
            id="aws-secret-key"
            type="password"
            value={fields["secret_access_key"] ?? ""}
            onChange={(e) => setField("secret_access_key", e.target.value)}
            placeholder={t("app.settings.externalSecrets.aws.secretKeyPh")}
            data-testid="aws-secret-key-input"
          />
        </>
      );
    }
    return null;
  }

  return (
    <Dialog
      open={!!provider}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t("app.settings.externalSecrets.configure", { name: provider.name })}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="outline" size="small" onClick={onClose}>
            {t("app.settings.externalSecrets.cancel")}
          </Button>
          <Button size="small" loading={saving} onClick={handleSave} data-testid="modal-save-btn">
            {t("app.settings.externalSecrets.save")}
          </Button>
        </div>
      }
    >
      <div className="gc-external-secrets__modal-fields">{renderFields()}</div>
    </Dialog>
  );
}

export default function ExternalSecretsPage() {
  const { t } = useTranslation();
  const { providers, loading, testingId, testProvider, saveProvider, disconnectProvider } =
    useProviders();

  const [configuringId, setConfiguringId] = React.useState<string | null>(null);

  const configuringProvider = providers.find((p) => p.id === configuringId) ?? null;

  return (
    <div className="gc-external-secrets-page" data-testid="external-secrets-page">
      <Heading level={2} size="xl" className="gc-external-secrets__heading">
        {t("app.settings.externalSecrets.title")}
      </Heading>
      <Text size="sm" color="secondary" style={{ marginBottom: 24 }}>
        {t("app.settings.externalSecrets.subtitle")}
      </Text>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
          <Spinner size="medium" />
        </div>
      ) : (
        <div className="gc-external-secrets__cards" data-testid="providers-list">
          {providers.map((provider) => (
            <div key={provider.id} data-testid={`provider-card-${provider.id}`}>
            <Card className="gc-external-secrets__card">
              <Card.Header
                title={
                  <div className="gc-external-secrets__card-title">
                    <span className="gc-external-secrets__provider-name">{provider.name}</span>
                    <span data-testid={`provider-status-${provider.id}`}>
                      <Tag
                        variant={statusVariant(provider.status)}
                        size="small"
                      >
                        {t(`app.settings.externalSecrets.status.${provider.status}`)}
                      </Tag>
                    </span>
                  </div>
                }
              />
              <Card.Body>
                {provider.id === "local_file" ? (
                  <Text size="sm" color="secondary">
                    {t("app.settings.externalSecrets.localFile.pathLabel")}{" "}
                    <code className="gc-external-secrets__path">{LOCAL_FILE_PATH}</code>
                  </Text>
                ) : (
                  <Text size="sm" color="secondary">
                    {provider.status === "not_configured"
                      ? t("app.settings.externalSecrets.notConfiguredHint")
                      : provider.description}
                  </Text>
                )}
              </Card.Body>
              <Card.Footer>
                <div className="gc-external-secrets__card-actions">
                  {provider.id !== "local_file" && (
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => setConfiguringId(provider.id)}
                      data-testid={`btn-configure-${provider.id}`}
                    >
                      {t("app.settings.externalSecrets.configure", { name: "" }).trim()}
                    </Button>
                  )}
                  {provider.status === "connected" && provider.id !== "local_file" && (
                    <Button
                      variant="outline"
                      size="small"
                      onClick={() => disconnectProvider(provider.id)}
                      data-testid={`btn-disconnect-${provider.id}`}
                    >
                      {t("app.settings.externalSecrets.disconnect")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="small"
                    loading={testingId === provider.id}
                    onClick={() => void testProvider(provider.id)}
                    data-testid={`btn-test-${provider.id}`}
                  >
                    {t("app.settings.externalSecrets.test")}
                  </Button>
                </div>
              </Card.Footer>
            </Card>
            </div>
          ))}
        </div>
      )}

      <ConfigModal
        provider={configuringProvider}
        onClose={() => setConfiguringId(null)}
        onSave={saveProvider}
      />
    </div>
  );
}
