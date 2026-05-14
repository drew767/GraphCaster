// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { createPortal } from "react-dom";

import { Button } from "../../../components/ui/Button/Button";
import { Icon } from "../../../components/ui/Icon/Icon";
import type { IconName } from "../../../components/ui/Icon/registry";
import type { Banner } from "../../stores/bannerStore";
import "./AppBanners.css";

function iconForType(type: Banner["type"]): IconName {
  switch (type) {
    case "success":
      return "circle-check";
    case "warning":
      return "triangle-alert";
    case "error":
      return "circle-x";
    case "info":
      return "info";
  }
}

export function AppBanners({
  banners,
  onDismiss,
}: {
  banners: Banner[];
  onDismiss: (id: string) => void;
}) {
  const slot = document.getElementById("gc-banners-slot");
  if (!slot || !banners.length) return null;

  return createPortal(
    <div className="gc-banners">
      {banners.map((b) => (
        <div key={b.id} className={`gc-banner gc-banner--${b.type}`}>
          <span className="gc-banner__icon" aria-hidden="true">
            <Icon name={iconForType(b.type)} size={16} />
          </span>
          <div className="gc-banner__body">
            {b.title && <strong className="gc-banner__title">{b.title}</strong>}
            <span className="gc-banner__message">{b.message}</span>
          </div>
          {b.action && (
            <div className="gc-banner__action">
              {b.action.href ? (
                <a className="gc-banner__action-link" href={b.action.href}>
                  {b.action.label}
                </a>
              ) : (
                <Button
                  variant="ghost"
                  size="xsmall"
                  onClick={b.action.onClick}
                >
                  {b.action.label}
                </Button>
              )}
            </div>
          )}
          {b.dismissible !== false && (
            <button
              type="button"
              className="gc-banner__close"
              onClick={() => onDismiss(b.id)}
              aria-label="Dismiss"
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      ))}
    </div>,
    slot,
  );
}
