// Copyright GraphCaster. All Rights Reserved.

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AuthLayout } from "../../app/layouts/AuthLayout";
import { Button, Checkbox, Heading, Input, Logo, Text } from "../../components/ui";
import { isTauriRuntime } from "../../run/tauriEnv";

export default function SigninView() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isTauri = isTauriRuntime();

  // In Tauri (single-user local mode), skip auth entirely.
  useEffect(() => {
    if (isTauri) {
      navigate("/home/workflows", { replace: true });
    }
  }, [isTauri, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, rememberMe }),
      });
      if (!res.ok) {
        setError(t("app.auth.signIn.errorInvalid"));
        return;
      }
      navigate("/home/workflows", { replace: true });
    } catch {
      setError(t("app.auth.signIn.errorInvalid"));
    } finally {
      setLoading(false);
    }
  }

  const SSO_PROVIDERS = [
    { id: "google", label: t("app.auth.signIn.ssoGoogle"), href: "/api/v1/auth/sso/google/login" },
    { id: "github", label: t("app.auth.signIn.ssoGitHub"), href: "/api/v1/auth/sso/github/login" },
    { id: "microsoft", label: t("app.auth.signIn.ssoMicrosoft"), href: "/api/v1/auth/sso/microsoft/login" },
  ] as const;

  return (
    <AuthLayout>
      <div className="gc-auth-form" data-testid="signin-view">
        {isTauri && (
          <div className="gc-auth-local-banner" data-testid="local-banner" role="status">
            {t("app.auth.signIn.localBanner")}
          </div>
        )}

        <div className="gc-auth-form__logo">
          <Logo variant="full" size={28} />
        </div>

        <Heading level={1} size="lg" className="gc-auth-form__heading">
          {t("app.auth.signIn.heading")}
        </Heading>

        <form onSubmit={handleSubmit} noValidate className="gc-auth-form__fields">
          <label className="gc-auth-form__label" htmlFor="signin-email">
            {t("app.auth.signIn.email")}
          </label>
          <Input
            id="signin-email"
            type="email"
            placeholder={t("app.auth.signIn.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="signin-email"
            required
          />

          <label className="gc-auth-form__label" htmlFor="signin-password">
            {t("app.auth.signIn.password")}
          </label>
          <Input
            id="signin-password"
            type="password"
            placeholder={t("app.auth.signIn.passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="signin-password"
            required
          />

          <Checkbox
            id="signin-remember"
            checked={rememberMe}
            onCheckedChange={setRememberMe}
            label={t("app.auth.signIn.rememberMe")}
            data-testid="signin-remember"
          />

          {error && (
            <p className="gc-auth-form__error" role="alert" data-testid="signin-error">
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="solid"
            size="medium"
            fullWidth
            loading={loading}
            data-testid="signin-submit"
          >
            {t("app.auth.signIn.submit")}
          </Button>
        </form>

        <div className="gc-auth-form__secondary-links">
          <a href="/forgot-password" className="gc-auth-link" data-testid="forgot-password-link">
            {t("app.auth.signIn.forgotPassword")}
          </a>
        </div>

        <div className="gc-auth-form__divider">
          <Text size="xs" color="secondary">{t("app.auth.signIn.orContinueWith")}</Text>
        </div>

        <div className="gc-auth-form__sso-row" data-testid="sso-row">
          {SSO_PROVIDERS.map((p) => (
            <a
              key={p.id}
              href={p.href}
              className="gc-auth-sso-btn"
              data-testid={`sso-${p.id}`}
              aria-label={p.label}
            >
              {p.label}
            </a>
          ))}
        </div>

        <div className="gc-auth-form__bottom-link">
          <Text size="sm">{t("app.auth.signIn.noAccount")}</Text>{" "}
          <a href="/signup" className="gc-auth-link" data-testid="signup-link">
            {t("app.auth.signIn.signUpLink")}
          </a>
        </div>
      </div>
    </AuthLayout>
  );
}
