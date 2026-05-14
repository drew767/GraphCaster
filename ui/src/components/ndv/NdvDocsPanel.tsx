// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchNodeDocs, type FetchNodeDocsOptions } from "../../api/nodeDocs";
import { SimpleMarkdown } from "./markdown/simpleMarkdown";
import type { NdvNode } from "./ndvTypes";

export type NdvDocsPanelProps = {
  node: NdvNode;
  open: boolean;
  onClose: () => void;
  /** Test seam — overrides the default fetch implementation. */
  fetchOptions?: FetchNodeDocsOptions;
};

export function NdvDocsPanel({ node, open, onClose, fetchOptions }: NdvDocsPanelProps): JSX.Element | null {
  const { t } = useTranslation();
  const [markdown, setMarkdown] = useState<string | null>(node.docsMarkdown ?? null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    if (!open) return undefined;
    if (typeof node.docsMarkdown === "string" && node.docsMarkdown.length > 0) {
      setMarkdown(node.docsMarkdown);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    fetchNodeDocs(node.type, fetchOptions)
      .then((res) => {
        if (cancelled) return;
        setMarkdown(res.markdown);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setMarkdown(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, node.type, node.docsMarkdown, fetchOptions]);

  if (!open) return null;

  return (
    <aside
      className="gc-ndv-docs-panel"
      data-testid="gc-ndv-docs-panel"
      style={{ width: 320, flex: "0 0 320px" }}
      aria-label={t("ndv.docs.ariaLabel")}
    >
      <header className="gc-ndv-docs-panel__header">
        <span className="gc-ndv-docs-panel__title">{t("ndv.docs.title")}</span>
        <button
          type="button"
          className="gc-ndv-docs-panel__close"
          onClick={onClose}
          aria-label={t("ndv.docs.close")}
        >
          ×
        </button>
      </header>
      <div className="gc-ndv-docs-panel__body" data-testid="gc-ndv-docs-panel-body">
        {loading ? (
          <p className="gc-ndv-docs-panel__loading">{t("ndv.docs.loading")}</p>
        ) : typeof markdown === "string" && markdown.length > 0 ? (
          <SimpleMarkdown source={markdown} />
        ) : (
          <p className="gc-ndv-docs-panel__empty">{t("ndv.docs.empty")}</p>
        )}
      </div>
    </aside>
  );
}
