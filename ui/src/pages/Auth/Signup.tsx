// Copyright GraphCaster. All Rights Reserved.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AuthLayout } from "../../app/layouts/AuthLayout";
import { Button, Heading, Input, Logo, Text } from "../../components/ui";

export default function SignupView() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { message?: string }).message ?? t("app.auth.signUp.errorFailed"));
        return;
      }
      navigate("/home/workflows", { replace: true });
    } catch {
      setError(t("app.auth.signUp.errorNetwork"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="gc-auth-form" data-testid="signup-view">
        <div className="gc-auth-form__logo">
          <Logo variant="full" size={28} />
        </div>

        <Heading level={1} size="lg" className="gc-auth-form__heading">
          {t("app.auth.signUp.heading")}
        </Heading>

        <form onSubmit={handleSubmit} noValidate className="gc-auth-form__fields">
          <label className="gc-auth-form__label" htmlFor="signup-first-name">
            {t("app.auth.signUp.firstName")}
          </label>
          <Input
            id="signup-first-name"
            type="text"
            placeholder={t("app.auth.signUp.firstNamePlaceholder")}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            data-testid="signup-first-name"
            required
          />

          <label className="gc-auth-form__label" htmlFor="signup-last-name">
            {t("app.auth.signUp.lastName")}
          </label>
          <Input
            id="signup-last-name"
            type="text"
            placeholder={t("app.auth.signUp.lastNamePlaceholder")}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            data-testid="signup-last-name"
            required
          />

          <label className="gc-auth-form__label" htmlFor="signup-email">
            {t("app.auth.signUp.email")}
          </label>
          <Input
            id="signup-email"
            type="email"
            placeholder={t("app.auth.signUp.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="signup-email"
            required
          />

          <label className="gc-auth-form__label" htmlFor="signup-password">
            {t("app.auth.signUp.password")}
          </label>
          <Input
            id="signup-password"
            type="password"
            placeholder={t("app.auth.signUp.passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="signup-password"
            required
          />

          {error && (
            <p className="gc-auth-form__error" role="alert" data-testid="signup-error">
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="solid"
            size="medium"
            fullWidth
            loading={loading}
            data-testid="signup-submit"
          >
            {t("app.auth.signUp.submit")}
          </Button>
        </form>

        <div className="gc-auth-form__bottom-link">
          <Text size="sm">{t("app.auth.signUp.haveAccount")}</Text>{" "}
          <a href="/signin" className="gc-auth-link" data-testid="signin-link">
            {t("app.auth.signUp.signInLink")}
          </a>
        </div>
      </div>
    </AuthLayout>
  );
}
