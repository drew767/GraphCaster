// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";

import { Button } from "../../../components/ui/Button/Button";
import { Icon } from "../../../components/ui/Icon/Icon";
import { Tooltip } from "../../../components/ui/Tooltip/Tooltip";
import { useAiContextStore } from "../../stores/aiContextStore";
import "./AiAssistantPanel.css";

const STORAGE_KEY = "gc.aiAssistant.open";

function readPersistedOpen(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writePersistedOpen(open: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, open ? "true" : "false");
  } catch {
    /* ignore */
  }
}

interface AiAssistantUiState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useAiAssistantStore = create<AiAssistantUiState>((set, get) => ({
  open: readPersistedOpen(),
  setOpen: (open) => {
    writePersistedOpen(open);
    set({ open });
  },
  toggle: () => {
    const next = !get().open;
    writePersistedOpen(next);
    set({ open: next });
  },
}));

interface ChatMessage {
  id: string;
  author: "user" | "assistant";
  text: string;
}

export interface AiAssistantTriggerProps {
  className?: string;
}

export function AiAssistantTrigger({ className }: AiAssistantTriggerProps) {
  const { t } = useTranslation();
  const toggle = useAiAssistantStore((s) => s.toggle);
  const open = useAiAssistantStore((s) => s.open);

  return (
    <button
      type="button"
      className={["gc-ai-assistant-trigger", className].filter(Boolean).join(" ")}
      onClick={toggle}
      aria-label={t("aiAssistant.toggle")}
      aria-expanded={open}
      data-testid="ai-assistant-trigger"
    >
      <Icon name="sparkles" size={18} />
    </button>
  );
}

function ContextChip() {
  const { t } = useTranslation();
  const context = useAiContextStore((s) => s.context);
  if (context.kind === "none") return null;
  const label =
    context.kind === "workflow"
      ? t("aiAssistant.contextWorkflow", { name: context.label })
      : t("aiAssistant.contextNode", { type: context.label });
  return (
    <div
      className="gc-ai-assistant__context-chip"
      data-testid="ai-assistant-context"
    >
      {label}
    </div>
  );
}

export function AiAssistantPanel() {
  const { t } = useTranslation();
  const open = useAiAssistantStore((s) => s.open);
  const setOpen = useAiAssistantStore((s) => s.setOpen);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [open, messages]);

  const handleClose = useCallback(() => setOpen(false), [setOpen]);

  const sendDisabledTip = useMemo(
    () => t("aiAssistant.sendDisabledTooltip"),
    [t],
  );

  if (!open) return null;

  function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setMessages((prev) => [
      ...prev,
      { id: `m-${Date.now()}`, author: "user", text: trimmed },
    ]);
    setDraft("");
  }

  return (
    <aside
      className="gc-ai-assistant"
      role="complementary"
      aria-label={t("aiAssistant.title")}
      data-testid="ai-assistant-panel"
    >
      <header className="gc-ai-assistant__header">
        <span className="gc-ai-assistant__title">
          <Icon name="sparkles" size={14} />
          {t("aiAssistant.title")}
        </span>
        <button
          type="button"
          className="gc-ai-assistant__close"
          aria-label={t("aiAssistant.close")}
          onClick={handleClose}
          data-testid="ai-assistant-close"
        >
          <Icon name="x" size={16} />
        </button>
      </header>

      <ContextChip />

      <div
        className="gc-ai-assistant__body"
        ref={bodyRef}
        data-testid="ai-assistant-body"
      >
        {messages.length === 0 ? (
          <div
            className="gc-ai-assistant__empty"
            data-testid="ai-assistant-empty"
          >
            {t("aiAssistant.emptyState")}
          </div>
        ) : (
          <ul className="gc-ai-assistant__messages" role="list">
            {messages.map((m) => (
              <li
                key={m.id}
                className={[
                  "gc-ai-assistant__message",
                  `gc-ai-assistant__message--${m.author}`,
                ].join(" ")}
              >
                {m.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="gc-ai-assistant__footer">
        <textarea
          className="gc-ai-assistant__textarea"
          placeholder={t("aiAssistant.inputPlaceholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          data-testid="ai-assistant-textarea"
          aria-label={t("aiAssistant.inputPlaceholder")}
        />
        <Tooltip content={sendDisabledTip} side="top">
          <span className="gc-ai-assistant__send-wrap">
            <Button
              size="small"
              variant="solid"
              iconLeft="send"
              disabled
              onClick={handleSend}
              aria-label={t("aiAssistant.send")}
              data-testid="ai-assistant-send"
            >
              {t("aiAssistant.send")}
            </Button>
          </span>
        </Tooltip>
      </footer>
    </aside>
  );
}
