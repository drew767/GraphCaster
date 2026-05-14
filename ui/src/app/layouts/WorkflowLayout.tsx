// Copyright GraphCaster. All Rights Reserved.

import type { ReactNode } from "react";
import "./layouts.css";

export function WorkflowLayout({ children }: { children: ReactNode }) {
  return (
    <div className="gc-app-shell gc-app-shell--workflow" data-layout="workflow">
      <div className="gc-app-shell__banners" id="gc-banners-slot" />
      <aside className="gc-app-shell__sidebar" id="gc-sidebar-slot">
        {/* MainSidebar will be inserted via portal in UX34 */}
      </aside>
      <header className="gc-app-shell__header" id="gc-header-slot">
        {/* MainHeader inserted in UX35 */}
      </header>
      <main className="gc-app-shell__content">
        {children}
      </main>
      <aside className="gc-app-shell__aside" id="gc-aside-slot">
        {/* NDV panel — expanded via UX89 */}
      </aside>
    </div>
  );
}
