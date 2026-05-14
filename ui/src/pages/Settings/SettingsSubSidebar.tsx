// Copyright GraphCaster. All Rights Reserved.

import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "./SettingsSubSidebar.css";

interface NavItem {
  labelKey: string;
  to: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { labelKey: "app.settings.nav.personal", to: "/settings/personal" },
  { labelKey: "app.settings.nav.apiKeys", to: "/settings/api-keys" },
  { labelKey: "app.settings.nav.users", to: "/settings/users", adminOnly: true },
  { labelKey: "app.settings.nav.variables", to: "/settings/variables" },
  { labelKey: "settings.environments.navLabel", to: "/settings/environments" },
  { labelKey: "app.settings.nav.externalSecrets", to: "/settings/external-secrets" },
  { labelKey: "app.settings.nav.communityNodes", to: "/settings/community-nodes" },
  { labelKey: "app.settings.nav.sourceControl", to: "/settings/source-control" },
  { labelKey: "app.settings.nav.sso", to: "/settings/sso" },
  { labelKey: "app.settings.nav.audit", to: "/settings/audit" },
  { labelKey: "app.settings.nav.logStreaming", to: "/settings/log-streaming" },
  { labelKey: "app.settings.nav.workers", to: "/settings/workers" },
  { labelKey: "app.settings.nav.about", to: "/settings/about" },
];

export function SettingsSubSidebar() {
  const { t } = useTranslation();

  return (
    <nav className="gc-settings-sub-sidebar" data-testid="settings-sub-sidebar" aria-label={t("app.settings.title")}>
      <div className="gc-settings-sub-sidebar__title">{t("app.settings.title")}</div>
      <ul className="gc-settings-sub-sidebar__list" role="list">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                ["gc-settings-sub-sidebar__item", isActive ? "gc-settings-sub-sidebar__item--active" : ""].filter(Boolean).join(" ")
              }
              data-testid={`settings-nav-${item.to.replace("/settings/", "")}`}
            >
              {t(item.labelKey)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
