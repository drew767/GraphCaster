// Copyright GraphCaster. All Rights Reserved.

import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { isTauriRuntime } from "../run/tauriEnv";

export function AppRouter({ children }: { children: React.ReactNode }) {
  const isTauri = isTauriRuntime();
  // Tauri: MemoryRouter (no real URL, in-memory only)
  // Web: BrowserRouter
  return isTauri
    ? <MemoryRouter initialEntries={["/"]}>{children}</MemoryRouter>
    : <BrowserRouter>{children}</BrowserRouter>;
}
