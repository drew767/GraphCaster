// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useRef, type ReactNode } from "react";

interface ModalShellProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  footer?: ReactNode;
}

export function ModalShell({ title, onClose, children, testId, footer }: ModalShellProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        ref={ref}
        style={{
          width: 420,
          maxWidth: "90vw",
          background: "var(--gc-surface-1)",
          color: "var(--gc-text-primary)",
          borderRadius: "var(--gc-radius-md)",
          border: "1px solid var(--gc-border)",
          boxShadow: "var(--gc-shadow-raise)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--gc-border)",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {title}
        </header>
        <div style={{ padding: 14 }}>{children}</div>
        {footer ? (
          <footer
            style={{
              padding: "10px 14px",
              borderTop: "1px solid var(--gc-border)",
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
            }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
