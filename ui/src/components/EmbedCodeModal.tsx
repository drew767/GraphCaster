// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export interface EmbedCodeModalProps {
  graphId: string;
  apiBase?: string;
  onClose: () => void;
}

type Theme = "light" | "dark";
type Position = "bottom-right" | "bottom-left";

export function EmbedCodeModal({ graphId, apiBase = "", onClose }: EmbedCodeModalProps) {
  const { t } = useTranslation();

  const [theme, setTheme] = useState<Theme>("light");
  const [position, setPosition] = useState<Position>("bottom-right");
  const [primaryColor, setPrimaryColor] = useState("#6366f1");
  const [welcomeMessage, setWelcomeMessage] = useState(
    t("app.embed.defaultWelcome", "How can I help?"),
  );
  const [copied, setCopied] = useState(false);

  const resolvedApiBase = apiBase || (typeof window !== "undefined" ? `${window.location.origin}/api/v1` : "/api/v1");

  const snippet = useMemo(
    () =>
      `<script src="${resolvedApiBase}/embed.js"></script>\n` +
      `<script>\n` +
      `  window.GraphCaster.init({\n` +
      `    graphId: '${graphId}',\n` +
      `    apiBase: '${resolvedApiBase}',\n` +
      `    theme: '${theme}',\n` +
      `    position: '${position}',\n` +
      `    primaryColor: '${primaryColor}',\n` +
      `    welcomeMessage: '${welcomeMessage.replace(/'/g, "\\'")}',\n` +
      `  });\n` +
      `</script>`,
    [graphId, resolvedApiBase, theme, position, primaryColor, welcomeMessage],
  );

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [snippet]);

  return (
    <div
      className="gc-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("app.embed.modalTitle", "Embed code")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="gc-modal gc-embed-modal">
        <div className="gc-modal-header">
          <h2 className="gc-modal-title">{t("app.embed.modalTitle", "Get embed code")}</h2>
          <button
            type="button"
            className="gc-modal-close"
            aria-label={t("app.modal.close", "Close")}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="gc-embed-modal__body">
          <div className="gc-embed-modal__options">
            <label className="gc-embed-modal__label">
              <span>{t("app.embed.theme", "Theme")}</span>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as Theme)}
                className="gc-embed-modal__select"
              >
                <option value="light">{t("app.embed.themeLight", "Light")}</option>
                <option value="dark">{t("app.embed.themeDark", "Dark")}</option>
              </select>
            </label>

            <label className="gc-embed-modal__label">
              <span>{t("app.embed.position", "Position")}</span>
              <select
                value={position}
                onChange={(e) => setPosition(e.target.value as Position)}
                className="gc-embed-modal__select"
              >
                <option value="bottom-right">{t("app.embed.posBottomRight", "Bottom right")}</option>
                <option value="bottom-left">{t("app.embed.posBottomLeft", "Bottom left")}</option>
              </select>
            </label>

            <label className="gc-embed-modal__label">
              <span>{t("app.embed.primaryColor", "Primary color")}</span>
              <div className="gc-embed-modal__color-row">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="gc-embed-modal__color-swatch"
                  aria-label={t("app.embed.primaryColor", "Primary color")}
                />
                <input
                  type="text"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="gc-embed-modal__text-input gc-embed-modal__color-text"
                  maxLength={7}
                  placeholder="#6366f1"
                  aria-label={t("app.embed.primaryColorHex", "Primary color hex")}
                />
              </div>
            </label>

            <label className="gc-embed-modal__label">
              <span>{t("app.embed.welcomeMessage", "Welcome message")}</span>
              <input
                type="text"
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                className="gc-embed-modal__text-input"
                placeholder={t("app.embed.defaultWelcome", "How can I help?")}
                maxLength={200}
              />
            </label>
          </div>

          <div className="gc-embed-modal__preview-row">
            <span className="gc-embed-modal__preview-label">
              {t("app.embed.bubblePreview", "Bubble preview")}
            </span>
            <div
              className="gc-embed-modal__bubble-preview"
              style={{
                backgroundColor: primaryColor,
              }}
              aria-hidden="true"
            >
              💬
            </div>
          </div>

          <div className="gc-embed-modal__snippet-area">
            <div className="gc-embed-modal__snippet-header">
              <span className="gc-embed-modal__snippet-label">
                {t("app.embed.snippet", "HTML snippet")}
              </span>
              <button
                type="button"
                className="gc-btn gc-btn-primary gc-embed-modal__copy-btn"
                onClick={handleCopy}
              >
                {copied
                  ? t("app.embed.copied", "Copied!")
                  : t("app.embed.copySnippet", "Copy")}
              </button>
            </div>
            <pre className="gc-embed-modal__code">
              <code>{snippet}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
