// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  workflowsApi,
  type WorkflowSettingsPayload,
  type WorkflowSummary,
} from "../../lib/workflowsApi";

type TabId = "general" | "execution" | "errorWorkflow" | "callerPolicy";

export interface WorkflowSettingsModalProps {
  open: boolean;
  workflowId: string | null;
  onClose: () => void;
  initialSettings?: WorkflowSettingsPayload;
  availableWorkflows?: WorkflowSummary[];
  api?: typeof workflowsApi;
}

const DEFAULT_SETTINGS: WorkflowSettingsPayload = {
  description: "",
  tags: [],
  timezone: "UTC",
  saveManualExecutions: true,
  saveSuccessData: true,
  saveErrorData: true,
  saveDataOnFailure: true,
  errorWorkflowId: null,
  callerPolicy: "workspace",
  callerPolicyWorkflowIds: [],
};

const TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Moscow",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Asia/Shanghai",
];

export function WorkflowSettingsModal(props: WorkflowSettingsModalProps) {
  const { open, workflowId, onClose, initialSettings, availableWorkflows, api } = props;
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>("general");
  const [settings, setSettings] = useState<WorkflowSettingsPayload>({
    ...DEFAULT_SETTINGS,
    ...initialSettings,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSettings({ ...DEFAULT_SETTINGS, ...initialSettings });
      setTab("general");
    }
  }, [open, initialSettings]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !workflowId) return null;

  const onBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await (api ?? workflowsApi).updateSettings(workflowId, settings);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const update = (patch: Partial<WorkflowSettingsPayload>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  return (
    <div className="gc-modal-backdrop" role="presentation" onClick={onBackdrop}>
      <div
        className="gc-modal gc-workflow-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gc-workflow-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="gc-workflow-settings-title" className="gc-modal-title">
          {t("workflowSettings.title")}
        </h2>
        <div className="gc-tabs" role="tablist" aria-label={t("workflowSettings.tabsAria")}>
          {(
            [
              ["general", "workflowSettings.tabGeneral"],
              ["execution", "workflowSettings.tabExecution"],
              ["errorWorkflow", "workflowSettings.tabErrorWorkflow"],
              ["callerPolicy", "workflowSettings.tabCallerPolicy"],
            ] as Array<[TabId, string]>
          ).map(([id, key]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`gc-tab ${tab === id ? "gc-tab--active" : ""}`}
              onClick={() => setTab(id)}
              data-tab-id={id}
            >
              {t(key)}
            </button>
          ))}
        </div>

        <div className="gc-tab-panel" role="tabpanel">
          {tab === "general" ? (
            <div className="gc-form">
              <label className="gc-field">
                <span>{t("workflowSettings.description")}</span>
                <textarea
                  className="gc-textarea"
                  value={settings.description ?? ""}
                  onChange={(e) => update({ description: e.target.value })}
                />
              </label>
              <label className="gc-field">
                <span>{t("workflowSettings.tags")}</span>
                <input
                  type="text"
                  className="gc-input"
                  value={(settings.tags ?? []).join(", ")}
                  onChange={(e) =>
                    update({
                      tags: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder={t("workflowSettings.tagsPlaceholder")}
                />
              </label>
            </div>
          ) : null}

          {tab === "execution" ? (
            <div className="gc-form">
              <label className="gc-field">
                <span>{t("workflowSettings.timezone")}</span>
                <select
                  className="gc-select"
                  value={settings.timezone ?? "UTC"}
                  onChange={(e) => update({ timezone: e.target.value })}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gc-field gc-field--switch">
                <input
                  type="checkbox"
                  checked={settings.saveManualExecutions ?? true}
                  onChange={(e) => update({ saveManualExecutions: e.target.checked })}
                />
                <span>{t("workflowSettings.saveManualExecutions")}</span>
              </label>
              <label className="gc-field gc-field--switch">
                <input
                  type="checkbox"
                  checked={settings.saveSuccessData ?? true}
                  onChange={(e) => update({ saveSuccessData: e.target.checked })}
                />
                <span>{t("workflowSettings.saveSuccessData")}</span>
              </label>
              <label className="gc-field gc-field--switch">
                <input
                  type="checkbox"
                  checked={settings.saveErrorData ?? true}
                  onChange={(e) => update({ saveErrorData: e.target.checked })}
                />
                <span>{t("workflowSettings.saveErrorData")}</span>
              </label>
              <label className="gc-field gc-field--switch">
                <input
                  type="checkbox"
                  checked={settings.saveDataOnFailure ?? true}
                  onChange={(e) => update({ saveDataOnFailure: e.target.checked })}
                />
                <span>{t("workflowSettings.saveDataOnFailure")}</span>
              </label>
            </div>
          ) : null}

          {tab === "errorWorkflow" ? (
            <div className="gc-form">
              <label className="gc-field">
                <span>{t("workflowSettings.errorWorkflow")}</span>
                <select
                  className="gc-select"
                  value={settings.errorWorkflowId ?? ""}
                  onChange={(e) =>
                    update({ errorWorkflowId: e.target.value === "" ? null : e.target.value })
                  }
                >
                  <option value="">{t("workflowSettings.errorWorkflowNone")}</option>
                  {(availableWorkflows ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          {tab === "callerPolicy" ? (
            <div className="gc-form">
              <fieldset className="gc-fieldset">
                <legend>{t("workflowSettings.callerPolicyLegend")}</legend>
                {(
                  [
                    ["any", "workflowSettings.callerAny"],
                    ["workspace", "workflowSettings.callerWorkspace"],
                    ["specific", "workflowSettings.callerSpecific"],
                  ] as Array<[NonNullable<WorkflowSettingsPayload["callerPolicy"]>, string]>
                ).map(([value, key]) => (
                  <label key={value} className="gc-field gc-field--radio">
                    <input
                      type="radio"
                      name="gc-caller-policy"
                      value={value}
                      checked={(settings.callerPolicy ?? "workspace") === value}
                      onChange={() => update({ callerPolicy: value })}
                    />
                    <span>{t(key)}</span>
                  </label>
                ))}
              </fieldset>
            </div>
          ) : null}
        </div>

        <div className="gc-modal-actions">
          <button type="button" className="gc-btn" onClick={onClose} disabled={saving}>
            {t("workflowSettings.cancel")}
          </button>
          <button
            type="button"
            className="gc-btn gc-btn-primary"
            onClick={onSave}
            disabled={saving}
          >
            {t("workflowSettings.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
