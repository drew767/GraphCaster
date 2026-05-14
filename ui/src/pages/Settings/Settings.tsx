// Copyright GraphCaster. All Rights Reserved.

import { Outlet } from "react-router-dom";
import { SettingsLayout } from "../../app/layouts/SettingsLayout";
import { SettingsSubSidebar } from "./SettingsSubSidebar";

export default function SettingsPage() {
  return (
    <SettingsLayout sidebar={<SettingsSubSidebar />}>
      <div data-testid="settings-page">
        <Outlet />
      </div>
    </SettingsLayout>
  );
}
