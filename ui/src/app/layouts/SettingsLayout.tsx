// Copyright GraphCaster. All Rights Reserved.

import type { ReactNode } from "react";
import "./layouts.css";

interface SettingsLayoutProps {
  children: ReactNode;
  sidebar?: ReactNode;
}

export function SettingsLayout({ children, sidebar }: SettingsLayoutProps) {
  return (
    <div className="gc-app-shell gc-app-shell--settings" data-layout="settings">
      <div className="gc-app-shell__banners" id="gc-banners-slot" />
      <aside className="gc-app-shell__sidebar" id="gc-sidebar-slot">
        {/* MainSidebar will be inserted via portal in UX34 */}
      </aside>
      <nav className="gc-app-shell__sub-sidebar" id="gc-settings-sub-sidebar-slot">
        {sidebar}
      </nav>
      <header className="gc-app-shell__header" id="gc-header-slot">
        {/* MainHeader inserted in UX35 */}
      </header>
      <main className="gc-app-shell__content">
        {children}
      </main>
    </div>
  );
}
