// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";
import { Heading } from "../../components/ui";

interface StubSettingsPageProps {
  title: string;
}

export function StubSettingsPage({ title }: StubSettingsPageProps) {
  const { t } = useTranslation();
  return (
    <div data-testid={`stub-settings-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <Heading level={2} size="xl">
        {title}
      </Heading>
      <p style={{ marginTop: 16, color: "var(--color--text--tint-2, rgba(28,28,30,0.55))", fontSize: 14 }}>
        {t("app.settings.comingSoon")}
      </p>
    </div>
  );
}
