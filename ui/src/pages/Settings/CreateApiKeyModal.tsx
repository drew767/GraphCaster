// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Checkbox, Dialog, Input, Tag } from "../../components/ui";
import { useUIStore } from "../../app/stores/uiStore";
import type { CreateApiKeyResult } from "../../hooks/useApiKeysData";

export const API_KEY_CREATE_MODAL = "api-key-create";

// Backend scopes (grouped). The page passes selected ones to the API.
const SCOPE_GROUPS: Array<{ id: string; scopes: string[] }> = [
  {
    id: "workflow",
    scopes: ["workflow:read", "workflow:write"],
  },
  {
    id: "credential",
    scopes: ["credential:read", "credential:write"],
  },
  {
    id: "user",
    scopes: ["user:read", "user:invite"],
  },
  {
    id: "admin",
    scopes: ["admin"],
  },
  {
    id: "project",
    scopes: ["project:read", "project:write"],
  },
  {
    id: "source_control",
    scopes: ["source_control:read", "source_control:write"],
  },
];

const ALL_SCOPES = SCOPE_GROUPS.flatMap((g) => g.scopes);

/** The modal calls this with label+scopes; the caller does the API request and returns the result. */
interface CreateApiKeyModalProps {
  onCreate: (label: string, scopes: string[]) => Promise<CreateApiKeyResult>;
}

export function CreateApiKeyModal({ onCreate }: CreateApiKeyModalProps) {
  const { t } = useTranslation();
  const isOpen = useUIStore((s) => s.isModalOpen(API_KEY_CREATE_MODAL));
  const closeModal = useUIStore((s) => s.closeModal);

  const [label, setLabel] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = useCallback(() => {
    setLabel("");
    setSelectedScopes(new Set());
    setLoading(false);
    setError(null);
    setCreatedKey(null);
    setCopied(false);
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        closeModal(API_KEY_CREATE_MODAL);
        reset();
      }
    },
    [closeModal, reset],
  );

  const toggleScope = useCallback((scope: string) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  }, []);

  const groupStateById = useMemo(() => {
    const map = new Map<string, { selected: number; total: number }>();
    for (const g of SCOPE_GROUPS) {
      let selected = 0;
      for (const s of g.scopes) {
        if (selectedScopes.has(s)) selected++;
      }
      map.set(g.id, { selected, total: g.scopes.length });
    }
    return map;
  }, [selectedScopes]);

  const toggleGroup = useCallback(
    (groupId: string) => {
      const group = SCOPE_GROUPS.find((g) => g.id === groupId);
      if (!group) return;
      setSelectedScopes((prev) => {
        const next = new Set(prev);
        const allSelected = group.scopes.every((s) => next.has(s));
        if (allSelected) {
          for (const s of group.scopes) next.delete(s);
        } else {
          for (const s of group.scopes) next.add(s);
        }
        return next;
      });
    },
    [],
  );

  const handleCreate = useCallback(async () => {
    if (label.trim() === "") {
      setError(t("app.settings.apiKeys.modal.errorLabelRequired"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await onCreate(label.trim(), [...selectedScopes]);
      setCreatedKey(result.rawKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [label, selectedScopes, onCreate, t]);

  const handleCopy = useCallback(() => {
    if (!createdKey) return;
    void navigator.clipboard.writeText(createdKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [createdKey]);

  const selectedCount = selectedScopes.size;

  const footer = createdKey ? (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
      <Button variant="ghost" onClick={() => handleOpenChange(false)}>
        {t("app.settings.apiKeys.modal.close")}
      </Button>
    </div>
  ) : (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
      <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={loading}>
        {t("app.settings.apiKeys.modal.cancel")}
      </Button>
      <Button
        variant="solid"
        onClick={handleCreate}
        loading={loading}
        disabled={label.trim() === "" || selectedScopes.size === 0}
        data-testid="modal-create-btn"
      >
        {t("app.settings.apiKeys.modal.create")}
      </Button>
    </div>
  );

  return (
    <Dialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      title={t("app.settings.apiKeys.modal.title")}
      size="medium"
      footer={footer}
    >
      {createdKey ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="created-key-section">
          <div
            role="alert"
            data-testid="copy-once-warning"
            style={{
              padding: "10px 12px",
              borderRadius: "var(--radius--3xs, 6px)",
              background: "rgba(255, 149, 0, 0.10)",
              border: "1px solid rgba(255, 149, 0, 0.30)",
              fontSize: 13,
              color: "var(--color--text, #1c1c1e)",
            }}
          >
            {t("app.settings.apiKeys.modal.oneTimeNotice")}
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              background: "var(--color--background--light-3, #eaeaef)",
              borderRadius: "var(--radius--3xs, 6px)",
              padding: "8px 12px",
              fontFamily: "monospace",
              fontSize: 13,
              wordBreak: "break-all",
            }}
            data-testid="modal-new-key"
          >
            <span style={{ flex: 1 }}>{createdKey}</span>
            <Button
              size="xsmall"
              variant="outline"
              onClick={handleCopy}
              iconLeft={copied ? "check" : "copy"}
              data-testid="modal-copy-key-btn"
            >
              {copied ? t("app.settings.apiKeys.modal.copied") : t("app.settings.apiKeys.modal.copy")}
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label
              htmlFor="api-key-label"
              style={{ fontSize: 13, fontWeight: 500, color: "var(--color--text, #1c1c1e)" }}
            >
              {t("app.settings.apiKeys.modal.labelField")}
            </label>
            <Input
              id="api-key-label"
              placeholder={t("app.settings.apiKeys.modal.labelPlaceholder")}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              data-testid="modal-label-input"
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--color--text, #1c1c1e)" }}>
                {t("app.settings.apiKeys.modal.scopesField")}
              </p>
              <span data-testid="scope-count">
                <Tag size="small" variant="default">
                  <span data-testid="scope-count-value">{selectedCount}</span>
                  {" "}
                  {t("app.settings.apiKeys.modal.scopesSelectedSuffix")}
                </Tag>
              </span>
            </div>

            <div data-testid="scope-list" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {SCOPE_GROUPS.map((group) => {
                const state = groupStateById.get(group.id) ?? { selected: 0, total: group.scopes.length };
                const groupChecked: boolean | "indeterminate" =
                  state.selected === 0
                    ? false
                    : state.selected === state.total
                    ? true
                    : "indeterminate";
                return (
                  <fieldset
                    key={group.id}
                    data-testid={`scope-group-${group.id}`}
                    style={{
                      border: "1px solid var(--color--background--light-3, #eaeaef)",
                      borderRadius: "var(--radius--3xs, 6px)",
                      padding: "10px 12px",
                      margin: 0,
                    }}
                  >
                    <legend style={{ padding: "0 4px" }}>
                      <Checkbox
                        checked={groupChecked}
                        onCheckedChange={() => toggleGroup(group.id)}
                        label={t(`app.settings.apiKeys.modal.scopeGroups.${group.id}`)}
                        data-testid={`scope-group-toggle-${group.id}`}
                      />
                    </legend>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 18 }}>
                      {group.scopes.map((scope) => (
                        <Checkbox
                          key={scope}
                          checked={selectedScopes.has(scope)}
                          onCheckedChange={() => toggleScope(scope)}
                          label={scope}
                          data-testid={`scope-${scope}`}
                        />
                      ))}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </div>

          {error && (
            <p style={{ margin: 0, color: "var(--gc-danger, #ff3b30)", fontSize: 13 }} role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

export { ALL_SCOPES };
