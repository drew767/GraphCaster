// Copyright GraphCaster. All Rights Reserved.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import App from "./App";
import i18n, { i18nReady } from "./i18n";
import "./styles/tokens.css";
import "./styles/app.css";

const el = document.getElementById("root");
if (!el) {
  throw new Error("root element missing");
}

void i18nReady.then(() => {
  createRoot(el).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </StrictMode>,
  );
});
