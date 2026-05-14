// Copyright GraphCaster. All Rights Reserved.

import type { ReactNode } from "react";
import "./layouts.css";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="gc-auth-shell" data-layout="auth">
      <div className="gc-auth-shell__card">
        {children}
      </div>
    </div>
  );
}
