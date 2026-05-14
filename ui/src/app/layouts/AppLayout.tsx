// Copyright GraphCaster. All Rights Reserved.

import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { DefaultLayout } from "./DefaultLayout";
import { WorkflowLayout } from "./WorkflowLayout";
import { SettingsLayout } from "./SettingsLayout";
import { AuthLayout } from "./AuthLayout";
import { DemoLayout } from "./DemoLayout";

export type LayoutKind = "default" | "workflow" | "settings" | "auth" | "demo";

const LAYOUT_BY_PATH: Array<{ test: RegExp; layout: LayoutKind }> = [
  { test: /^\/workflow\//, layout: "workflow" },
  { test: /^\/settings/, layout: "settings" },
  { test: /^\/(signin|signup|signout|forgot-password|change-password|setup)/, layout: "auth" },
  { test: /^\/(demo|embed)/, layout: "demo" },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const match = LAYOUT_BY_PATH.find((m) => m.test.test(pathname));
  const layout: LayoutKind = match?.layout ?? "default";

  switch (layout) {
    case "workflow": return <WorkflowLayout>{children}</WorkflowLayout>;
    case "settings": return <SettingsLayout>{children}</SettingsLayout>;
    case "auth":     return <AuthLayout>{children}</AuthLayout>;
    case "demo":     return <DemoLayout>{children}</DemoLayout>;
    default:         return <DefaultLayout>{children}</DefaultLayout>;
  }
}
