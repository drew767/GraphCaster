// Copyright GraphCaster. All Rights Reserved.

import type { ReactNode } from "react";
import "./layouts.css";

export function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <div className="gc-demo-shell" data-layout="demo">
      {children}
    </div>
  );
}
