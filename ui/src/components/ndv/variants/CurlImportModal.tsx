// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "../../ui/Dialog/Dialog";
import { Button } from "../../ui/Button/Button";
import { parseCurl, type CurlParseResult } from "../../../utils/curlParser";

export interface CurlImportPatch {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface CurlImportModalProps {
  open: boolean;
  onClose: () => void;
  onApplyNodeData: (patch: { parameters: CurlImportPatch }) => void;
  initialValue?: string;
  "data-testid"?: string;
}

export function curlResultToPatch(result: CurlParseResult): CurlImportPatch {
  const patch: CurlImportPatch = {
    url: result.url,
    method: result.method,
    headers: { ...result.headers },
  };
  if (result.body !== undefined) {
    patch.body = result.body;
  }
  return patch;
}

export function CurlImportModal({
  open,
  onClose,
  onApplyNodeData,
  initialValue = "",
  "data-testid": testId,
}: CurlImportModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string>(initialValue);
  const [error, setError] = useState<string | null>(null);

  const handleImport = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError(t("ndv.curlImport.errorEmpty"));
      return;
    }
    try {
      const parsed = parseCurl(trimmed);
      const patch = curlResultToPatch(parsed);
      onApplyNodeData({ parameters: patch });
      setError(null);
      setDraft("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [draft, onApplyNodeData, onClose, t]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      size="large"
      title={t("ndv.curlImport.title")}
      description={t("ndv.curlImport.description")}
      footer={
        <>
          <Button
            variant="ghost"
            size="small"
            onClick={onClose}
            data-testid="curl-import-cancel"
          >
            {t("ndv.curlImport.cancel")}
          </Button>
          <Button
            variant="solid"
            size="small"
            onClick={handleImport}
            data-testid="curl-import-submit"
          >
            {t("ndv.curlImport.import")}
          </Button>
        </>
      }
      ariaLabel={t("ndv.curlImport.title")}
    >
      <div className="gc-curl-import" data-testid={testId ?? "curl-import-modal"}>
        <label htmlFor="gc-curl-import-textarea" className="gc-curl-import__label">
          {t("ndv.curlImport.fieldLabel")}
        </label>
        <textarea
          id="gc-curl-import-textarea"
          className="gc-curl-import__textarea"
          rows={10}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("ndv.curlImport.placeholder")}
          aria-label={t("ndv.curlImport.fieldLabel")}
          data-testid="curl-import-textarea"
        />
        {error && (
          <div
            className="gc-curl-import__error"
            role="alert"
            data-testid="curl-import-error"
          >
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function isHttpRequestNodeType(type: string): boolean {
  return type === "http_request";
}
