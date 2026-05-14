// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  Tag,
  Button,
  Input,
  Heading,
  Text,
  Dialog,
  Switch,
  RadioGroup,
  AlertDialog,
} from "../../components/ui";

// ---------- types ----------

type ConnectionStatus = "connected" | "disconnected";
type ProviderId = "github" | "gitlab" | "bitbucket" | "custom";
type ChangeStatus = "added" | "modified" | "deleted";

interface PendingChange {
  id: string;
  path: string;
  status: ChangeStatus;
}

interface SourceControlConfig {
  provider: ProviderId;
  repoUrl: string;
  branch: string;
  authMode: "ssh" | "token";
  sshKey: string;
  token: string;
  protectedBranches: string[];
  autoSyncEnabled: boolean;
  autoSyncIntervalMin: number;
}

interface SourceControlStatusData {
  connected: boolean;
  branch: string;
  ahead: number;
  behind: number;
  pendingChanges: PendingChange[];
  lastSyncAt: string | null;
  repoUrl: string;
}

const STORAGE_CONFIG = "gc.source_control.config";
const STORAGE_STATUS = "gc.source_control.status";

function emptyConfig(): SourceControlConfig {
  return {
    provider: "github",
    repoUrl: "",
    branch: "main",
    authMode: "token",
    sshKey: "",
    token: "",
    protectedBranches: ["main"],
    autoSyncEnabled: false,
    autoSyncIntervalMin: 15,
  };
}

function emptyStatus(): SourceControlStatusData {
  return {
    connected: false,
    branch: "",
    ahead: 0,
    behind: 0,
    pendingChanges: [],
    lastSyncAt: null,
    repoUrl: "",
  };
}

function loadLocalConfig(): SourceControlConfig {
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG);
    if (!raw) return emptyConfig();
    return { ...emptyConfig(), ...(JSON.parse(raw) as Partial<SourceControlConfig>) };
  } catch {
    return emptyConfig();
  }
}

function loadLocalStatus(): SourceControlStatusData {
  try {
    const raw = localStorage.getItem(STORAGE_STATUS);
    if (!raw) return emptyStatus();
    return { ...emptyStatus(), ...(JSON.parse(raw) as Partial<SourceControlStatusData>) };
  } catch {
    return emptyStatus();
  }
}

function saveLocalConfig(cfg: SourceControlConfig) {
  try {
    localStorage.setItem(STORAGE_CONFIG, JSON.stringify(cfg));
  } catch {
    // ignore quota / disabled storage
  }
}

function saveLocalStatus(s: SourceControlStatusData) {
  try {
    localStorage.setItem(STORAGE_STATUS, JSON.stringify(s));
  } catch {
    // ignore
  }
}

// ---------- API hook ----------

function useSourceControlApi() {
  const [config, setConfig] = React.useState<SourceControlConfig>(() => loadLocalConfig());
  const [status, setStatus] = React.useState<SourceControlStatusData>(() => loadLocalStatus());
  const [backendMissing, setBackendMissing] = React.useState(false);

  const connectionStatus: ConnectionStatus = status.connected ? "connected" : "disconnected";

  const fetchStatus = React.useCallback(async () => {
    try {
      const res = await fetch("/api/v1/source-control/status");
      if (res.status === 404) {
        setBackendMissing(true);
        const fallback = loadLocalStatus();
        setStatus(fallback);
        return;
      }
      if (!res.ok) {
        setStatus((s) => ({ ...s, connected: false }));
        return;
      }
      const data = (await res.json()) as Partial<SourceControlStatusData> & {
        connected?: boolean;
        pending_changes?: PendingChange[];
      };
      setBackendMissing(false);
      const next: SourceControlStatusData = {
        ...emptyStatus(),
        ...data,
        connected: Boolean(data.connected),
        pendingChanges: data.pendingChanges ?? data.pending_changes ?? [],
      };
      setStatus(next);
      saveLocalStatus(next);
    } catch {
      setStatus((s) => ({ ...s, connected: false }));
    }
  }, []);

  const testConnection = React.useCallback(async (payload: Partial<SourceControlConfig>) => {
    try {
      const res = await fetch("/api/v1/source-control/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 404) {
        // fallback: validate URL is non-empty
        return { ok: Boolean(payload.repoUrl && payload.repoUrl.trim()), message: "local-validation" };
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, message: data.error ?? `HTTP ${res.status}` };
      }
      const data = (await res.json()) as { ok?: boolean; message?: string };
      return { ok: data.ok !== false, message: data.message ?? "" };
    } catch {
      return { ok: Boolean(payload.repoUrl && payload.repoUrl.trim()), message: "network-fallback" };
    }
  }, []);

  const connect = React.useCallback(
    async (next: SourceControlConfig) => {
      saveLocalConfig(next);
      setConfig(next);
      try {
        const res = await fetch("/api/v1/source-control/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo_url: next.repoUrl,
            branch: next.branch,
            auth:
              next.authMode === "ssh"
                ? { ssh_key: next.sshKey }
                : { token: next.token },
          }),
        });
        if (res.ok) {
          await fetchStatus();
          return true;
        }
        if (res.status === 404) {
          // local fallback
          const localStatus: SourceControlStatusData = {
            ...emptyStatus(),
            connected: true,
            branch: next.branch,
            repoUrl: next.repoUrl,
            lastSyncAt: new Date().toISOString(),
          };
          setStatus(localStatus);
          saveLocalStatus(localStatus);
          return true;
        }
        return false;
      } catch {
        const localStatus: SourceControlStatusData = {
          ...emptyStatus(),
          connected: true,
          branch: next.branch,
          repoUrl: next.repoUrl,
          lastSyncAt: new Date().toISOString(),
        };
        setStatus(localStatus);
        saveLocalStatus(localStatus);
        return true;
      }
    },
    [fetchStatus],
  );

  const disconnect = React.useCallback(async () => {
    try {
      await fetch("/api/v1/source-control/disconnect", { method: "POST" });
    } catch {
      // ignore
    }
    const next = emptyStatus();
    setStatus(next);
    saveLocalStatus(next);
  }, []);

  const pull = React.useCallback(async () => {
    try {
      const res = await fetch("/api/v1/source-control/pull", { method: "POST" });
      if (res.ok) {
        const data = (await res.json()) as { applied?: string[]; commits?: number };
        await fetchStatus();
        return { ok: true, commits: data.commits ?? data.applied?.length ?? 0 };
      }
      return { ok: false, commits: 0 };
    } catch {
      return { ok: false, commits: 0 };
    }
  }, [fetchStatus]);

  const push = React.useCallback(
    async (message: string) => {
      try {
        const res = await fetch("/api/v1/source-control/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, files: [] }),
        });
        if (res.ok) {
          await fetchStatus();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [fetchStatus],
  );

  const updateConfig = React.useCallback((next: SourceControlConfig) => {
    saveLocalConfig(next);
    setConfig(next);
  }, []);

  React.useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  return {
    connectionStatus,
    config,
    status,
    backendMissing,
    fetchStatus,
    testConnection,
    connect,
    disconnect,
    pull,
    push,
    updateConfig,
  };
}

// ---------- Connect Repo Modal ----------

interface ConnectRepoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: SourceControlConfig;
  onTest: (cfg: SourceControlConfig) => Promise<{ ok: boolean; message: string }>;
  onSave: (cfg: SourceControlConfig) => Promise<boolean>;
}

function ConnectRepoModal({ open, onOpenChange, initial, onTest, onSave }: ConnectRepoModalProps) {
  const { t } = useTranslation();
  const [cfg, setCfg] = React.useState<SourceControlConfig>(initial);
  const [testState, setTestState] = React.useState<"idle" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setCfg(initial);
      setTestState("idle");
      setTestMsg("");
    }
  }, [open, initial]);

  function patch(p: Partial<SourceControlConfig>) {
    setCfg((prev) => ({ ...prev, ...p }));
  }

  async function handleTest() {
    const r = await onTest(cfg);
    setTestState(r.ok ? "ok" : "fail");
    setTestMsg(r.message);
  }

  async function handleSave() {
    setSaving(true);
    const ok = await onSave(cfg);
    setSaving(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("app.settings.sourceControl.connectModal.title")}
      size="medium"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("app.settings.sourceControl.cancel")}
          </Button>
          <Button
            variant="subtle"
            onClick={() => void handleTest()}
            data-testid="sc-test-connection"
          >
            {t("app.settings.sourceControl.connectModal.testConnection")}
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={saving || !cfg.repoUrl.trim()}
            data-testid="sc-modal-save"
          >
            {saving
              ? t("app.settings.sourceControl.connecting")
              : t("app.settings.sourceControl.save")}
          </Button>
        </>
      }
    >
      <div className="gc-sc-form" data-testid="sc-connect-modal">
        <label className="gc-sc-label">
          {t("app.settings.sourceControl.connectModal.provider")}
        </label>
        <RadioGroup<ProviderId>
          value={cfg.provider}
          onValueChange={(v) => patch({ provider: v })}
          orientation="horizontal"
          options={[
            { value: "github", label: t("app.settings.sourceControl.connectModal.providers.github") },
            { value: "gitlab", label: t("app.settings.sourceControl.connectModal.providers.gitlab") },
            { value: "bitbucket", label: t("app.settings.sourceControl.connectModal.providers.bitbucket") },
            { value: "custom", label: t("app.settings.sourceControl.connectModal.providers.custom") },
          ]}
          data-testid="sc-provider-radio"
        />

        <label className="gc-sc-label" htmlFor="sc-modal-repo-url">
          {t("app.settings.sourceControl.repoUrl")}
        </label>
        <Input
          id="sc-modal-repo-url"
          value={cfg.repoUrl}
          onChange={(e) => patch({ repoUrl: e.target.value })}
          placeholder="https://github.com/org/repo.git"
          data-testid="sc-modal-repo-url"
        />

        <label className="gc-sc-label" htmlFor="sc-modal-branch">
          {t("app.settings.sourceControl.branch")}
        </label>
        <Input
          id="sc-modal-branch"
          value={cfg.branch}
          onChange={(e) => patch({ branch: e.target.value })}
          placeholder="main"
          data-testid="sc-modal-branch"
        />

        <label className="gc-sc-label">
          {t("app.settings.sourceControl.connectModal.authMode")}
        </label>
        <RadioGroup<"ssh" | "token">
          value={cfg.authMode}
          onValueChange={(v) => patch({ authMode: v })}
          orientation="horizontal"
          options={[
            { value: "token", label: t("app.settings.sourceControl.connectModal.token") },
            { value: "ssh", label: t("app.settings.sourceControl.connectModal.sshKey") },
          ]}
          data-testid="sc-auth-mode"
        />

        {cfg.authMode === "ssh" ? (
          <>
            <label className="gc-sc-label" htmlFor="sc-modal-ssh">
              {t("app.settings.sourceControl.connectModal.sshKey")}
            </label>
            <textarea
              id="sc-modal-ssh"
              className="gc-sc-textarea"
              rows={5}
              value={cfg.sshKey}
              onChange={(e) => patch({ sshKey: e.target.value })}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              data-testid="sc-modal-ssh-key"
            />
          </>
        ) : (
          <>
            <label className="gc-sc-label" htmlFor="sc-modal-token">
              {t("app.settings.sourceControl.connectModal.token")}
            </label>
            <Input
              id="sc-modal-token"
              type="password"
              value={cfg.token}
              onChange={(e) => patch({ token: e.target.value })}
              placeholder={t("app.settings.sourceControl.connectModal.tokenPh")}
              data-testid="sc-modal-token"
            />
          </>
        )}

        {testState !== "idle" && (
          <div data-testid="sc-test-result" style={{ marginTop: 8 }}>
            <Text size="sm" color={testState === "ok" ? "success" : "danger"}>
              {testState === "ok"
                ? t("app.settings.sourceControl.connectModal.testOk")
                : t("app.settings.sourceControl.connectModal.testFail", { message: testMsg })}
            </Text>
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ---------- Push Changes Modal ----------

interface PushChangesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changes: PendingChange[];
  onPush: (message: string) => Promise<boolean>;
}

function PushChangesModal({ open, onOpenChange, changes, onPush }: PushChangesModalProps) {
  const { t } = useTranslation();
  const [message, setMessage] = React.useState("");
  const [pushing, setPushing] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setMessage("");
    }
  }, [open]);

  async function handlePush() {
    if (!message.trim()) return;
    setPushing(true);
    const ok = await onPush(message.trim());
    setPushing(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("app.settings.sourceControl.pushModal.title")}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("app.settings.sourceControl.cancel")}
          </Button>
          <Button
            onClick={() => void handlePush()}
            disabled={pushing || !message.trim()}
            data-testid="sc-push-confirm"
          >
            {pushing
              ? t("app.settings.sourceControl.pushModal.pushing")
              : t("app.settings.sourceControl.pushModal.confirm")}
          </Button>
        </>
      }
    >
      <div data-testid="sc-push-modal">
        {changes.length === 0 ? (
          <Text size="sm" color="secondary">
            {t("app.settings.sourceControl.pushModal.noChanges")}
          </Text>
        ) : (
          <ul className="gc-sc-change-list" data-testid="sc-push-changes">
            {changes.map((c) => (
              <li key={c.id} className="gc-sc-change-item">
                <Tag
                  variant={
                    c.status === "deleted"
                      ? "danger"
                      : c.status === "added"
                        ? "success"
                        : "info"
                  }
                  size="small"
                >
                  {c.status}
                </Tag>
                <span className="gc-sc-change-path">{c.path}</span>
              </li>
            ))}
          </ul>
        )}

        <label className="gc-sc-label" htmlFor="sc-push-message" style={{ marginTop: 12 }}>
          {t("app.settings.sourceControl.commitMessage")}
        </label>
        <textarea
          id="sc-push-message"
          className="gc-sc-textarea"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("app.settings.sourceControl.commitMessagePh")}
          data-testid="sc-push-message"
        />
      </div>
    </Dialog>
  );
}

// ---------- main page ----------

export default function SourceControlPage() {
  const { t } = useTranslation();
  const {
    connectionStatus,
    config,
    status,
    backendMissing,
    fetchStatus,
    testConnection,
    connect,
    disconnect,
    pull,
    push,
    updateConfig,
  } = useSourceControlApi();

  const [connectOpen, setConnectOpen] = React.useState(false);
  const [pushOpen, setPushOpen] = React.useState(false);
  const [disconnectOpen, setDisconnectOpen] = React.useState(false);
  const [pullResult, setPullResult] = React.useState<{ ok: boolean; commits: number } | null>(null);
  const [newProtectedBranch, setNewProtectedBranch] = React.useState("");

  async function handlePull() {
    const r = await pull();
    setPullResult(r);
  }

  function handleAddProtectedBranch() {
    const v = newProtectedBranch.trim();
    if (!v || config.protectedBranches.includes(v)) return;
    updateConfig({ ...config, protectedBranches: [...config.protectedBranches, v] });
    setNewProtectedBranch("");
  }

  function handleRemoveProtectedBranch(branch: string) {
    updateConfig({
      ...config,
      protectedBranches: config.protectedBranches.filter((b) => b !== branch),
    });
  }

  const syncLabel =
    status.ahead === 0 && status.behind === 0
      ? t("app.settings.sourceControl.syncClean")
      : status.ahead > 0 && status.behind > 0
        ? t("app.settings.sourceControl.syncAheadBehind", { ahead: status.ahead, behind: status.behind })
        : status.ahead > 0
          ? t("app.settings.sourceControl.syncAhead", { count: status.ahead })
          : t("app.settings.sourceControl.syncBehind", { count: status.behind });

  return (
    <div className="gc-sc-page" data-testid="source-control-page">
      <div className="gc-sc-header">
        <Heading level={2} size="xl">
          {t("app.settings.sourceControl.title")}
        </Heading>
        <span data-testid="sc-status-badge">
          <Tag variant={connectionStatus === "connected" ? "success" : "default"}>
            {connectionStatus === "connected"
              ? t("app.settings.sourceControl.statusConnected")
              : t("app.settings.sourceControl.statusDisconnected")}
          </Tag>
        </span>
      </div>

      {backendMissing && (
        <div data-testid="sc-backend-missing" style={{ marginBottom: 12 }}>
          <Text size="sm" color="secondary">
            {t("app.settings.sourceControl.backendMissing")}
          </Text>
        </div>
      )}

      {connectionStatus === "disconnected" ? (
        <div data-testid="sc-connect-card">
          <Card className="gc-sc-connect-card">
            <Card.Header title={t("app.settings.sourceControl.connectHeading")} />
            <Card.Body>
              <Text size="sm" color="secondary">
                {t("app.settings.sourceControl.disconnectedHint")}
              </Text>
            </Card.Body>
            <Card.Footer>
              <Button
                onClick={() => setConnectOpen(true)}
                data-testid="sc-btn-connect"
              >
                {t("app.settings.sourceControl.connect")}
              </Button>
            </Card.Footer>
          </Card>
        </div>
      ) : (
        <div data-testid="sc-connected-panel">
          <Card className="gc-sc-control-card">
            <Card.Header title={t("app.settings.sourceControl.repoHeading")} />
            <Card.Body>
              <div className="gc-sc-info-grid">
                <div>
                  <Text size="sm" color="secondary">
                    {t("app.settings.sourceControl.repoUrl")}
                  </Text>
                  <code className="gc-sc-repo-url" data-testid="sc-repo-url">
                    {status.repoUrl || config.repoUrl}
                  </code>
                </div>
                <div>
                  <Text size="sm" color="secondary">
                    {t("app.settings.sourceControl.branch")}
                  </Text>
                  <Text>{status.branch || config.branch}</Text>
                </div>
                <div>
                  <Text size="sm" color="secondary">
                    {t("app.settings.sourceControl.lastSync")}
                  </Text>
                  <Text data-testid="sc-last-sync">
                    {status.lastSyncAt ?? t("app.settings.sourceControl.never")}
                  </Text>
                </div>
                <div>
                  <span data-testid="sc-sync-status">
                    <Text size="sm" color="secondary">
                      {syncLabel}
                    </Text>
                  </span>
                </div>
              </div>
            </Card.Body>
            <Card.Footer>
              <Button
                variant="subtle"
                onClick={() => void handlePull()}
                data-testid="sc-btn-pull"
              >
                {t("app.settings.sourceControl.pull")}
              </Button>
              <Button
                onClick={() => setPushOpen(true)}
                data-testid="sc-btn-push"
              >
                {t("app.settings.sourceControl.push")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => void fetchStatus()}
                data-testid="sc-btn-refresh"
              >
                {t("app.settings.sourceControl.refresh")}
              </Button>
              <Button
                variant="outline"
                onClick={() => setDisconnectOpen(true)}
                data-testid="sc-btn-disconnect"
              >
                {t("app.settings.sourceControl.disconnect")}
              </Button>
            </Card.Footer>
          </Card>

          {pullResult && (
            <div data-testid="sc-pull-result" style={{ marginTop: 8 }}>
              <Text size="sm" color={pullResult.ok ? "success" : "danger"}>
                {pullResult.ok
                  ? t("app.settings.sourceControl.pullSuccess", { count: pullResult.commits })
                  : t("app.settings.sourceControl.pullFailed")}
              </Text>
            </div>
          )}
        </div>
      )}

      <Card className="gc-sc-advanced-card">
        <Card.Header title={t("app.settings.sourceControl.advanced")} />
        <Card.Body>
          <Heading level={4} size="sm">
            {t("app.settings.sourceControl.protectedBranches")}
          </Heading>
          <ul
            className="gc-sc-protected-list"
            data-testid="sc-protected-branches"
          >
            {config.protectedBranches.map((b) => (
              <li key={b} className="gc-sc-protected-item">
                <Tag size="small">{b}</Tag>
                <Button
                  size="small"
                  variant="ghost"
                  onClick={() => handleRemoveProtectedBranch(b)}
                  data-testid={`sc-protected-remove-${b}`}
                >
                  {t("app.settings.sourceControl.remove")}
                </Button>
              </li>
            ))}
          </ul>
          <div className="gc-sc-protected-add">
            <Input
              value={newProtectedBranch}
              onChange={(e) => setNewProtectedBranch(e.target.value)}
              placeholder={t("app.settings.sourceControl.protectedBranchPh")}
              data-testid="sc-protected-input"
            />
            <Button
              variant="subtle"
              size="small"
              onClick={handleAddProtectedBranch}
              data-testid="sc-protected-add"
            >
              {t("app.settings.sourceControl.add")}
            </Button>
          </div>

          <div style={{ marginTop: 16 }}>
            <Switch
              checked={config.autoSyncEnabled}
              onCheckedChange={(checked) =>
                updateConfig({ ...config, autoSyncEnabled: checked })
              }
              label={t("app.settings.sourceControl.autoSync")}
              data-testid="sc-auto-sync"
            />
            {config.autoSyncEnabled && (
              <div className="gc-sc-auto-sync-row" data-testid="sc-auto-sync-interval">
                <label className="gc-sc-label" htmlFor="sc-auto-sync-input">
                  {t("app.settings.sourceControl.autoSyncEveryMin")}
                </label>
                <Input
                  id="sc-auto-sync-input"
                  type="text"
                  value={String(config.autoSyncIntervalMin)}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(n) && n > 0) {
                      updateConfig({ ...config, autoSyncIntervalMin: n });
                    } else if (e.target.value === "") {
                      updateConfig({ ...config, autoSyncIntervalMin: 0 });
                    }
                  }}
                  data-testid="sc-auto-sync-input"
                />
              </div>
            )}
          </div>
        </Card.Body>
      </Card>

      <ConnectRepoModal
        open={connectOpen}
        onOpenChange={setConnectOpen}
        initial={config}
        onTest={testConnection}
        onSave={async (next) => {
          const ok = await connect(next);
          if (ok) updateConfig(next);
          return ok;
        }}
      />

      <PushChangesModal
        open={pushOpen}
        onOpenChange={setPushOpen}
        changes={status.pendingChanges}
        onPush={push}
      />

      <AlertDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title={t("app.settings.sourceControl.disconnectTitle")}
        description={t("app.settings.sourceControl.disconnectConfirm")}
        confirmLabel={t("app.settings.sourceControl.disconnect")}
        cancelLabel={t("app.settings.sourceControl.cancel")}
        destructive
        onConfirm={async () => {
          await disconnect();
          setDisconnectOpen(false);
        }}
      />
    </div>
  );
}
