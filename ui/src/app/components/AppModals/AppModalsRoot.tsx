// Copyright GraphCaster. All Rights Reserved.

import React, { useEffect } from "react";

import { useUIStore } from "../../stores/uiStore";
import type { ModalKey } from "../../stores/uiStore";

export function AppModalsRoot() {
  useEffect(() => {
    let el = document.getElementById("gc-app-modals");
    if (!el) {
      el = document.createElement("div");
      el.id = "gc-app-modals";
      document.body.appendChild(el);
    }
    return () => {
      const existing = document.getElementById("gc-app-modals");
      existing?.remove();
    };
  }, []);
  return null;
}

export interface ModalHostProps {
  modalKey: ModalKey;
  children: (open: boolean, payload: unknown, close: () => void) => React.ReactNode;
}

export function ModalHost({ modalKey, children }: ModalHostProps) {
  const open = useUIStore((s) => s.isModalOpen(modalKey));
  const payload = useUIStore((s) => s.getModalPayload(modalKey));
  const closeModal = useUIStore((s) => s.closeModal);
  return <>{children(open, payload, () => closeModal(modalKey))}</>;
}
