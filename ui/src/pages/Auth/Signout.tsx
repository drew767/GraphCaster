// Copyright GraphCaster. All Rights Reserved.

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Text } from "../../components/ui";

export default function SignoutView() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/api/v1/auth/logout", { method: "POST" })
      .catch(() => undefined)
      .finally(() => {
        navigate("/signin", { replace: true });
      });
  }, [navigate]);

  return (
    <div className="gc-auth-form" style={{ textAlign: "center", padding: "2rem" }} data-testid="signout-view">
      <Text size="sm" color="secondary">{t("app.auth.signOut.signingOut")}</Text>
    </div>
  );
}
