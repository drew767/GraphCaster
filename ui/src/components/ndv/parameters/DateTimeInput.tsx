// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../ui/Button/Button";
import "./ParameterTypes.css";

export interface DateTimeInputProps {
  value: string;
  onChange: (iso: string) => void;
  showNowButton?: boolean;
  disabled?: boolean;
}

function isoToLocal(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

export function DateTimeInput({
  value,
  onChange,
  showNowButton = true,
  disabled = false,
}: DateTimeInputProps) {
  const { t } = useTranslation();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(localToIso(e.target.value));
    },
    [onChange],
  );

  const handleNow = useCallback(() => {
    onChange(new Date().toISOString());
  }, [onChange]);

  return (
    <div className="gc-param-datetime" data-testid="param-datetime">
      <input
        type="datetime-local"
        className="gc-param-datetime__input"
        value={isoToLocal(value)}
        onChange={handleChange}
        disabled={disabled}
        placeholder={t("app.ndv.parameters.types.dateTime.placeholder")}
        data-testid="param-datetime-input"
      />
      {showNowButton && (
        <Button
          variant="ghost"
          size="small"
          onClick={handleNow}
          disabled={disabled}
          data-testid="param-datetime-now"
        >
          {t("app.ndv.parameters.types.dateTime.now")}
        </Button>
      )}
    </div>
  );
}

export default DateTimeInput;
