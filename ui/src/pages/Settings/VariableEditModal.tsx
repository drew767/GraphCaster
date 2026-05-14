// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  Checkbox,
  Dialog,
  Input,
  InputNumber,
  Select,
  Switch,
  Text,
} from "../../components/ui";
import { isValidVariableKey, type Variable, type VariableInput, type VariableType } from "../../api/variables";

interface VariableEditModalProps {
  open: boolean;
  initial: Variable | null;
  onClose: () => void;
  onSubmit: (input: VariableInput) => Promise<void> | void;
}

interface FormState {
  key: string;
  type: VariableType;
  value: string;
  boolValue: boolean;
  numberValue: number | "";
  isSecret: boolean;
  description: string;
}

function defaultState(): FormState {
  return {
    key: "",
    type: "string",
    value: "",
    boolValue: false,
    numberValue: "",
    isSecret: false,
    description: "",
  };
}

function fromVariable(v: Variable): FormState {
  return {
    key: v.key,
    type: v.type,
    value:
      v.type === "json"
        ? JSON.stringify(v.value, null, 2)
        : typeof v.value === "string"
          ? v.value
          : String(v.value ?? ""),
    boolValue: v.type === "boolean" ? Boolean(v.value) : false,
    numberValue: v.type === "number" && typeof v.value === "number" ? v.value : "",
    isSecret: v.isSecret,
    description: v.description ?? "",
  };
}

export function VariableEditModal({ open, initial, onClose, onSubmit }: VariableEditModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(defaultState);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [valueError, setValueError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial ? fromVariable(initial) : defaultState());
      setKeyError(null);
      setValueError(null);
      setSubmitting(false);
    }
  }, [open, initial]);

  const isEdit = initial !== null;

  function handleKeyChange(next: string) {
    setForm((f) => ({ ...f, key: next }));
    if (!next) {
      setKeyError(t("app.settings.variables.errors.keyRequired"));
    } else if (!isValidVariableKey(next)) {
      setKeyError(t("app.settings.variables.errors.keyInvalid"));
    } else {
      setKeyError(null);
    }
  }

  function handleJsonBlur() {
    if (form.type !== "json") return;
    if (!form.value.trim()) {
      setValueError(null);
      return;
    }
    try {
      JSON.parse(form.value);
      setValueError(null);
    } catch {
      setValueError(t("app.settings.variables.errors.jsonInvalid"));
    }
  }

  function buildInput(): VariableInput | null {
    if (!form.key || keyError) {
      if (!form.key) setKeyError(t("app.settings.variables.errors.keyRequired"));
      return null;
    }
    let value: unknown = form.value;
    if (form.type === "boolean") {
      value = form.boolValue;
    } else if (form.type === "number") {
      if (form.numberValue === "" || Number.isNaN(form.numberValue)) {
        setValueError(t("app.settings.variables.errors.numberInvalid"));
        return null;
      }
      value = Number(form.numberValue);
    } else if (form.type === "json") {
      if (!form.value.trim()) {
        value = null;
      } else {
        try {
          value = JSON.parse(form.value);
        } catch {
          setValueError(t("app.settings.variables.errors.jsonInvalid"));
          return null;
        }
      }
    } else {
      value = form.value;
    }
    return {
      key: form.key,
      value,
      type: form.type,
      isSecret: form.isSecret,
      description: form.description || undefined,
    };
  }

  async function handleSubmit() {
    const input = buildInput();
    if (!input) return;
    setSubmitting(true);
    try {
      await onSubmit(input);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message === "duplicate_key") {
        setKeyError(t("app.settings.variables.errors.duplicateKey"));
      } else {
        setKeyError(t("app.settings.variables.errors.saveFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const typeOptions = [
    { value: "string", label: t("app.settings.variables.types.string") },
    { value: "number", label: t("app.settings.variables.types.number") },
    { value: "boolean", label: t("app.settings.variables.types.boolean") },
    { value: "json", label: t("app.settings.variables.types.json") },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      size="medium"
      title={isEdit ? t("app.settings.variables.modal.editTitle") : t("app.settings.variables.modal.createTitle")}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="outline" size="small" onClick={onClose} data-testid="variable-modal-cancel">
            {t("app.settings.variables.modal.cancel")}
          </Button>
          <Button
            variant="solid"
            size="small"
            onClick={() => void handleSubmit()}
            loading={submitting}
            disabled={Boolean(keyError) || !form.key}
            data-testid="variable-modal-submit"
          >
            {isEdit ? t("app.settings.variables.modal.save") : t("app.settings.variables.modal.create")}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="variable-edit-form">
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size="sm" weight="medium">
            {t("app.settings.variables.modal.keyField")}
          </Text>
          <Input
            value={form.key}
            onChange={(e) => handleKeyChange(e.target.value)}
            placeholder={t("app.settings.variables.modal.keyPlaceholder")}
            variant={keyError ? "error" : "default"}
            disabled={isEdit}
            data-testid="variable-key-input"
          />
          {keyError && (
            <span
              data-testid="variable-key-error"
              style={{ fontSize: 12, color: "var(--color--danger, #d70015)" }}
            >
              {keyError}
            </span>
          )}
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size="sm" weight="medium">
            {t("app.settings.variables.modal.typeField")}
          </Text>
          <Select
            value={form.type}
            onValueChange={(v) => {
              setForm((f) => ({ ...f, type: v as VariableType }));
              setValueError(null);
            }}
            options={typeOptions}
            data-testid="variable-type-select"
          />
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size="sm" weight="medium">
            {t("app.settings.variables.modal.valueField")}
          </Text>
          {form.type === "string" && (
            <Input
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              type={form.isSecret ? "password" : "text"}
              data-testid="variable-value-input"
            />
          )}
          {form.type === "number" && (
            <InputNumber
              value={form.numberValue === "" ? undefined : form.numberValue}
              onChange={(n) => setForm((f) => ({ ...f, numberValue: n ?? "" }))}
              data-testid="variable-value-number"
            />
          )}
          {form.type === "boolean" && (
            <Switch
              checked={form.boolValue}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, boolValue: checked }))}
              label={form.boolValue ? t("app.settings.variables.modal.boolTrue") : t("app.settings.variables.modal.boolFalse")}
              data-testid="variable-value-switch"
            />
          )}
          {form.type === "json" && (
            <textarea
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              onBlur={handleJsonBlur}
              rows={6}
              spellCheck={false}
              data-testid="variable-value-json"
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                padding: 8,
                border: valueError
                  ? "1px solid var(--color--danger, #d70015)"
                  : "1px solid var(--color--border, rgba(28,28,30,0.15))",
                borderRadius: "var(--radius--3xs, 6px)",
                background: "var(--color--surface, #fff)",
                color: "var(--color--text, #1c1c1e)",
                resize: "vertical",
              }}
            />
          )}
          {valueError && (
            <span
              data-testid="variable-value-error"
              style={{ fontSize: 12, color: "var(--color--danger, #d70015)" }}
            >
              {valueError}
            </span>
          )}
        </div>

        <Checkbox
          checked={form.isSecret}
          onCheckedChange={(checked) => setForm((f) => ({ ...f, isSecret: Boolean(checked) }))}
          label={t("app.settings.variables.modal.secretField")}
          data-testid="variable-secret-checkbox"
        />

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size="sm" weight="medium">
            {t("app.settings.variables.modal.descriptionField")}
          </Text>
          <Input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder={t("app.settings.variables.modal.descriptionPlaceholder")}
            data-testid="variable-description-input"
          />
        </label>
      </div>
    </Dialog>
  );
}
