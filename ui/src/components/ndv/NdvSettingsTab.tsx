// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  defaultRetryOnFail,
  NDV_RETRY_MAX,
  NDV_RETRY_MIN,
  normalizeNodeSettings,
  normalizeRetryOnFail,
  type NdvNode,
  type NdvNodeSettings,
  type NdvOnErrorMode,
  type NdvRetryOnFail,
} from "./ndvTypes";
import { NdvVersionSelector } from "./NdvVersionSelector";
import { getVersions } from "../../graph/nodeRegistry";

export type NdvSettingsTabProps = {
  node: NdvNode;
  onApplyNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
};

export function NdvSettingsTab({ node, onApplyNodeData }: NdvSettingsTabProps): JSX.Element {
  const { t } = useTranslation();
  const settings = useMemo<NdvNodeSettings>(
    () => normalizeNodeSettings(node.data.settings),
    [node.data.settings],
  );

  const note = typeof node.data.note === "string" ? node.data.note : "";

  const applySettings = useCallback(
    (patch: Partial<NdvNodeSettings>) => {
      const next: NdvNodeSettings = { ...settings, ...patch };
      onApplyNodeData(node.id, { settings: next });
    },
    [node.id, onApplyNodeData, settings],
  );

  const onNoteChange = useCallback(
    (ev: React.ChangeEvent<HTMLTextAreaElement>) => {
      onApplyNodeData(node.id, { note: ev.target.value });
    },
    [node.id, onApplyNodeData],
  );

  const retry: NdvRetryOnFail = settings.retryOnFail ?? defaultRetryOnFail();
  const onError: NdvOnErrorMode = settings.onError ?? "stop";

  const versionList = getVersions(node.type);
  const currentVersion =
    typeof (node.data as { typeVersion?: unknown }).typeVersion === "number"
      ? ((node.data as { typeVersion?: number }).typeVersion as number)
      : 1;

  const onVersionChange = (next: number) => {
    onApplyNodeData(node.id, { typeVersion: next });
  };

  return (
    <div className="gc-ndv-settings" data-testid="gc-ndv-settings">
      {versionList.length > 1 && (
        <section
          className="gc-ndv-settings__section"
          data-testid="gc-ndv-settings-version"
        >
          <NdvVersionSelector
            nodeType={node.type}
            currentVersion={currentVersion}
            onChange={onVersionChange}
          />
        </section>
      )}

      <section className="gc-ndv-settings__section" data-testid="gc-ndv-settings-notes">
        <label className="gc-ndv-settings__label" htmlFor={`gc-ndv-notes-${node.id}`}>
          {t("ndv.notes.label")}
        </label>
        <textarea
          id={`gc-ndv-notes-${node.id}`}
          className="gc-ndv-settings__textarea"
          value={note}
          onChange={onNoteChange}
          rows={3}
          placeholder={t("ndv.notes.placeholder")}
          data-testid="gc-ndv-notes-textarea"
        />
        <p className="gc-ndv-settings__hint">{t("ndv.notes.hint")}</p>
      </section>

      <section className="gc-ndv-settings__section" data-testid="gc-ndv-settings-always-output">
        <label className="gc-ndv-settings__switch">
          <input
            type="checkbox"
            checked={settings.alwaysOutputData === true}
            onChange={(ev) => applySettings({ alwaysOutputData: ev.target.checked })}
            data-testid="gc-ndv-always-output-switch"
          />
          <span>{t("ndv.settings.alwaysOutputData.label")}</span>
        </label>
        <p className="gc-ndv-settings__hint">{t("ndv.settings.alwaysOutputData.hint")}</p>
      </section>

      <section className="gc-ndv-settings__section" data-testid="gc-ndv-settings-execute-once">
        <label className="gc-ndv-settings__switch">
          <input
            type="checkbox"
            checked={settings.executeOnce === true}
            onChange={(ev) => applySettings({ executeOnce: ev.target.checked })}
            data-testid="gc-ndv-execute-once-switch"
          />
          <span>{t("ndv.settings.executeOnce.label")}</span>
        </label>
        <p className="gc-ndv-settings__hint">{t("ndv.settings.executeOnce.hint")}</p>
      </section>

      <section className="gc-ndv-settings__section" data-testid="gc-ndv-settings-retry">
        <label className="gc-ndv-settings__switch">
          <input
            type="checkbox"
            checked={retry.enabled}
            onChange={(ev) =>
              applySettings({
                retryOnFail: normalizeRetryOnFail({ ...retry, enabled: ev.target.checked }),
              })
            }
            data-testid="gc-ndv-retry-switch"
          />
          <span>{t("ndv.settings.retryOnFail.label")}</span>
        </label>
        <p className="gc-ndv-settings__hint">{t("ndv.settings.retryOnFail.hint")}</p>
        {retry.enabled ? (
          <div className="gc-ndv-settings__retry-fields" data-testid="gc-ndv-retry-fields">
            <label className="gc-ndv-settings__field">
              <span>{t("ndv.settings.retryOnFail.maxTries")}</span>
              <input
                type="number"
                min={NDV_RETRY_MIN}
                max={NDV_RETRY_MAX}
                value={retry.maxTries}
                onChange={(ev) =>
                  applySettings({
                    retryOnFail: normalizeRetryOnFail({
                      ...retry,
                      maxTries: Number(ev.target.value),
                    }),
                  })
                }
                data-testid="gc-ndv-retry-max-tries"
              />
            </label>
            <label className="gc-ndv-settings__field">
              <span>{t("ndv.settings.retryOnFail.waitMs")}</span>
              <input
                type="number"
                min={0}
                value={retry.waitMs}
                onChange={(ev) =>
                  applySettings({
                    retryOnFail: normalizeRetryOnFail({
                      ...retry,
                      waitMs: Number(ev.target.value),
                    }),
                  })
                }
                data-testid="gc-ndv-retry-wait-ms"
              />
            </label>
          </div>
        ) : null}
      </section>

      <section className="gc-ndv-settings__section" data-testid="gc-ndv-settings-on-error">
        <span className="gc-ndv-settings__label">{t("ndv.settings.onError.label")}</span>
        <label className="gc-ndv-settings__radio">
          <input
            type="radio"
            name={`gc-ndv-on-error-${node.id}`}
            value="stop"
            checked={onError === "stop"}
            onChange={() => applySettings({ onError: "stop" })}
            data-testid="gc-ndv-on-error-stop"
          />
          <span>{t("ndv.settings.onError.stop")}</span>
        </label>
        <label className="gc-ndv-settings__radio">
          <input
            type="radio"
            name={`gc-ndv-on-error-${node.id}`}
            value="continue"
            checked={onError === "continue"}
            onChange={() => applySettings({ onError: "continue" })}
            data-testid="gc-ndv-on-error-continue"
          />
          <span>{t("ndv.settings.onError.continue")}</span>
        </label>
      </section>
    </div>
  );
}
