// Copyright GraphCaster. All Rights Reserved.

import type { EmbedConfig } from "./index";
import { createChatPanel } from "./chat";

/**
 * Mount the floating bubble and chat panel into `document.body`.
 * Safe to call multiple times — it guards against double-init.
 */
export function mountBubble(config: EmbedConfig): void {
  const position = config.position ?? "bottom-right";
  const primaryColor = config.primaryColor ?? (config.theme === "dark" ? "#7c3aed" : "#6366f1");
  const icon = config.bubbleIcon ?? "💬";

  const { panel, open, close, isOpen } = createChatPanel(config);

  const bubble = document.createElement("button");
  bubble.className = `gc-embed-bubble gc-embed-bubble--${position}`;
  bubble.style.backgroundColor = primaryColor;
  bubble.type = "button";
  bubble.setAttribute("aria-label", "Open chat");
  bubble.setAttribute("aria-expanded", "false");

  if (icon.startsWith("http://") || icon.startsWith("https://") || icon.startsWith("/")) {
    const img = document.createElement("img");
    img.src = icon;
    img.alt = "";
    img.style.width = "28px";
    img.style.height = "28px";
    img.style.borderRadius = "4px";
    bubble.appendChild(img);
  } else {
    bubble.textContent = icon;
  }

  bubble.addEventListener("click", () => {
    if (isOpen()) {
      close();
      bubble.setAttribute("aria-expanded", "false");
      bubble.setAttribute("aria-label", "Open chat");
    } else {
      open();
      bubble.setAttribute("aria-expanded", "true");
      bubble.setAttribute("aria-label", "Close chat");
    }
  });

  document.body.appendChild(bubble);
  document.body.appendChild(panel);
}
