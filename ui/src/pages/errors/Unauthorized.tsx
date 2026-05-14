// Copyright GraphCaster. All Rights Reserved.

import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Button, Card, Heading, Text } from "../../components/ui";

export default function UnauthorizedView() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="gc-error-page" data-testid="unauthorized-view">
      <Card variant="elevated" padding="large" className="gc-error-page__card">
        <Heading level={1} size="2xl" className="gc-error-page__code">
          {t("app.errors.unauthorized.code")}
        </Heading>
        <Heading level={2} size="lg">
          {t("app.errors.unauthorized.title")}
        </Heading>
        <Text size="sm" color="secondary" className="gc-error-page__reason">
          {t("app.errors.unauthorized.reason")}
        </Text>
        <Button
          variant="solid"
          size="medium"
          onClick={() => navigate("/signin")}
          data-testid="sign-in-btn"
        >
          {t("app.errors.unauthorized.signIn")}
        </Button>
      </Card>
    </div>
  );
}
