// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";

export interface BinaryDescriptor {
  fileType?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  data?: string;
  url?: string;
}

export interface BinaryViewProps {
  binary: Record<string, BinaryDescriptor> | BinaryDescriptor | undefined;
}

function isImage(b: BinaryDescriptor): boolean {
  if (b.fileType === "image") return true;
  if (b.mimeType && b.mimeType.startsWith("image/")) return true;
  if (b.url && b.url.startsWith("data:image/")) return true;
  if (b.data && b.data.startsWith("data:image/")) return true;
  return false;
}

function isPdf(b: BinaryDescriptor): boolean {
  if (b.fileType === "pdf") return true;
  if (b.mimeType === "application/pdf") return true;
  if (b.fileName && /\.pdf$/i.test(b.fileName)) return true;
  return false;
}

function dataUriFor(b: BinaryDescriptor): string | undefined {
  if (b.url) return b.url;
  if (b.data) {
    if (b.data.startsWith("data:")) return b.data;
    if (b.mimeType) return `data:${b.mimeType};base64,${b.data}`;
  }
  return undefined;
}

function formatSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "0kb";
  const kb = bytes / 1024;
  if (kb < 1) return `${bytes}b`;
  if (kb < 1024) return `${kb.toFixed(1)}kb`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)}mb`;
}

function BinaryEntry({ name, value }: { name: string; value: BinaryDescriptor }) {
  const { t } = useTranslation();
  const uri = dataUriFor(value);
  const size = formatSize(value.fileSize);
  const label = value.fileName ?? name;

  if (isImage(value) && uri) {
    return (
      <div className="gc-binary__entry" data-testid="binary-image">
        <div className="gc-binary__entry-label">{label}</div>
        <img
          src={uri}
          alt={label}
          className="gc-binary__image"
          style={{ maxWidth: 200, maxHeight: 200 }}
        />
      </div>
    );
  }

  if (isPdf(value)) {
    return (
      <div className="gc-binary__entry" data-testid="binary-pdf">
        <div className="gc-binary__entry-label">{label}</div>
        <div className="gc-binary__meta">
          {t("app.ndv.output.binary.pdfLabel", { size })}
          {uri && (
            <>
              {" — "}
              <a href={uri} download={value.fileName} className="gc-binary__download">
                {t("app.ndv.output.binary.download")}
              </a>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="gc-binary__entry" data-testid="binary-file">
      <div className="gc-binary__entry-label">{label}</div>
      <div className="gc-binary__meta">
        {t("app.ndv.output.binary.fileLabel", { size })}
        {uri && (
          <>
            {" — "}
            <a href={uri} download={value.fileName} className="gc-binary__download">
              {t("app.ndv.output.binary.download")}
            </a>
          </>
        )}
      </div>
    </div>
  );
}

export function BinaryView({ binary }: BinaryViewProps) {
  const { t } = useTranslation();
  if (!binary) {
    return <div className="gc-binary__empty">{t("app.ndv.output.binary.empty")}</div>;
  }

  const entries: Array<[string, BinaryDescriptor]> =
    "fileType" in binary || "mimeType" in binary || "data" in binary || "url" in binary
      ? [["binary", binary as BinaryDescriptor]]
      : Object.entries(binary as Record<string, BinaryDescriptor>);

  if (entries.length === 0) {
    return <div className="gc-binary__empty">{t("app.ndv.output.binary.empty")}</div>;
  }

  return (
    <div className="gc-binary" data-testid="binary-view">
      {entries.map(([k, v]) => (
        <BinaryEntry key={k} name={k} value={v} />
      ))}
    </div>
  );
}

export function hasBinary(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const b = (item as Record<string, unknown>).binary;
  if (!b || typeof b !== "object") return false;
  return Object.keys(b as Record<string, unknown>).length > 0;
}

export function extractBinary(item: unknown): Record<string, BinaryDescriptor> | undefined {
  if (!item || typeof item !== "object") return undefined;
  const b = (item as Record<string, unknown>).binary;
  if (!b || typeof b !== "object") return undefined;
  return b as Record<string, BinaryDescriptor>;
}
