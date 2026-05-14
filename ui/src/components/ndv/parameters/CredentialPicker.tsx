// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  credentialsApi,
  type CredentialSummary,
  type ListByTypeOptions,
} from "../../../api/credentialsApi";

export type CredentialPickerProps = {
  credentialType: string;
  value: string | null;
  onChange: (credentialId: string | null) => void;
  onCreateNew?: (credentialType: string) => void;
  /** Test seam — overrides credential loading. */
  loadOverride?: (type: string) => Promise<CredentialSummary[]>;
  loadOptions?: ListByTypeOptions;
  disabled?: boolean;
};

export function CredentialPicker(props: CredentialPickerProps): JSX.Element {
  const { credentialType, value, onChange, onCreateNew, loadOverride, loadOptions, disabled } = props;
  const { t } = useTranslation();

  const [items, setItems] = useState<CredentialSummary[]>([]);
  const [query, setQuery] = useState<string>("");
  const [open, setOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = loadOverride ?? ((tp: string) => credentialsApi.listByType(tp, loadOptions));
    load(credentialType)
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [credentialType, loadOverride, loadOptions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return items;
    return items.filter((it) => it.name.toLowerCase().includes(q));
  }, [items, query]);

  const selected = useMemo(() => items.find((it) => it.id === value) ?? null, [items, value]);

  const handleSelect = useCallback(
    (id: string) => {
      onChange(id);
      setOpen(false);
      setQuery("");
    },
    [onChange],
  );

  const handleCreateNew = useCallback(() => {
    setOpen(false);
    setQuery("");
    onCreateNew?.(credentialType);
  }, [credentialType, onCreateNew]);

  return (
    <div className="gc-credential-picker" data-testid="gc-credential-picker" data-credential-type={credentialType}>
      <button
        type="button"
        className="gc-credential-picker__trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        data-testid="gc-credential-picker-trigger"
      >
        <span className="gc-credential-picker__trigger-label">
          {selected != null
            ? selected.name
            : t("ndv.credentials.selectPlaceholder", { type: credentialType })}
        </span>
      </button>
      {open ? (
        <div className="gc-credential-picker__pop" role="listbox" data-testid="gc-credential-picker-pop">
          <input
            type="text"
            className="gc-credential-picker__search"
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            placeholder={t("ndv.credentials.searchPlaceholder")}
            data-testid="gc-credential-picker-search"
            autoFocus
          />
          {loading ? (
            <div className="gc-credential-picker__loading">{t("ndv.credentials.loading")}</div>
          ) : filtered.length === 0 ? (
            <div className="gc-credential-picker__empty">{t("ndv.credentials.empty")}</div>
          ) : (
            <ul className="gc-credential-picker__list">
              {filtered.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    className="gc-credential-picker__item"
                    role="option"
                    aria-selected={value === it.id}
                    onClick={() => handleSelect(it.id)}
                    data-testid={`gc-credential-picker-item-${it.id}`}
                  >
                    {it.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="gc-credential-picker__create-new"
            onClick={handleCreateNew}
            data-testid="gc-credential-picker-create-new"
          >
            {t("ndv.credentials.createNew")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
