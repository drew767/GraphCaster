// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { useBannerStore, type Banner } from "../../stores/bannerStore";

function BannerRow({
  banner,
  onDismiss,
  dismissLabel,
}: {
  banner: Banner;
  onDismiss: (id: string) => void;
  dismissLabel: string;
}) {
  return (
    <div
      className={`gc-banner gc-banner--${banner.type}`}
      role={banner.type === "error" ? "alert" : "status"}
      data-banner-id={banner.id}
    >
      <span className="gc-banner__message">{banner.message}</span>
      {banner.action ? (
        <button
          type="button"
          className="gc-banner__action gc-btn gc-btn-small"
          onClick={banner.action.onClick}
        >
          {banner.action.label}
        </button>
      ) : null}
      {banner.dismissible !== false ? (
        <button
          type="button"
          className="gc-banner__dismiss"
          aria-label={dismissLabel}
          onClick={() => onDismiss(banner.id)}
        >
          {"×"}
        </button>
      ) : null}
    </div>
  );
}

export function BannerHost(): ReactElement | null {
  const banners = useBannerStore((s) => s.banners);
  const dismiss = useBannerStore((s) => s.dismiss);
  const { t } = useTranslation();
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const el = document.getElementById("gc-banners-slot");
    setSlot(el);
  }, []);

  if (banners.length === 0) {
    return null;
  }

  const dismissLabel = t("banners.dismiss");
  const content = (
    <div className="gc-banner-host" aria-live="polite" aria-relevant="additions">
      {banners.map((banner) => (
        <BannerRow
          key={banner.id}
          banner={banner}
          onDismiss={dismiss}
          dismissLabel={dismissLabel}
        />
      ))}
    </div>
  );

  if (slot) {
    return createPortal(content, slot);
  }
  return content;
}
