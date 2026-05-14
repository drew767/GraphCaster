// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppShell } from "./layout/AppShell";
import { OnboardingTour } from "./app/components/OnboardingTour/OnboardingTour";
import { KeyboardShortcutsModal } from "./app/components/KeyboardShortcutsModal/KeyboardShortcutsModal";
import { ActivityFeedBridge } from "./app/components/ActivityFeedBridge/ActivityFeedBridge";
import { useGlobalHotkeys } from "./app/hooks/useGlobalHotkeys";
import { ToastProvider } from "./toast/ToastProvider";

function GlobalHotkeysHost() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  useGlobalHotkeys({ onShowShortcuts: openShortcuts });
  return (
    <KeyboardShortcutsModal
      open={shortcutsOpen}
      onOpenChange={setShortcutsOpen}
    />
  );
}

export default function App() {
  const { i18n, t } = useTranslation();

  const onLangChange = useCallback(
    (lng: string) => {
      void i18n.changeLanguage(lng);
    },
    [i18n],
  );

  return (
    <ToastProvider>
      <a href="#main" className="gc-skip-link">
        {t("a11y.skipToMain", "Skip to main content")}
      </a>
      <AppShell onLangChange={onLangChange} />
      <OnboardingTour />
      <GlobalHotkeysHost />
      <ActivityFeedBridge />
    </ToastProvider>
  );
}
