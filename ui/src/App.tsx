// Copyright GraphCaster. All Rights Reserved.

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { AppShell } from "./layout/AppShell";
import { ToastProvider } from "./toast/ToastProvider";

export default function App() {
  const { i18n } = useTranslation();

  const onLangChange = useCallback(
    (lng: string) => {
      void i18n.changeLanguage(lng);
    },
    [i18n],
  );

  return (
    <ToastProvider>
      <AppShell onLangChange={onLangChange} />
    </ToastProvider>
  );
}
