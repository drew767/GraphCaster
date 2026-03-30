// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { gcReadPersistedRunSummary } from "../../run/runCommands";

type Props = {
  artifactsBase: string;
  graphId: string;
  runDirName: string;
};

export function RunArtifactPanel({ artifactsBase, graphId, runDirName }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const ab = artifactsBase.trim();
    const gid = graphId.trim();
    const rd = runDirName.trim();
    if (!ab || !gid || !rd) {
      setSummary(null);
      setLoadError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void gcReadPersistedRunSummary(ab, gid, rd)
      .then((text) => {
        if (!cancelled) {
          setSummary(text);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadError(String(e));
          setSummary(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [artifactsBase, graphId, runDirName]);

  if (loading) {
    return <p className="gc-modal-hint">{t("app.runHistory.loading")}</p>;
  }

  if (loadError != null) {
    return <p className="gc-modal-hint gc-modal-hint--error">{loadError}</p>;
  }

  if (summary == null || summary.trim() === "") {
    return (
      <div className="gc-run-history-artifacts">
        <p className="gc-modal-hint">{t("app.runHistory.artifactsNoSummary")}</p>
        <ul className="gc-run-history-artifacts-list">
          <li>
            <code>events.ndjson</code> — {t("app.runHistory.artifactsEventsHint")}
          </li>
          <li>
            <code>run-summary.json</code> — {t("app.runHistory.artifactsSummaryHint")}
          </li>
        </ul>
      </div>
    );
  }

  let formatted = summary;
  try {
    formatted = JSON.stringify(JSON.parse(summary), null, 2);
  } catch {
    /* keep raw */
  }

  return (
    <div className="gc-run-history-artifacts">
      <p className="gc-run-history-artifacts-caption">{t("app.runHistory.artifactsSummaryCaption")}</p>
      <pre className="gc-run-history-artifacts-pre" tabIndex={0}>
        {formatted}
      </pre>
    </div>
  );
}
