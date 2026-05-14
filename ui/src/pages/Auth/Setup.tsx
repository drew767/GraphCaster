// Copyright GraphCaster. All Rights Reserved.

import { useMemo, useReducer } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AuthLayout } from "../../app/layouts/AuthLayout";
import {
  Button,
  Checkbox,
  Heading,
  Icon,
  Input,
  Logo,
  Select,
  Text,
} from "../../components/ui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Theme = "system" | "light" | "dark";

interface WizardState {
  step: 1 | 2 | 3;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  workspaceName: string;
  workspaceSlug: string;
  slugTouched: boolean;
  telemetry: boolean;
  locale: string;
  theme: Theme;
  error: string | null;
  submitting: boolean;
}

type WizardAction =
  | { type: "field"; key: keyof WizardState; value: WizardState[keyof WizardState] }
  | { type: "setWorkspaceName"; value: string }
  | { type: "setSlug"; value: string }
  | { type: "next" }
  | { type: "back" }
  | { type: "submitting"; value: boolean }
  | { type: "error"; value: string | null };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function isStep1Valid(s: WizardState): boolean {
  if (!s.firstName.trim()) return false;
  if (!s.lastName.trim()) return false;
  if (!EMAIL_RE.test(s.email.trim())) return false;
  if (s.password.length < 8) return false;
  if (s.password !== s.confirmPassword) return false;
  return true;
}

function isStep2Valid(s: WizardState): boolean {
  if (!s.workspaceName.trim()) return false;
  if (!SLUG_RE.test(s.workspaceSlug.trim())) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const INITIAL_WORKSPACE = "My workspace";

const initialState: WizardState = {
  step: 1,
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  confirmPassword: "",
  workspaceName: INITIAL_WORKSPACE,
  workspaceSlug: slugify(INITIAL_WORKSPACE),
  slugTouched: false,
  telemetry: true,
  locale:
    typeof navigator !== "undefined" && navigator.language
      ? navigator.language.split("-")[0]
      : "en",
  theme: "system",
  error: null,
  submitting: false,
};

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "field":
      return { ...state, [action.key]: action.value } as WizardState;
    case "setWorkspaceName":
      return {
        ...state,
        workspaceName: action.value,
        workspaceSlug: state.slugTouched
          ? state.workspaceSlug
          : slugify(action.value),
      };
    case "setSlug":
      return {
        ...state,
        workspaceSlug: action.value,
        slugTouched: true,
      };
    case "next":
      return state.step < 3 ? { ...state, step: (state.step + 1) as WizardState["step"], error: null } : state;
    case "back":
      return state.step > 1 ? { ...state, step: (state.step - 1) as WizardState["step"], error: null } : state;
    case "submitting":
      return { ...state, submitting: action.value };
    case "error":
      return { ...state, error: action.value };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

interface StepIndicatorProps {
  step: WizardState["step"];
  labels: [string, string, string];
}

function StepIndicator({ step, labels }: StepIndicatorProps) {
  return (
    <ol
      className="gc-setup-steps"
      data-testid="setup-step-indicator"
      style={{
        display: "flex",
        gap: 8,
        listStyle: "none",
        padding: 0,
        margin: "0 0 16px",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {labels.map((label, idx) => {
        const n = (idx + 1) as 1 | 2 | 3;
        const done = step > n;
        const current = step === n;
        return (
          <li
            key={n}
            className="gc-setup-steps__item"
            data-state={done ? "done" : current ? "current" : "pending"}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span
              className="gc-setup-steps__dot"
              aria-hidden
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: done || current ? "var(--gc-accent, #3b82f6)" : "var(--gc-bg-subtle, #e5e7eb)",
                color: done || current ? "#fff" : "var(--gc-text-muted, #6b7280)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {done ? <Icon name="check" size={12} /> : n}
            </span>
            <Text size="small" weight={current ? "medium" : undefined} color={current ? undefined : "subtle"}>
              {label}
            </Text>
            {n < 3 && (
              <span aria-hidden style={{ width: 16, height: 1, background: "var(--gc-border-subtle, #d1d5db)" }} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SetupView() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [state, dispatch] = useReducer(reducer, initialState);

  const step1Valid = useMemo(() => isStep1Valid(state), [state]);
  const step2Valid = useMemo(() => isStep2Valid(state), [state]);

  async function handleFinish() {
    dispatch({ type: "error", value: null });
    dispatch({ type: "submitting", value: true });
    try {
      const payload = {
        firstName: state.firstName.trim(),
        lastName: state.lastName.trim(),
        email: state.email.trim(),
        password: state.password,
        workspace: {
          name: state.workspaceName.trim(),
          slug: state.workspaceSlug.trim(),
        },
        preferences: {
          telemetry: state.telemetry,
          locale: state.locale,
          theme: state.theme,
        },
      };
      const res = await fetch("/api/v1/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        dispatch({
          type: "error",
          value:
            (body as { message?: string }).message ??
            t("app.auth.setup.subheading"),
        });
        return;
      }
      navigate("/", { replace: true });
    } catch {
      dispatch({ type: "error", value: t("app.auth.signin.errorNetwork") });
    } finally {
      dispatch({ type: "submitting", value: false });
    }
  }

  function handlePrimary() {
    if (state.step === 1) {
      if (step1Valid) dispatch({ type: "next" });
    } else if (state.step === 2) {
      if (step2Valid) dispatch({ type: "next" });
    } else {
      void handleFinish();
    }
  }

  const labels: [string, string, string] = [
    t("app.auth.setup.stepLabel1"),
    t("app.auth.setup.stepLabel2"),
    t("app.auth.setup.stepLabel3"),
  ];

  return (
    <AuthLayout>
      <div className="gc-auth-form gc-setup-wizard" data-testid="setup-view">
        <div className="gc-auth-form__logo">
          <Logo variant="full" size={28} />
        </div>

        <StepIndicator step={state.step} labels={labels} />

        <Heading level={1} size="lg" className="gc-auth-form__heading">
          {state.step === 1 && t("app.auth.setup.step1Title")}
          {state.step === 2 && t("app.auth.setup.step2Title")}
          {state.step === 3 && t("app.auth.setup.step3Title")}
        </Heading>
        <Text size="sm" color="secondary" className="gc-auth-form__subheading">
          {state.step === 1 && t("app.auth.setup.step1Subtitle")}
          {state.step === 2 && t("app.auth.setup.step2Subtitle")}
          {state.step === 3 && t("app.auth.setup.step3Subtitle")}
        </Text>

        <form
          onSubmit={(e) => { e.preventDefault(); handlePrimary(); }}
          noValidate
          className="gc-auth-form__fields"
          data-testid={`setup-step-${state.step}`}
        >
          {state.step === 1 && (
            <>
              <label className="gc-auth-form__label" htmlFor="setup-first-name">
                {t("app.auth.setup.firstName")}
              </label>
              <Input
                id="setup-first-name"
                type="text"
                placeholder={t("app.auth.setup.firstNamePlaceholder")}
                value={state.firstName}
                onChange={(e) => dispatch({ type: "field", key: "firstName", value: e.target.value })}
                data-testid="setup-first-name"
                required
              />

              <label className="gc-auth-form__label" htmlFor="setup-last-name">
                {t("app.auth.setup.lastName")}
              </label>
              <Input
                id="setup-last-name"
                type="text"
                placeholder={t("app.auth.setup.lastNamePlaceholder")}
                value={state.lastName}
                onChange={(e) => dispatch({ type: "field", key: "lastName", value: e.target.value })}
                data-testid="setup-last-name"
                required
              />

              <label className="gc-auth-form__label" htmlFor="setup-email">
                {t("app.auth.setup.email")}
              </label>
              <Input
                id="setup-email"
                type="email"
                placeholder={t("app.auth.setup.emailPlaceholder")}
                value={state.email}
                onChange={(e) => dispatch({ type: "field", key: "email", value: e.target.value })}
                data-testid="setup-email"
                required
              />

              <label className="gc-auth-form__label" htmlFor="setup-password">
                {t("app.auth.setup.password")}
              </label>
              <Input
                id="setup-password"
                type="password"
                placeholder={t("app.auth.setup.passwordPlaceholder")}
                value={state.password}
                onChange={(e) => dispatch({ type: "field", key: "password", value: e.target.value })}
                data-testid="setup-password"
                required
              />

              <label className="gc-auth-form__label" htmlFor="setup-confirm-password">
                {t("app.auth.setup.confirmPassword")}
              </label>
              <Input
                id="setup-confirm-password"
                type="password"
                placeholder={t("app.auth.setup.confirmPasswordPlaceholder")}
                value={state.confirmPassword}
                onChange={(e) => dispatch({ type: "field", key: "confirmPassword", value: e.target.value })}
                data-testid="setup-confirm-password"
                required
              />

              {state.confirmPassword && state.password !== state.confirmPassword && (
                <p className="gc-auth-form__error" role="alert" data-testid="setup-password-mismatch">
                  {t("app.auth.setup.errorPasswordMismatch")}
                </p>
              )}
            </>
          )}

          {state.step === 2 && (
            <>
              <label className="gc-auth-form__label" htmlFor="setup-workspace-name">
                {t("app.auth.setup.workspaceName")}
              </label>
              <Input
                id="setup-workspace-name"
                type="text"
                placeholder={t("app.auth.setup.workspaceNamePlaceholder")}
                value={state.workspaceName}
                onChange={(e) => dispatch({ type: "setWorkspaceName", value: e.target.value })}
                data-testid="setup-workspace-name"
                required
              />

              <label className="gc-auth-form__label" htmlFor="setup-workspace-slug">
                {t("app.auth.setup.workspaceSlug")}
              </label>
              <Input
                id="setup-workspace-slug"
                type="text"
                placeholder={t("app.auth.setup.workspaceSlugPlaceholder")}
                value={state.workspaceSlug}
                onChange={(e) => dispatch({ type: "setSlug", value: e.target.value })}
                data-testid="setup-workspace-slug"
                required
              />
              <Text size="xsmall" color="subtle">
                {t("app.auth.setup.workspaceSlugHint")}
              </Text>
            </>
          )}

          {state.step === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div data-testid="setup-telemetry-row">
                <Checkbox
                  checked={state.telemetry}
                  onCheckedChange={(v) => dispatch({ type: "field", key: "telemetry", value: v })}
                  label={t("app.auth.setup.telemetryLabel")}
                  description={t("app.auth.setup.telemetryHint")}
                  data-testid="setup-telemetry"
                />
              </div>

              <div>
                <label className="gc-auth-form__label" htmlFor="setup-locale">
                  {t("app.auth.setup.locale")}
                </label>
                <Select
                  id="setup-locale"
                  value={state.locale}
                  onValueChange={(v) => dispatch({ type: "field", key: "locale", value: v })}
                  options={[
                    { value: "en", label: "English" },
                    { value: "ru", label: "Русский" },
                  ]}
                  data-testid="setup-locale"
                  aria-label={t("app.auth.setup.locale")}
                />
              </div>

              <div>
                <label className="gc-auth-form__label" htmlFor="setup-theme">
                  {t("app.auth.setup.theme")}
                </label>
                <Select<Theme>
                  id="setup-theme"
                  value={state.theme}
                  onValueChange={(v) => dispatch({ type: "field", key: "theme", value: v })}
                  options={[
                    { value: "system", label: t("app.auth.setup.themeSystem") },
                    { value: "light", label: t("app.auth.setup.themeLight") },
                    { value: "dark", label: t("app.auth.setup.themeDark") },
                  ]}
                  data-testid="setup-theme"
                  aria-label={t("app.auth.setup.theme")}
                />
              </div>
            </div>
          )}

          {state.error && (
            <p className="gc-auth-form__error" role="alert" data-testid="setup-error">
              {state.error}
            </p>
          )}

          <div
            className="gc-auth-form__nav"
            style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 16 }}
          >
            <Button
              type="button"
              variant="outline"
              size="medium"
              onClick={() => dispatch({ type: "back" })}
              disabled={state.step === 1 || state.submitting}
              data-testid="setup-back"
            >
              {t("app.auth.setup.back")}
            </Button>

            <Button
              type="submit"
              variant="solid"
              size="medium"
              loading={state.submitting}
              disabled={
                state.submitting ||
                (state.step === 1 && !step1Valid) ||
                (state.step === 2 && !step2Valid)
              }
              data-testid={state.step === 3 ? "setup-finish" : "setup-next"}
            >
              {state.step === 3 ? t("app.auth.setup.finish") : t("app.auth.setup.next")}
            </Button>
          </div>
        </form>
      </div>
    </AuthLayout>
  );
}
