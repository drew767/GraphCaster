// Copyright GraphCaster. All Rights Reserved.

import type { ReactNode } from "react";

import { hasScope, useScopes, type Scope } from "./scopes";

export interface HasScopeProps {
  scope: Scope | Scope[];
  fallback?: ReactNode;
  children: ReactNode;
}

export function HasScope({ scope, fallback = null, children }: HasScopeProps) {
  const scopes = useScopes();
  if (hasScope(scopes, scope)) {
    return <>{children}</>;
  }
  return <>{fallback}</>;
}
