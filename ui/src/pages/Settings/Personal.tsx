// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import {
  AlertDialog,
  Avatar,
  Button,
  Card,
  Dialog,
  Heading,
  Input,
  RadioGroup,
  Select,
  Switch,
  Tag,
  Text,
} from "../../components/ui";
import { useThemeStore, type Theme } from "../../stores/themeStore";
import { useToast } from "../../toast/ToastProvider";
import "./Personal.css";

const LOCALE_KEY = "gc.locale";

const AVAILABLE_LOCALES: Array<{ value: string; label: string }> = [
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
];

interface ChangePasswordPayload {
  oldPassword: string;
  newPassword: string;
}

async function changePassword(payload: ChangePasswordPayload): Promise<void> {
  const res = await fetch("/api/v1/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
}

function PLACEHOLDER_QR(): string {
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'><rect width='1' height='1' fill='%23000'/></svg>";
  return `data:image/svg+xml;utf8,${svg}`;
}

function detectInitialLocale(): string {
  try {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(LOCALE_KEY) : null;
    if (stored && AVAILABLE_LOCALES.some((l) => l.value === stored)) return stored;
  } catch {
    /* ignore */
  }
  const current = i18n.language || "en";
  return current.toLowerCase().startsWith("ru") ? "ru" : "en";
}

function isValidUrl(value: string): boolean {
  if (value.trim() === "") return true;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function PersonalPage() {
  const { t } = useTranslation();
  const { theme, setTheme } = useThemeStore();
  const { toast } = useToast();

  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [email, setEmail] = React.useState("user@example.com");
  const [emailReadOnly] = React.useState<boolean>(false);
  const [avatarUrl, setAvatarUrl] = React.useState("");
  const [avatarUrlError, setAvatarUrlError] = React.useState<string | null>(null);

  const [oldPassword, setOldPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [passwordSubmitting, setPasswordSubmitting] = React.useState(false);

  const [mfaEnabled, setMfaEnabled] = React.useState(false);
  const [mfaModalOpen, setMfaModalOpen] = React.useState(false);
  const [mfaDisableConfirmOpen, setMfaDisableConfirmOpen] = React.useState(false);

  const [density, setDensity] = React.useState<"compact" | "default" | "comfortable">("default");
  const [language, setLanguage] = React.useState<string>(detectInitialLocale());

  function handleSaveProfile() {
    if (avatarUrl && !isValidUrl(avatarUrl)) {
      setAvatarUrlError(t("app.settings.personal.profile.errorInvalidUrl"));
      toast.error(t("app.settings.personal.profile.saveError"));
      return;
    }
    if (email && !emailReadOnly && !isValidEmail(email)) {
      toast.error(t("app.settings.personal.profile.errorInvalidEmail"));
      return;
    }
    setAvatarUrlError(null);
    toast.success(t("app.settings.personal.profile.saveSuccess"));
  }

  async function handleChangePassword() {
    if (newPassword.length < 8) {
      setPasswordError(t("app.settings.personal.password.errorTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("app.settings.personal.password.errorMismatch"));
      return;
    }
    setPasswordError(null);
    setPasswordSubmitting(true);
    try {
      await changePassword({ oldPassword, newPassword });
      toast.success(t("app.settings.personal.password.saveSuccess"));
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPasswordError(msg);
      toast.error(t("app.settings.personal.password.saveError"));
    } finally {
      setPasswordSubmitting(false);
    }
  }

  function handleThemeChange(value: string) {
    setTheme(value as Theme);
  }

  function handleLanguageChange(value: string) {
    setLanguage(value);
    void i18n.changeLanguage(value);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(LOCALE_KEY, value);
      }
    } catch {
      /* ignore */
    }
  }

  function handleEnableMfa() {
    setMfaModalOpen(true);
  }

  function handleConfirmEnableMfa() {
    setMfaEnabled(true);
    setMfaModalOpen(false);
    toast.success(t("app.settings.personal.mfa.enabledSuccess"));
  }

  function handleDisableMfa() {
    setMfaDisableConfirmOpen(true);
  }

  function handleConfirmDisableMfa() {
    setMfaEnabled(false);
    setMfaDisableConfirmOpen(false);
    toast.info(t("app.settings.personal.mfa.disabledSuccess"));
  }

  const themeOptions = [
    { value: "light", label: t("app.settings.personal.theme.light") },
    { value: "dark", label: t("app.settings.personal.theme.dark") },
    { value: "auto", label: t("app.settings.personal.theme.auto") },
  ];

  const densityOptions = [
    { value: "compact", label: t("app.settings.personal.density.compact") },
    { value: "default", label: t("app.settings.personal.density.default") },
    { value: "comfortable", label: t("app.settings.personal.density.comfortable") },
  ];

  return (
    <div className="gc-personal-page" data-testid="personal-page">
      <Heading level={2} size="xl" className="gc-personal-page__heading">
        {t("app.settings.personal.title")}
      </Heading>

      <div data-testid="section-profile">
        <Card className="gc-personal-section">
          <Card.Header title={<Heading level={2} size="md">{t("app.settings.personal.profile.heading")}</Heading>} />
          <Card.Body>
            <div className="gc-personal-section__avatar-row">
              <Avatar
                src={avatarUrl || undefined}
                fallback={firstName || "U"}
                size="xlarge"
                className="gc-personal-section__avatar"
              />
              <div className="gc-personal-section__avatar-meta">
                <Text size="sm" color="secondary">
                  {t("app.settings.personal.profile.avatarHint")}
                </Text>
              </div>
            </div>
            <div className="gc-personal-section__fields">
              <label className="gc-personal-section__label" htmlFor="ps-first-name">
                {t("app.settings.personal.profile.firstName")}
              </label>
              <Input
                id="ps-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder={t("app.settings.personal.profile.firstNamePh")}
                data-testid="input-first-name"
              />
              <label className="gc-personal-section__label" htmlFor="ps-last-name">
                {t("app.settings.personal.profile.lastName")}
              </label>
              <Input
                id="ps-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder={t("app.settings.personal.profile.lastNamePh")}
                data-testid="input-last-name"
              />
              <label className="gc-personal-section__label" htmlFor="ps-email">
                {t("app.settings.personal.profile.email")}
              </label>
              <Input
                id="ps-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={emailReadOnly}
                disabled={emailReadOnly}
                data-testid="input-email"
              />
              <label className="gc-personal-section__label" htmlFor="ps-avatar-url">
                {t("app.settings.personal.profile.avatarUrl")}
              </label>
              <Input
                id="ps-avatar-url"
                type="url"
                value={avatarUrl}
                onChange={(e) => {
                  setAvatarUrl(e.target.value);
                  if (avatarUrlError) setAvatarUrlError(null);
                }}
                placeholder="https://…"
                variant={avatarUrlError ? "error" : "default"}
                data-testid="input-avatar-url"
              />
              {avatarUrlError && (
                <span data-testid="avatar-url-error" className="gc-personal-section__error">
                  <Text size="sm" color="danger">{avatarUrlError}</Text>
                </span>
              )}
            </div>
          </Card.Body>
          <Card.Footer>
            <Button onClick={handleSaveProfile} data-testid="btn-save-profile">
              {t("app.settings.personal.profile.save")}
            </Button>
          </Card.Footer>
        </Card>
      </div>

      <div data-testid="section-password">
        <Card className="gc-personal-section">
          <Card.Header title={<Heading level={2} size="md">{t("app.settings.personal.password.heading")}</Heading>} />
          <Card.Body>
            <div className="gc-personal-section__fields">
              <label className="gc-personal-section__label" htmlFor="ps-old-password">
                {t("app.settings.personal.password.old")}
              </label>
              <Input
                id="ps-old-password"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                data-testid="input-old-password"
              />
              <label className="gc-personal-section__label" htmlFor="ps-new-password">
                {t("app.settings.personal.password.new")}
              </label>
              <Input
                id="ps-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                data-testid="input-new-password"
              />
              <label className="gc-personal-section__label" htmlFor="ps-confirm-password">
                {t("app.settings.personal.password.confirm")}
              </label>
              <Input
                id="ps-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                variant={passwordError ? "error" : "default"}
                data-testid="input-confirm-password"
              />
              {passwordError && (
                <span data-testid="password-error" className="gc-personal-section__error">
                  <Text size="sm" color="danger">{passwordError}</Text>
                </span>
              )}
            </div>
          </Card.Body>
          <Card.Footer>
            <Button
              onClick={() => { void handleChangePassword(); }}
              loading={passwordSubmitting}
              data-testid="btn-update-password"
            >
              {t("app.settings.personal.password.update")}
            </Button>
          </Card.Footer>
        </Card>
      </div>

      <div data-testid="section-mfa">
        <Card className="gc-personal-section">
          <Card.Header title={<Heading level={2} size="md">{t("app.settings.personal.mfa.heading")}</Heading>} />
          <Card.Body>
            <div className="gc-personal-section__mfa-status">
              <Tag
                variant={mfaEnabled ? "success" : "default"}
                size="small"
                data-testid="mfa-status"
              >
                {mfaEnabled
                  ? t("app.settings.personal.mfa.statusEnabled")
                  : t("app.settings.personal.mfa.statusDisabled")}
              </Tag>
              <Switch
                id="mfa-toggle"
                checked={mfaEnabled}
                onCheckedChange={(checked) => {
                  if (checked) handleEnableMfa();
                  else handleDisableMfa();
                }}
                label={t("app.settings.personal.mfa.enable")}
                data-testid="mfa-toggle"
              />
            </div>
            {mfaEnabled && (
              <div className="gc-personal-section__mfa-placeholder" data-testid="mfa-qr-placeholder">
                <div className="gc-personal-section__qr-box">
                  <Text size="sm" color="secondary">
                    {t("app.settings.personal.mfa.qrPlaceholder")}
                  </Text>
                </div>
                <Text size="sm" color="secondary">
                  {t("app.settings.personal.mfa.recoveryCodes")}
                </Text>
              </div>
            )}
            <div className="gc-personal-section__mfa-actions">
              {mfaEnabled ? (
                <Button
                  variant="destructive"
                  onClick={handleDisableMfa}
                  data-testid="btn-disable-mfa"
                >
                  {t("app.settings.personal.mfa.disable")}
                </Button>
              ) : (
                <Button
                  variant="solid"
                  onClick={handleEnableMfa}
                  data-testid="btn-enable-mfa"
                >
                  {t("app.settings.personal.mfa.enableButton")}
                </Button>
              )}
            </div>
          </Card.Body>
        </Card>
      </div>

      <div data-testid="section-personalization">
        <Card className="gc-personal-section">
          <Card.Header title={<Heading level={2} size="md">{t("app.settings.personal.theme.heading")}</Heading>} />
          <Card.Body>
            <div className="gc-personal-section__pref-group">
              <Text size="sm" weight="medium">
                {t("app.settings.personal.theme.label")}
              </Text>
              <RadioGroup
                value={theme}
                onValueChange={handleThemeChange}
                options={themeOptions}
                orientation="horizontal"
                aria-label={t("app.settings.personal.theme.label")}
                data-testid="theme-radio"
              />
            </div>
            <div className="gc-personal-section__pref-group">
              <Text size="sm" weight="medium">
                {t("app.settings.personal.density.label")}
              </Text>
              <RadioGroup
                value={density}
                onValueChange={(v) => setDensity(v as typeof density)}
                options={densityOptions}
                orientation="horizontal"
                aria-label={t("app.settings.personal.density.label")}
                data-testid="density-radio"
              />
            </div>
            <div className="gc-personal-section__pref-group">
              <label className="gc-personal-section__label" htmlFor="ps-language">
                {t("app.settings.personal.language.label")}
              </label>
              <Select
                id="ps-language"
                value={language}
                onValueChange={handleLanguageChange}
                options={AVAILABLE_LOCALES}
                aria-label={t("app.settings.personal.language.label")}
                data-testid="language-select"
              />
            </div>
          </Card.Body>
        </Card>
      </div>

      <Dialog
        open={mfaModalOpen}
        onOpenChange={(open) => { if (!open) setMfaModalOpen(false); }}
        title={t("app.settings.personal.mfa.modalTitle")}
        size="small"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => setMfaModalOpen(false)} data-testid="mfa-modal-cancel">
              {t("app.settings.personal.mfa.modalCancel")}
            </Button>
            <Button variant="solid" onClick={handleConfirmEnableMfa} data-testid="mfa-modal-confirm">
              {t("app.settings.personal.mfa.modalConfirm")}
            </Button>
          </div>
        }
      >
        <div className="gc-personal-section__mfa-modal" data-testid="mfa-enable-modal">
          <Text size="sm">{t("app.settings.personal.mfa.modalDescription")}</Text>
          <div className="gc-personal-section__qr-box" data-testid="mfa-qr-image-wrap">
            <img
              src={PLACEHOLDER_QR()}
              alt={t("app.settings.personal.mfa.qrAlt")}
              width={140}
              height={140}
              data-testid="mfa-qr-image"
            />
          </div>
        </div>
      </Dialog>

      <AlertDialog
        open={mfaDisableConfirmOpen}
        onOpenChange={(open) => { if (!open) setMfaDisableConfirmOpen(false); }}
        title={t("app.settings.personal.mfa.disableConfirmTitle")}
        description={t("app.settings.personal.mfa.disableConfirmDescription")}
        confirmLabel={t("app.settings.personal.mfa.disableConfirmYes")}
        cancelLabel={t("app.settings.personal.mfa.disableConfirmCancel")}
        destructive
        onConfirm={handleConfirmDisableMfa}
        onCancel={() => setMfaDisableConfirmOpen(false)}
      />
    </div>
  );
}
