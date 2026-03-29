// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const LS_ONBOARDING = "gc.onboarding.quickTips.v1";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(LS_ONBOARDING) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(LS_ONBOARDING, "1");
  } catch {
    /* ignore */
  }
}

type Props = {
  /** When false, tips stay hidden (e.g. before workspace ready). */
  enabled: boolean;
};

export function OnboardingTips({ enabled }: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled || readDismissed()) {
      return;
    }
    const tmr = window.setTimeout(() => {
      setVisible(true);
    }, 1200);
    return () => {
      window.clearTimeout(tmr);
    };
  }, [enabled]);

  const dismiss = useCallback(() => {
    writeDismissed();
    setVisible(false);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div className="gc-onboarding-tips" role="region" aria-label={t("app.onboarding.regionAria")}>
      <div className="gc-onboarding-tips__inner">
        <div className="gc-onboarding-tips__title">{t("app.onboarding.title")}</div>
        <ul className="gc-onboarding-tips__list">
          <li>{t("app.onboarding.tipRmb")}</li>
          <li>{t("app.onboarding.tipDragWire")}</li>
        </ul>
        <button type="button" className="gc-btn gc-btn-small gc-btn-primary" onClick={dismiss}>
          {t("app.onboarding.dismiss")}
        </button>
      </div>
    </div>
  );
}
