// Copyright GraphCaster. All Rights Reserved.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export type PinDataPreviewPopoverProps = {
  pinData: unknown;
  onUnpin: () => void;
  /** Optional: invoked when the pointer enters or leaves the popover, so the parent can keep it open. */
  onHoverChange?: (hovered: boolean) => void;
};

const MAX_PREVIEW_LINES = 10;

function formatPinDataAsJson(value: unknown): string {
  try {
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Trim a multiline string to at most `maxLines`, marking truncation with a trailing ellipsis line. */
export function truncatePreviewText(input: string, maxLines: number = MAX_PREVIEW_LINES): {
  text: string;
  truncated: boolean;
} {
  const lines = input.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return { text: input, truncated: false };
  }
  return { text: `${lines.slice(0, maxLines).join("\n")}\n...`, truncated: true };
}

export function PinDataPreviewPopover({
  pinData,
  onUnpin,
  onHoverChange,
}: PinDataPreviewPopoverProps) {
  const { t } = useTranslation();
  const { text, truncated } = useMemo(() => {
    return truncatePreviewText(formatPinDataAsJson(pinData), MAX_PREVIEW_LINES);
  }, [pinData]);

  return (
    <div
      className="gc-pin-preview-popover"
      role="tooltip"
      aria-label={t("app.canvas.pin.preview.title")}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
    >
      <div className="gc-pin-preview-popover__title">
        {t("app.canvas.pin.preview.title")}
      </div>
      <pre className="gc-pin-preview-popover__body" data-truncated={truncated ? "true" : "false"}>
        {text}
      </pre>
      <div className="gc-pin-preview-popover__actions">
        <button
          type="button"
          className="gc-btn gc-pin-preview-popover__unpin"
          onClick={onUnpin}
        >
          {t("app.canvas.pin.preview.unpin")}
        </button>
      </div>
    </div>
  );
}
