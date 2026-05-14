// Copyright GraphCaster. All Rights Reserved.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AuthLayout } from "../../app/layouts/AuthLayout";
import { Button, Heading, Input } from "../../components/ui";

export default function ChangePasswordView() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(t("app.auth.changePassword.mismatch"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { message?: string }).message ?? t("app.auth.changePassword.errorFailed"));
        return;
      }
      navigate("/home/workflows", { replace: true });
    } catch {
      setError(t("app.auth.changePassword.errorNetwork"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="gc-auth-form" data-testid="change-password-view">
        <Heading level={1} size="lg" className="gc-auth-form__heading">
          {t("app.auth.changePassword.heading")}
        </Heading>

        <form onSubmit={handleSubmit} noValidate className="gc-auth-form__fields">
          <label className="gc-auth-form__label" htmlFor="cp-old">
            {t("app.auth.changePassword.oldPassword")}
          </label>
          <Input
            id="cp-old"
            type="password"
            placeholder={t("app.auth.changePassword.oldPasswordPlaceholder")}
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            data-testid="cp-old-password"
            required
          />

          <label className="gc-auth-form__label" htmlFor="cp-new">
            {t("app.auth.changePassword.newPassword")}
          </label>
          <Input
            id="cp-new"
            type="password"
            placeholder={t("app.auth.changePassword.newPasswordPlaceholder")}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            data-testid="cp-new-password"
            required
          />

          <label className="gc-auth-form__label" htmlFor="cp-confirm">
            {t("app.auth.changePassword.confirmPassword")}
          </label>
          <Input
            id="cp-confirm"
            type="password"
            placeholder={t("app.auth.changePassword.confirmPasswordPlaceholder")}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            data-testid="cp-confirm-password"
            required
          />

          {error && (
            <p className="gc-auth-form__error" role="alert" data-testid="cp-error">
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="solid"
            size="medium"
            fullWidth
            loading={loading}
            data-testid="cp-submit"
          >
            {t("app.auth.changePassword.submit")}
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
}
