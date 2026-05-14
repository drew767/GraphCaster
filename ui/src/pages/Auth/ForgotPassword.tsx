// Copyright GraphCaster. All Rights Reserved.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AuthLayout } from "../../app/layouts/AuthLayout";
import { Button, Heading, Input } from "../../components/ui";

export default function ForgotPasswordView() {
  const { t } = useTranslation();

  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } finally {
      setLoading(false);
      setSubmitted(true);
    }
  }

  return (
    <AuthLayout>
      <div className="gc-auth-form" data-testid="forgot-password-view">
        <Heading level={1} size="lg" className="gc-auth-form__heading">
          {t("app.auth.forgotPassword.heading")}
        </Heading>

        {submitted ? (
          <p className="gc-auth-form__success" data-testid="forgot-success-msg">
            {t("app.auth.forgotPassword.successMessage")}
          </p>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="gc-auth-form__fields">
            <label className="gc-auth-form__label" htmlFor="forgot-email">
              {t("app.auth.forgotPassword.email")}
            </label>
            <Input
              id="forgot-email"
              type="email"
              placeholder={t("app.auth.forgotPassword.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="forgot-email"
              required
            />

            <Button
              type="submit"
              variant="solid"
              size="medium"
              fullWidth
              loading={loading}
              data-testid="forgot-submit"
            >
              {t("app.auth.forgotPassword.submit")}
            </Button>
          </form>
        )}

        <div className="gc-auth-form__bottom-link">
          <a href="/signin" className="gc-auth-link" data-testid="back-to-signin">
            {t("app.auth.forgotPassword.backToSignIn")}
          </a>
        </div>
      </div>
    </AuthLayout>
  );
}
