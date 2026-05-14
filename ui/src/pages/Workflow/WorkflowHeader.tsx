// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { InlineTextEdit } from "../../components/ui/InlineTextEdit/InlineTextEdit";
import { Switch } from "../../components/ui/Switch/Switch";
import { Tooltip } from "../../components/ui/Tooltip/Tooltip";
import { Pill } from "../../components/ui/Pill/Pill";
import { Popover } from "../../components/ui/Popover/Popover";
import { Tag } from "../../components/ui/Tag/Tag";
import { Input } from "../../components/ui/Input/Input";
import { Button } from "../../components/ui/Button/Button";
import { DropdownMenu } from "../../components/ui/DropdownMenu/DropdownMenu";
import { Icon } from "../../components/ui/Icon/Icon";
import { ShareModal } from "../Workflows/ShareModal";
import { PresenceAvatars } from "./PresenceAvatars";
import { AutosaveIndicator } from "../../app/components/AutosaveIndicator/AutosaveIndicator";

import "./WorkflowHeader.css";

import { useHeaderSlotStore } from "../../app/stores/headerSlotStore";
import { useWorkflowStore } from "../../app/stores/workflowStore";
import { useTagsStore } from "../../app/stores/tagsStore";
import { useRunStore } from "../../app/stores/runStore";

export interface WorkflowHeaderProps {
  workflowId: string;
}

/** Header slot composition for `/workflow/:id` routes. */
export function WorkflowHeader({ workflowId }: WorkflowHeaderProps) {
  const setSlots = useHeaderSlotStore((s) => s.setSlots);
  const clear = useHeaderSlotStore((s) => s.clear);

  const ensureWorkflow = useWorkflowStore((s) => s.ensureWorkflow);

  useEffect(() => {
    ensureWorkflow(workflowId);
  }, [workflowId, ensureWorkflow]);

  useEffect(() => {
    setSlots({
      left: <WorkflowHeaderLeft workflowId={workflowId} />,
      right: <WorkflowHeaderRight workflowId={workflowId} />,
    });
    return () => {
      clear();
    };
  }, [workflowId, setSlots, clear]);

  return null;
}

// ---------------------------------------------------------------------------
// Left side: name + active switch + tags
// ---------------------------------------------------------------------------

function WorkflowHeaderLeft({ workflowId }: { workflowId: string }) {
  return (
    <div
      className="gc-workflow-header gc-workflow-header__left"
      data-testid="workflow-header-left"
    >
      <WorkflowNameField workflowId={workflowId} />
      <ActiveToggle workflowId={workflowId} />
      <TagsControl workflowId={workflowId} />
    </div>
  );
}

function WorkflowNameField({ workflowId }: { workflowId: string }) {
  const { t } = useTranslation();
  const name = useWorkflowStore((s) => s.workflows[workflowId]?.name ?? "");
  const rename = useWorkflowStore((s) => s.renameWorkflow);

  return (
    <div className="gc-workflow-header__name" data-testid="workflow-header-name">
      <InlineTextEdit
        value={name}
        onChange={(next) => rename(workflowId, next)}
        placeholder={t("workflowHeader.namePlaceholder")}
        size="small"
        commitOn="both"
      />
    </div>
  );
}

function ActiveToggle({ workflowId }: { workflowId: string }) {
  const { t } = useTranslation();
  const active = useWorkflowStore((s) => s.workflows[workflowId]?.active ?? false);
  const setActive = useWorkflowStore((s) => s.setActive);

  const tooltipContent = active
    ? t("workflowHeader.active.tooltipOn")
    : t("workflowHeader.active.tooltipOff");

  return (
    <Tooltip content={tooltipContent} side="bottom">
      <span className="gc-workflow-header__active" data-testid="workflow-header-active">
        <Switch
          checked={active}
          onCheckedChange={(value) => setActive(workflowId, value)}
          size="small"
          label={t("workflowHeader.active.label")}
          data-testid="workflow-header-active-switch"
        />
      </span>
    </Tooltip>
  );
}

function TagsControl({ workflowId }: { workflowId: string }) {
  const { t } = useTranslation();
  const tags = useWorkflowStore((s) => s.workflows[workflowId]?.tags ?? []);
  const setTags = useWorkflowStore((s) => s.setTags);

  const availableTags = useTagsStore((s) => s.tags);
  const addAvailableTag = useTagsStore((s) => s.addTag);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const trigger = useMemo(() => {
    if (tags.length === 0) {
      return (
        <button
          type="button"
          className="gc-workflow-header__tags-trigger gc-workflow-header__tags-trigger--empty"
          data-testid="workflow-header-tags-trigger"
          aria-label={t("workflowHeader.tags.addTagsAria")}
        >
          <Icon name="plus" size={12} />
          <span>{t("workflowHeader.tags.addTags")}</span>
        </button>
      );
    }
    return (
      <button
        type="button"
        className="gc-workflow-header__tags-trigger"
        data-testid="workflow-header-tags-trigger"
      >
        <Pill size="small" variant="info">
          {t("workflowHeader.tags.countLabel", { count: tags.length })}
        </Pill>
      </button>
    );
  }, [tags.length, t]);

  function toggleTag(name: string) {
    if (tags.includes(name)) {
      setTags(workflowId, tags.filter((tg) => tg !== name));
    } else {
      setTags(workflowId, [...tags, name]);
    }
  }

  function createTag() {
    const value = draft.trim();
    if (!value) return;
    addAvailableTag(value);
    if (!tags.includes(value)) {
      setTags(workflowId, [...tags, value]);
    }
    setDraft("");
  }

  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      align="start"
      side="bottom"
      width={240}
    >
      <div
        className="gc-workflow-header__tags-popover"
        data-testid="workflow-header-tags-popover"
      >
        <div className="gc-workflow-header__tags-list" role="listbox">
          {availableTags.length === 0 && (
            <div className="gc-workflow-header__tags-empty">
              {t("workflowHeader.tags.noTags")}
            </div>
          )}
          {availableTags.map((name) => {
            const selected = tags.includes(name);
            return (
              <button
                type="button"
                key={name}
                className="gc-workflow-header__tag-row"
                role="option"
                aria-selected={selected}
                onClick={() => toggleTag(name)}
                data-testid={`workflow-header-tag-option-${name}`}
              >
                <Tag size="small" variant={selected ? "primary" : "default"}>
                  {name}
                </Tag>
                {selected && <Icon name="check" size={12} />}
              </button>
            );
          })}
        </div>

        <div className="gc-workflow-header__tags-create">
          <Input
            size="small"
            placeholder={t("workflowHeader.tags.createPlaceholder")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                createTag();
              }
            }}
            data-testid="workflow-header-tags-create-input"
          />
        </div>
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Right side: split Execute button
// ---------------------------------------------------------------------------

function WorkflowHeaderRight({ workflowId }: { workflowId: string }) {
  const { t } = useTranslation();
  const startRun = useRunStore((s) => s.startRun);
  const workflowName = useWorkflowStore(
    (s) => s.workflows[workflowId]?.name ?? "",
  );
  const [shareOpen, setShareOpen] = useState(false);

  function executeFresh() {
    startRun(workflowId, { useFreshData: true });
  }

  function executePinned() {
    startRun(workflowId, { usePinnedData: true });
  }

  return (
    <div
      className="gc-workflow-header__execute"
      role="group"
      aria-label={t("workflowHeader.execute.groupAria")}
      data-testid="workflow-header-execute"
    >
      <PresenceAvatars workflowId={workflowId} />
      <AutosaveIndicator workflowId={workflowId} />
      <Button
        variant="outline"
        size="small"
        iconLeft="share"
        onClick={() => setShareOpen(true)}
        aria-label={t("workflowHeader.share")}
        data-testid="workflow-header-share-btn"
      >
        {t("workflowHeader.share")}
      </Button>
      {shareOpen && (
        <ShareModal
          open={shareOpen}
          workflowId={workflowId}
          workflowName={workflowName}
          onClose={() => setShareOpen(false)}
        />
      )}
      <Button
        variant="success"
        size="small"
        iconLeft="play"
        onClick={executeFresh}
        className="gc-workflow-header__execute-main"
        data-testid="workflow-header-execute-main"
      >
        {t("workflowHeader.execute.label")}
      </Button>
      <DropdownMenu
        align="end"
        trigger={
          <button
            type="button"
            className="gc-workflow-header__execute-chevron"
            aria-label={t("workflowHeader.execute.menuAria")}
            data-testid="workflow-header-execute-chevron"
          >
            <Icon name="chevron-down" size={14} />
          </button>
        }
        items={[
          {
            id: "execute-fresh",
            label: t("workflowHeader.execute.label"),
            icon: "play",
            onSelect: executeFresh,
          },
          {
            id: "execute-pinned",
            label: t("workflowHeader.execute.pinnedLabel"),
            icon: "pin",
            onSelect: executePinned,
          },
        ]}
      />
    </div>
  );
}
