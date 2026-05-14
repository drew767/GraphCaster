// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useRef, useState, type KeyboardEvent, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ChatFile } from "./chatHistoryStore";

type Props = {
  onSend: (text: string, files: ChatFile[]) => void;
  disabled?: boolean;
};

function fileToBase64(file: File): Promise<ChatFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? result;
      resolve({ name: file.name, mimeType: file.type, base64 });
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

export function MessageInput({ onSend, disabled }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<ChatFile[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && pendingFiles.length === 0) return;
    onSend(trimmed, pendingFiles);
    setText("");
    setPendingFiles([]);
    if (fileRef.current) fileRef.current.value = "";
  }, [text, pendingFiles, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
        return;
      }
      if (e.key === "Enter" && mod) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const converted = await Promise.all(files.map(fileToBase64));
    setPendingFiles((prev) => [...prev, ...converted]);
  }, []);

  const removeFile = useCallback((idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  return (
    <div className="gc-pg-input" data-testid="gc-pg-input-area">
      {pendingFiles.length > 0 ? (
        <div className="gc-pg-input__files">
          {pendingFiles.map((f, i) => (
            <span key={i} className="gc-pg-input__file-chip">
              {f.name}
              <button
                type="button"
                className="gc-pg-input__file-remove"
                aria-label={t("app.playground.removeFileAria", { name: f.name })}
                onClick={() => removeFile(i)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="gc-pg-input__row">
        <textarea
          className="gc-pg-input__textarea"
          placeholder={t("app.playground.inputPlaceholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={2}
          data-testid="gc-pg-textarea"
        />
        <div className="gc-pg-input__actions">
          <button
            type="button"
            className="gc-pg-input__attach"
            aria-label={t("app.playground.attachFile")}
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            data-testid="gc-pg-attach-btn"
          >
            <span aria-hidden="true">+</span>
          </button>
          <button
            type="button"
            className="gc-pg-input__send"
            aria-label={t("app.playground.send")}
            onClick={handleSend}
            disabled={disabled || (text.trim() === "" && pendingFiles.length === 0)}
            data-testid="gc-pg-send-btn"
          >
            {t("app.playground.send")}
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        className="gc-pg-input__file-hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleFileChange}
        data-testid="gc-pg-file-input"
      />
    </div>
  );
}
