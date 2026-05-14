// Copyright GraphCaster. All Rights Reserved.

import React, { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Tag } from "../ui/Tag/Tag";
import { Button } from "../ui/Button/Button";
import { Input } from "../ui/Input/Input";
import { Popover } from "../ui/Popover/Popover";

export interface WorkflowTagsContainerProps {
  tags: string[];
  onChange: (newTags: string[]) => void;
  availableTags: string[];
  onCreateTag?: (name: string) => Promise<void>;
  maxTags?: number;
  readOnly?: boolean;
}

export function WorkflowTagsContainer({
  tags,
  onChange,
  availableTags,
  onCreateTag,
  maxTags,
  readOnly = false,
}: WorkflowTagsContainerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const canAddMore = maxTags === undefined || tags.length < maxTags;

  const suggestions = availableTags.filter(
    (tag) =>
      tag.toLowerCase().includes(query.toLowerCase()) && !tags.includes(tag),
  );

  const queryMatchesExact = availableTags.some(
    (tag) => tag.toLowerCase() === query.toLowerCase(),
  );

  const handleRemove = useCallback(
    (tag: string) => {
      onChange(tags.filter((t) => t !== tag));
    },
    [tags, onChange],
  );

  const handleSelect = useCallback(
    (tag: string) => {
      if (!tags.includes(tag)) {
        onChange([...tags, tag]);
      }
      setQuery("");
      setOpen(false);
    },
    [tags, onChange],
  );

  const handleCreate = useCallback(async () => {
    const name = query.trim();
    if (!name) return;
    setCreating(true);
    try {
      if (onCreateTag) {
        await onCreateTag(name);
      }
      onChange([...tags, name]);
      setQuery("");
      setOpen(false);
    } finally {
      setCreating(false);
    }
  }, [query, onCreateTag, tags, onChange]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) setQuery("");
    },
    [],
  );

  return (
    <div className="gc-workflow-tags" data-testid="workflow-tags-container">
      {tags.map((tag) => (
        <Tag
          key={tag}
          size="small"
          closable={!readOnly}
          onClose={() => handleRemove(tag)}
        >
          {tag}
        </Tag>
      ))}

      {!readOnly && canAddMore && (
        <Popover
          open={open}
          onOpenChange={handleOpenChange}
          align="start"
          side="bottom"
          width={220}
          trigger={
            <Button
              variant="ghost"
              size="xsmall"
              iconLeft="plus"
              onClick={() => setOpen(true)}
              aria-label={t("app.workflows.tags.addTag")}
            >
              {t("app.workflows.tags.addTag")}
            </Button>
          }
        >
          <div className="gc-workflow-tags__popover">
            <Input
              ref={inputRef}
              autoFocus
              size="small"
              iconLeft="search"
              placeholder={t("app.workflows.tags.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim() && !queryMatchesExact) {
                  void handleCreate();
                }
              }}
            />
            <ul className="gc-workflow-tags__suggestions" role="listbox">
              {suggestions.map((tag) => (
                <li
                  key={tag}
                  role="option"
                  aria-selected={false}
                  className="gc-workflow-tags__suggestion-item"
                  onClick={() => handleSelect(tag)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") handleSelect(tag);
                  }}
                  tabIndex={0}
                >
                  {tag}
                </li>
              ))}

              {query.trim() && !queryMatchesExact && (
                <li
                  role="option"
                  aria-selected={false}
                  className="gc-workflow-tags__suggestion-item gc-workflow-tags__create-item"
                  onClick={() => void handleCreate()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") void handleCreate();
                  }}
                  tabIndex={0}
                >
                  {creating
                    ? t("app.workflows.tags.creating")
                    : t("app.workflows.tags.createTag", { name: query.trim() })}
                </li>
              )}

              {suggestions.length === 0 && (!query.trim() || queryMatchesExact) && (
                <li className="gc-workflow-tags__empty" role="option" aria-selected={false}>
                  {t("app.workflows.tags.noSuggestions")}
                </li>
              )}
            </ul>
          </div>
        </Popover>
      )}
    </div>
  );
}
