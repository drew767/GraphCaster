// Copyright GraphCaster. All Rights Reserved.

import "./styles.css";
import { mountBubble } from "./bubble";

export interface EmbedConfig {
  graphId: string;
  apiBase: string;
  shareLinkId?: string;
  theme?: "light" | "dark";
  primaryColor?: string;
  position?: "bottom-right" | "bottom-left";
  welcomeMessage?: string;
  bubbleIcon?: string;
}

declare global {
  interface Window {
    GraphCaster: {
      init: (config: EmbedConfig) => void;
    };
  }
}

let _initialized = false;

function init(config: EmbedConfig): void {
  if (_initialized) return;
  _initialized = true;
  mountBubble(config);
}

window.GraphCaster = { init };
