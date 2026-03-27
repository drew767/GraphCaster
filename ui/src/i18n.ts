// Copyright GraphCaster. All Rights Reserved.

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ru from "./locales/ru.json";

function systemLng(): string {
  const nav = typeof navigator !== "undefined" ? navigator.language || "en" : "en";
  return nav.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export const i18nReady = i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ru: { translation: ru },
  },
  lng: systemLng(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
