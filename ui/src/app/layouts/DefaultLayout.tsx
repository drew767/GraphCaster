// Copyright GraphCaster. All Rights Reserved.

import type { ReactNode } from "react";
import "./layouts.css";

export function DefaultLayout({ children }: { children: ReactNode }) {
  return (
    <div className="gc-app-shell gc-app-shell--default" data-layout="default">
      <div className="gc-app-shell__banners" id="gc-banners-slot" />
      <aside className="gc-app-shell__sidebar" id="gc-sidebar-slot">
        {/* MainSidebar will be inserted via portal in UX34 */}
      </aside>
      <header className="gc-app-shell__header" id="gc-header-slot">
        {/* MainHeader inserted in UX35 */}
      </header>
      <main className="gc-app-shell__content" id="main">
        {children}
      </main>
    </div>
  );
}
