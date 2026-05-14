// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { useTranslation } from "react-i18next";
import "./CommunityNodes.css";
import {
  Card,
  Tag,
  Button,
  Input,
  Heading,
  Text,
  Tabs,
  Switch,
  AlertDialog,
  Dialog,
  Spinner,
} from "../../components/ui";

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  author: string;
  enabled: boolean;
  updateAvailable?: boolean;
  permissions: {
    network?: boolean;
    storage?: boolean;
    subprocess?: boolean;
    secrets?: boolean;
    modelCalls?: boolean;
  };
}

export interface RegistryPlugin {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: string;
  permissions: InstalledPlugin["permissions"];
}

function PermissionIcons({ permissions }: { permissions: InstalledPlugin["permissions"] }) {
  const { t } = useTranslation();
  return (
    <div className="gc-community-nodes__perms" aria-label={t("app.settings.communityNodes.permissions")}>
      {permissions.network && <span title={t("app.settings.communityNodes.perm.network")} aria-label={t("app.settings.communityNodes.perm.network")}>🌐</span>}
      {permissions.storage && <span title={t("app.settings.communityNodes.perm.storage")} aria-label={t("app.settings.communityNodes.perm.storage")}>💾</span>}
      {permissions.subprocess && <span title={t("app.settings.communityNodes.perm.subprocess")} aria-label={t("app.settings.communityNodes.perm.subprocess")}>🔧</span>}
      {permissions.secrets && <span title={t("app.settings.communityNodes.perm.secrets")} aria-label={t("app.settings.communityNodes.perm.secrets")}>🔑</span>}
      {permissions.modelCalls && <span title={t("app.settings.communityNodes.perm.modelCalls")} aria-label={t("app.settings.communityNodes.perm.modelCalls")}>🤖</span>}
    </div>
  );
}

interface InstallGrantModalProps {
  plugin: RegistryPlugin | null;
  onAccept: (plugin: RegistryPlugin) => Promise<void>;
  onCancel: () => void;
}

function InstallGrantModal({ plugin, onAccept, onCancel }: InstallGrantModalProps) {
  const { t } = useTranslation();
  const [installing, setInstalling] = React.useState(false);

  async function handleAccept() {
    if (!plugin) return;
    setInstalling(true);
    try {
      await onAccept(plugin);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Dialog
      open={!!plugin}
      onOpenChange={(open) => { if (!open) onCancel(); }}
      title={t("app.settings.communityNodes.installTitle", { name: plugin?.name ?? "" })}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="outline" size="small" onClick={onCancel}>
            {t("app.settings.communityNodes.cancel")}
          </Button>
          <Button
            size="small"
            loading={installing}
            onClick={handleAccept}
            data-testid="grant-accept-btn"
          >
            {t("app.settings.communityNodes.acceptInstall")}
          </Button>
        </div>
      }
    >
      <div data-testid="grant-modal-body">
        <Text size="sm" color="secondary" style={{ marginBottom: 12 }}>
          {t("app.settings.communityNodes.permissionsRequested")}
        </Text>
        {plugin && <PermissionIcons permissions={plugin.permissions} />}
      </div>
    </Dialog>
  );
}

function useInstalledPlugins() {
  const [plugins, setPlugins] = React.useState<InstalledPlugin[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/plugins/installed")
      .then((r) => (r.ok ? (r.json() as Promise<InstalledPlugin[]>) : []))
      .catch(() => [] as InstalledPlugin[])
      .then((data) => {
        if (!cancelled) {
          setPlugins(data);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  function toggleEnabled(id: string) {
    setPlugins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p))
    );
  }

  function uninstall(id: string) {
    setPlugins((prev) => prev.filter((p) => p.id !== id));
  }

  return { plugins, loading, toggleEnabled, uninstall };
}

function InstalledTab() {
  const { t } = useTranslation();
  const { plugins, loading, toggleEnabled, uninstall } = useInstalledPlugins();
  const [uninstallTarget, setUninstallTarget] = React.useState<string | null>(null);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
        <Spinner size="medium" />
      </div>
    );
  }

  if (plugins.length === 0) {
    return (
      <div className="gc-community-nodes__empty" data-testid="installed-empty">
        <Text size="sm" color="secondary">
          {t("app.settings.communityNodes.noInstalled")}
        </Text>
      </div>
    );
  }

  return (
    <>
      <div className="gc-community-nodes__grid" data-testid="installed-grid">
        {plugins.map((plugin) => (
          <div key={plugin.id} data-testid={`plugin-card-${plugin.id}`}>
          <Card className="gc-community-nodes__card">
            <Card.Header
              title={
                <div className="gc-community-nodes__card-header">
                  <div>
                    <span className="gc-community-nodes__plugin-name">{plugin.name}</span>
                    <span className="gc-community-nodes__plugin-meta">
                      v{plugin.version} · {plugin.author}
                    </span>
                  </div>
                  <Switch
                    checked={plugin.enabled}
                    onCheckedChange={() => toggleEnabled(plugin.id)}
                    size="small"
                    data-testid={`toggle-${plugin.id}`}
                  />
                </div>
              }
            />
            <Card.Body>
              <PermissionIcons permissions={plugin.permissions} />
              {plugin.updateAvailable && (
                <span style={{ marginTop: 8, display: "inline-block" }}>
                  <Tag variant="info" size="small">
                    {t("app.settings.communityNodes.updateAvailable")}
                  </Tag>
                </span>
              )}
            </Card.Body>
            <Card.Footer>
              <div className="gc-community-nodes__card-actions">
                <Button variant="ghost" size="small" data-testid={`btn-settings-${plugin.id}`}>
                  {t("app.settings.communityNodes.settings")}
                </Button>
                {plugin.updateAvailable && (
                  <Button variant="secondary" size="small" data-testid={`btn-update-${plugin.id}`}>
                    {t("app.settings.communityNodes.update")}
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="small"
                  onClick={() => setUninstallTarget(plugin.id)}
                  data-testid={`btn-uninstall-${plugin.id}`}
                >
                  {t("app.settings.communityNodes.uninstall")}
                </Button>
              </div>
            </Card.Footer>
          </Card>
          </div>
        ))}
      </div>

      <AlertDialog
        open={!!uninstallTarget}
        onOpenChange={(open) => { if (!open) setUninstallTarget(null); }}
        title={t("app.settings.communityNodes.uninstallTitle")}
        description={t("app.settings.communityNodes.uninstallConfirm")}
        confirmLabel={t("app.settings.communityNodes.uninstall")}
        cancelLabel={t("app.settings.communityNodes.cancel")}
        destructive
        onConfirm={() => {
          if (uninstallTarget) uninstall(uninstallTarget);
          setUninstallTarget(null);
        }}
        onCancel={() => setUninstallTarget(null)}
      />
    </>
  );
}

const CATEGORIES = ["all", "ai", "data", "integration", "utility"];

function BrowseTab() {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState("all");
  const [results, setResults] = React.useState<RegistryPlugin[]>([]);
  const [searching, setSearching] = React.useState(true);
  const [grantPlugin, setGrantPlugin] = React.useState<RegistryPlugin | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setSearching(true);
    const params = new URLSearchParams({ q: query });
    if (category !== "all") params.set("category", category);
    fetch(`/api/v1/plugins/registry/search?${params.toString()}`)
      .then((r) => (r.ok ? (r.json() as Promise<RegistryPlugin[]>) : []))
      .catch(() => [] as RegistryPlugin[])
      .then((data) => {
        if (!cancelled) {
          setResults(data);
          setSearching(false);
        }
      });
    return () => { cancelled = true; };
  }, [query, category]);

  async function handleInstall(plugin: RegistryPlugin) {
    await fetch("/api/v1/plugins/registry/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: plugin.id }),
    });
    setGrantPlugin(null);
  }

  return (
    <div data-testid="browse-tab">
      <div className="gc-community-nodes__browse-controls">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("app.settings.communityNodes.searchPh")}
          data-testid="registry-search-input"
        />
        <div className="gc-community-nodes__categories" role="group" aria-label={t("app.settings.communityNodes.filterByCategory")}>
          {CATEGORIES.map((cat) => (
            <Button
              key={cat}
              variant={category === cat ? "solid" : "ghost"}
              size="small"
              onClick={() => setCategory(cat)}
              data-testid={`category-btn-${cat}`}
            >
              {t(`app.settings.communityNodes.category.${cat}`)}
            </Button>
          ))}
        </div>
      </div>

      {searching ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
          <Spinner size="medium" />
        </div>
      ) : results.length === 0 ? (
        <div className="gc-community-nodes__empty" data-testid="registry-empty">
          <Text size="sm" color="secondary">
            {t("app.settings.communityNodes.noResults")}
          </Text>
        </div>
      ) : (
        <div className="gc-community-nodes__grid" data-testid="registry-grid">
          {results.map((plugin) => (
            <div key={plugin.id} data-testid={`registry-card-${plugin.id}`}>
            <Card className="gc-community-nodes__card">
              <Card.Header title={plugin.name} />
              <Card.Body>
                <Text size="sm" color="secondary">
                  v{plugin.version} · {plugin.author}
                </Text>
                <Text size="sm" style={{ marginTop: 4 }}>
                  {plugin.description}
                </Text>
                <PermissionIcons permissions={plugin.permissions} />
              </Card.Body>
              <Card.Footer>
                <Button
                  size="small"
                  onClick={() => setGrantPlugin(plugin)}
                  data-testid={`btn-install-${plugin.id}`}
                >
                  {t("app.settings.communityNodes.install")}
                </Button>
              </Card.Footer>
            </Card>
            </div>
          ))}
        </div>
      )}

      <InstallGrantModal
        plugin={grantPlugin}
        onAccept={handleInstall}
        onCancel={() => setGrantPlugin(null)}
      />
    </div>
  );
}

export default function CommunityNodesPage() {
  const { t } = useTranslation();

  const tabs = [
    {
      id: "installed",
      label: t("app.settings.communityNodes.tabInstalled"),
      content: <InstalledTab />,
    },
    {
      id: "browse",
      label: t("app.settings.communityNodes.tabBrowse"),
      content: <BrowseTab />,
    },
  ];

  return (
    <div className="gc-community-nodes-page" data-testid="community-nodes-page">
      <div className="gc-community-nodes__header">
        <Heading level={2} size="xl">
          {t("app.settings.communityNodes.title")}
        </Heading>
        <Button size="small" data-testid="btn-install-new">
          {t("app.settings.communityNodes.installNew")}
        </Button>
      </div>

      <Tabs items={tabs} defaultValue="installed" data-testid="community-nodes-tabs" />
    </div>
  );
}
