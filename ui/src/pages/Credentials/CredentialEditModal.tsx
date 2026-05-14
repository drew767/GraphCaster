// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  Dialog,
  Icon,
  Input,
  Spinner,
  Tabs,
  Text,
} from "../../components/ui";
import { useUIStore } from "../../app/stores/uiStore";
import { useToast } from "../../toast/ToastProvider";
import {
  CREDENTIAL_TYPES,
  CREDENTIAL_TYPE_MAP,
  type CredentialField,
  type CredentialTypeDefinition,
} from "./credentialTypes";

// ---------------------------------------------------------------------------
// Modal key
// ---------------------------------------------------------------------------

export const CREDENTIAL_EDIT_MODAL_KEY = "credential-edit";

interface ModalPayload {
  id?: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

class NotConfiguredError extends Error {}

async function saveCredential(
  data: Record<string, string>,
  credentialId?: string,
): Promise<void> {
  const url = credentialId
    ? `/api/v1/credentials/${credentialId}`
    : "/api/v1/credentials";
  const method = credentialId ? "PUT" : "POST";
  const resp = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (resp.status === 404) throw new NotConfiguredError();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

async function testCredential(
  credentialId: string,
): Promise<{ ok: boolean; message?: string }> {
  const resp = await fetch("/api/v1/credentials/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: credentialId }),
  });
  if (resp.status === 404) throw new NotConfiguredError();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<{ ok: boolean; message?: string }>;
}

// ---------------------------------------------------------------------------
// Step 1: type selection
// ---------------------------------------------------------------------------

interface TypeGridProps {
  onSelect: (type: CredentialTypeDefinition) => void;
}

function TypeGrid({ onSelect }: TypeGridProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");

  const filtered = CREDENTIAL_TYPES.filter(
    (ct) =>
      !search ||
      ct.label.toLowerCase().includes(search.toLowerCase()) ||
      ct.type.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="gc-cred-type-grid-wrap" data-testid="credential-type-grid">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("app.credentials.typeSearchPlaceholder")}
        iconLeft="search"
        clearable
        onClear={() => setSearch("")}
        aria-label={t("app.credentials.typeSearchAriaLabel")}
        autoFocus
      />
      <div className="gc-cred-type-grid">
        {filtered.map((ct) => (
          <button
            key={ct.type}
            type="button"
            className="gc-cred-type-card"
            onClick={() => onSelect(ct)}
            data-testid={`credential-type-${ct.type}`}
          >
            <span className="gc-cred-type-card__icon" aria-hidden>
              <Icon name={ct.icon} size={24} />
            </span>
            <span className="gc-cred-type-card__label">{ct.label}</span>
            <span className="gc-cred-type-card__desc">{ct.description}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <Text color="muted" size="small">
            {t("app.credentials.typeSearchEmpty")}
          </Text>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dynamic field for a credential type
// ---------------------------------------------------------------------------

interface CredentialFormProps {
  typeDef: CredentialTypeDefinition;
  credentialId?: string;
  name: string;
  onNameChange: (v: string) => void;
  fields: Record<string, string>;
  onFieldChange: (key: string, value: string) => void;
  onTest: () => void;
  testing: boolean;
  testResult?: { ok: boolean; message?: string } | null;
  nameError?: string;
}

function CredentialForm({
  typeDef,
  credentialId,
  name,
  onNameChange,
  fields,
  onFieldChange,
  onTest,
  testing,
  testResult,
  nameError,
}: CredentialFormProps) {
  const { t } = useTranslation();

  const formTab = (
    <div className="gc-cred-form" data-testid="credential-form">
      <div className="gc-cred-form__field">
        <label className="gc-cred-form__label" htmlFor="cred-name">
          {t("app.credentials.fieldName")}
          <span aria-hidden> *</span>
        </label>
        <Input
          id="cred-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t("app.credentials.fieldNamePlaceholder")}
          variant={nameError ? "error" : "default"}
          aria-describedby={nameError ? "cred-name-error" : undefined}
        />
        {nameError && (
          <span id="cred-name-error" className="gc-cred-form__error" role="alert">
            {nameError}
          </span>
        )}
      </div>

      {typeDef.fields.map((field: CredentialField) => (
        <div key={field.key} className="gc-cred-form__field">
          <label className="gc-cred-form__label" htmlFor={`cred-field-${field.key}`}>
            {field.label}
            {field.required && <span aria-hidden> *</span>}
          </label>
          <Input
            id={`cred-field-${field.key}`}
            type={field.type === "password" ? "password" : field.type === "url" ? "url" : "text"}
            value={fields[field.key] ?? ""}
            onChange={(e) => onFieldChange(field.key, e.target.value)}
            placeholder={field.placeholder}
          />
        </div>
      ))}

      {typeDef.fields.length === 0 && (
        <div className="gc-cred-form__generic-notice">
          <Text size="small" color="muted">
            {t("app.credentials.customFieldsHint")}
          </Text>
        </div>
      )}

      {typeDef.isOAuth && (
        <div className="gc-cred-form__oauth">
          <Button
            variant="outline"
            iconLeft="external-link"
            size="small"
            type="button"
            onClick={() => {
              const win = window.open(
                `/api/v1/auth/sso/${typeDef.type}/login`,
                "_blank",
                "width=600,height=700",
              );
              if (win) {
                const timer = setInterval(() => {
                  if (win.closed) {
                    clearInterval(timer);
                  }
                }, 500);
              }
            }}
          >
            {t("app.credentials.oauthButton", { provider: typeDef.label })}
          </Button>
        </div>
      )}

      <div className="gc-cred-form__test">
        <Button
          variant="ghost"
          size="small"
          type="button"
          onClick={onTest}
          loading={testing}
          disabled={!credentialId}
          iconLeft="circle-play"
        >
          {t("app.credentials.testConnectionButton")}
        </Button>
        {testResult !== null && testResult !== undefined && (
          <span
            className={`gc-cred-form__test-result gc-cred-form__test-result--${testResult.ok ? "ok" : "fail"}`}
            data-testid="test-result"
          >
            <Icon name={testResult.ok ? "circle-check" : "circle-x"} size={14} />
            {testResult.message ?? (testResult.ok ? t("app.credentials.testOk") : t("app.credentials.testFail"))}
          </span>
        )}
      </div>
    </div>
  );

  const sharingTab = (
    <div className="gc-cred-sharing" data-testid="credential-sharing-tab">
      <Text color="muted" size="small">
        {t("app.credentials.sharingNotAvailable")}
      </Text>
    </div>
  );

  return (
    <Tabs
      items={[
        { id: "form", label: t("app.credentials.tabConnection"), content: formTab },
        { id: "sharing", label: t("app.credentials.tabSharing"), content: sharingTab },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Main modal content
// ---------------------------------------------------------------------------

interface CredentialEditInnerProps {
  payload: ModalPayload | undefined;
  onClose: () => void;
}

function CredentialEditInner({ payload, onClose }: CredentialEditInnerProps) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const isEdit = Boolean(payload?.id);

  // Step 1: type selection (only for new)
  const [selectedType, setSelectedType] = useState<CredentialTypeDefinition | null>(
    isEdit ? (CREDENTIAL_TYPE_MAP.get("generic-api-key") ?? null) : null,
  );

  // Form state
  const [credName, setCredName] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [nameError, setNameError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const handleTypeSelect = useCallback((typeDef: CredentialTypeDefinition) => {
    setSelectedType(typeDef);
    setFieldValues({});
    setTestResult(null);
  }, []);

  const handleFieldChange = useCallback((key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const validate = (): boolean => {
    if (!credName.trim()) {
      setNameError(t("app.credentials.fieldNameRequired"));
      return false;
    }
    setNameError(undefined);
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await saveCredential(
        { name: credName, type: selectedType?.type ?? "custom", ...fieldValues },
        payload?.id,
      );
      toast.success(t("app.credentials.saveSuccess"));
      onClose();
    } catch (err) {
      if (err instanceof NotConfiguredError) {
        toast.warning(t("app.credentials.notConfiguredWarning"));
        onClose();
      } else {
        toast.error(t("app.credentials.saveError"));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!payload?.id) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testCredential(payload.id);
      setTestResult(result);
    } catch {
      setTestResult({ ok: false, message: t("app.credentials.testFail") });
    } finally {
      setTesting(false);
    }
  };

  const title = isEdit
    ? t("app.credentials.editTitle")
    : selectedType
      ? t("app.credentials.createTitle", { type: selectedType.label })
      : t("app.credentials.selectTypeTitle");

  const footer =
    selectedType ? (
      <div className="gc-cred-modal-footer">
        <Button variant="ghost" type="button" onClick={onClose} disabled={saving}>
          {t("app.credentials.cancelButton")}
        </Button>
        {!isEdit && (
          <Button variant="ghost" type="button" onClick={() => setSelectedType(null)} disabled={saving}>
            {t("app.credentials.backButton")}
          </Button>
        )}
        <Button variant="solid" type="button" onClick={handleSave} loading={saving}>
          {t("app.credentials.saveButton")}
        </Button>
      </div>
    ) : (
      <div className="gc-cred-modal-footer">
        <Button variant="ghost" type="button" onClick={onClose}>
          {t("app.credentials.cancelButton")}
        </Button>
      </div>
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      size="large"
      title={title}
      footer={footer}
    >
      {saving && (
        <div className="gc-cred-modal-overlay-spinner" aria-label={t("app.credentials.saving")}>
          <Spinner size={24} />
        </div>
      )}
      {!selectedType ? (
        <TypeGrid onSelect={handleTypeSelect} />
      ) : (
        <CredentialForm
          typeDef={selectedType}
          credentialId={payload?.id}
          name={credName}
          onNameChange={setCredName}
          fields={fieldValues}
          onFieldChange={handleFieldChange}
          onTest={handleTest}
          testing={testing}
          testResult={testResult}
          nameError={nameError}
        />
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Modal host — wired to uiStore
// ---------------------------------------------------------------------------

export function CredentialEditModal() {
  const open = useUIStore((s) => s.isModalOpen(CREDENTIAL_EDIT_MODAL_KEY));
  const payload = useUIStore((s) => s.getModalPayload<ModalPayload>(CREDENTIAL_EDIT_MODAL_KEY));
  const closeModal = useUIStore((s) => s.closeModal);

  const handleClose = useCallback(() => {
    closeModal(CREDENTIAL_EDIT_MODAL_KEY);
  }, [closeModal]);

  if (!open) return null;

  return <CredentialEditInner payload={payload} onClose={handleClose} />;
}
