// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  getExpressionCompletions,
  type ExpressionCompletion,
} from "../graph/expressionAutocomplete";

export type ExpressionAutocompleteInputProps = {
  id?: string;
  className?: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  spellCheck?: boolean;
  nodeIds: readonly string[];
  autoComplete?: string;
};

type Range = { from: number; to: number; forceInsert: boolean };

export function ExpressionAutocompleteInput({
  id,
  className,
  value,
  onChange,
  readOnly = false,
  disabled = false,
  placeholder,
  spellCheck = false,
  nodeIds,
  autoComplete = "off",
}: ExpressionAutocompleteInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useRef(`gc-expr-ac-${Math.random().toString(36).slice(2, 9)}`).current;
  const rangeRef = useRef<Range>({ from: 0, to: 0, forceInsert: false });
  const pendingCaret = useRef<number | null>(null);

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ExpressionCompletion[]>([]);
  const [active, setActive] = useState(0);

  const close = useCallback(() => setOpen(false), []);

  const openWith = useCallback((list: ExpressionCompletion[], range: Range) => {
    rangeRef.current = range;
    setItems(list);
    setActive(0);
    setOpen(true);
  }, []);

  const syncFromInput = useCallback(() => {
    const el = inputRef.current;
    if (!el || readOnly || disabled) {
      return;
    }
    const cur = el.value;
    const c = el.selectionStart ?? cur.length;
    const m = getExpressionCompletions(cur, c, nodeIds);
    if (m && m.items.length > 0) {
      const palette = m.from === 0 && m.to === 0;
      openWith(
        m.items,
        palette ? { from: c, to: c, forceInsert: true } : { from: m.from, to: m.to, forceInsert: false },
      );
    } else {
      setOpen(false);
    }
  }, [nodeIds, readOnly, disabled, openWith]);

  const applyItem = useCallback(
    (comp: ExpressionCompletion) => {
      const r = rangeRef.current;
      let next: string;
      let caret: number;
      if (r.forceInsert) {
        next = value.slice(0, r.from) + comp.insert + value.slice(r.from);
        caret = r.from + comp.insert.length;
      } else {
        next = value.slice(0, r.from) + comp.insert + value.slice(r.to);
        caret = r.from + comp.insert.length;
      }
      pendingCaret.current = caret;
      onChange(next);
      close();
    },
    [value, onChange, close],
  );

  useLayoutEffect(() => {
    const el = inputRef.current;
    const p = pendingCaret.current;
    if (el && p != null) {
      el.setSelectionRange(p, p);
      pendingCaret.current = null;
    }
  }, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (readOnly || disabled) {
      return;
    }
    if (e.key === " " && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const el = e.currentTarget;
      const c = el.selectionStart ?? 0;
      const m = getExpressionCompletions(el.value, c, nodeIds, { forcePalette: true });
      if (m) {
        openWith(m.items, { from: c, to: c, forceInsert: true });
      }
      return;
    }
    if (open && items.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(items.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const pick = items[active];
        if (pick) {
          applyItem(pick);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
  };

  return (
    <div className="gc-expression-ac">
      <input
        ref={inputRef}
        id={id}
        className={className}
        type="text"
        value={value}
        readOnly={readOnly}
        disabled={disabled}
        spellCheck={spellCheck}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete={open ? "list" : undefined}
        onChange={(ev) => {
          onChange(ev.target.value);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={() => {
          if (!readOnly && !disabled) {
            syncFromInput();
          }
        }}
        onBlur={() => {
          window.setTimeout(() => close(), 120);
        }}
      />
      {open && items.length > 0 ? (
        <ul
          className="gc-expression-ac__list"
          id={listId}
          role="listbox"
          aria-label="Expression completions"
        >
          {items.map((it, idx) => (
            <li
              key={`${it.kind}:${it.insert}:${idx}`}
              role="option"
              aria-selected={idx === active}
              className={
                idx === active
                  ? "gc-expression-ac__item gc-expression-ac__item--active"
                  : "gc-expression-ac__item"
              }
              onMouseDown={(ev) => {
                ev.preventDefault();
                applyItem(it);
              }}
            >
              <span className="gc-expression-ac__mono">{it.label}</span>
              <span className="gc-expression-ac__kind">{it.kind}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
