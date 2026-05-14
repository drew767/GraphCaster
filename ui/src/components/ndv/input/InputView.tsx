// Copyright GraphCaster. All Rights Reserved.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Tabs, type TabItem } from "../../ui/Tabs/Tabs";
import { SchemaView } from "../dataViews/SchemaView";
import { TableView } from "../dataViews/TableView";
import { JsonView } from "../dataViews/JsonView";
import { ItemNavigator, useItemNavKeys } from "../dataViews/ItemNavigator";
import "../dataViews/dataViews.css";
import {
  NDV_DEFAULT_INPUT_VIEW,
  type NdvViewMode,
  useNdvStore,
} from "../useNdvStore";

export interface InputViewProps {
  nodeId: string;
  data: unknown;
  /** When true, [/] keys navigate between items. Default: true. */
  enableKeyNav?: boolean;
  /**
   * When set, schema rows become draggable so users can map fields onto
   * parameter inputs. The value is the upstream node display name and is
   * used to build `$('<sourceNodeName>').item.json.<path>` expressions.
   */
  sourceNodeName?: string;
}

function asItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data === undefined) return [];
  return [data];
}

export function InputView({
  nodeId,
  data,
  enableKeyNav = true,
  sourceNodeName,
}: InputViewProps) {
  const { t } = useTranslation();
  const view = useNdvStore((s) => s.inputView[nodeId] ?? NDV_DEFAULT_INPUT_VIEW);
  const setView = useNdvStore((s) => s.setInputView);
  const itemIndex = useNdvStore(
    (s) => s.itemIndex[nodeId]?.input ?? 0,
  );
  const setItemIndex = useNdvStore((s) => s.setItemIndex);

  const items = useMemo(() => asItems(data), [data]);
  const safeIndex = Math.max(0, Math.min(itemIndex, Math.max(0, items.length - 1)));
  const current = items[safeIndex];

  useItemNavKeys(enableKeyNav, items.length, safeIndex, (next) =>
    setItemIndex(nodeId, "input", next),
  );

  const tabs: TabItem[] = [
    {
      id: "schema",
      label: t("app.ndv.input.view.schema"),
      content: <SchemaView data={current} sourceNodeName={sourceNodeName} />,
    },
    {
      id: "table",
      label: t("app.ndv.input.view.table"),
      content: <TableView data={Array.isArray(data) ? data : current} />,
    },
    {
      id: "json",
      label: t("app.ndv.input.view.json"),
      content: <JsonView data={current} />,
    },
  ];

  return (
    <div className="gc-ndv-view" data-testid="input-view">
      <div className="gc-ndv-view__header">
        <span className="gc-ndv-view__title">{t("app.ndv.input.title")}</span>
        <ItemNavigator
          count={items.length}
          index={safeIndex}
          onChange={(next) => setItemIndex(nodeId, "input", next)}
        />
      </div>
      <Tabs
        value={view}
        onValueChange={(v) => setView(nodeId, v as NdvViewMode)}
        items={tabs}
        size="small"
        variant="underline"
      />
    </div>
  );
}
