// Copyright GraphCaster. All Rights Reserved.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../ui/Button/Button";
import { Tabs, type TabItem } from "../../ui/Tabs/Tabs";
import { SchemaView } from "../dataViews/SchemaView";
import { TableView } from "../dataViews/TableView";
import { JsonView } from "../dataViews/JsonView";
import { BinaryView, extractBinary, hasBinary } from "../dataViews/BinaryView";
import { ItemNavigator, useItemNavKeys } from "../dataViews/ItemNavigator";
import "../dataViews/dataViews.css";
import {
  NDV_DEFAULT_OUTPUT_VIEW,
  type NdvViewMode,
  useNdvStore,
} from "../useNdvStore";

export interface OutputViewProps {
  nodeId: string;
  data: unknown;
  pinned?: boolean;
  onTogglePin?: (next: boolean, data: unknown) => void;
  enableKeyNav?: boolean;
}

function asItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data === undefined) return [];
  return [data];
}

export function OutputView({
  nodeId,
  data,
  pinned = false,
  onTogglePin,
  enableKeyNav = true,
}: OutputViewProps) {
  const { t } = useTranslation();
  const view = useNdvStore((s) => s.outputView[nodeId] ?? NDV_DEFAULT_OUTPUT_VIEW);
  const setView = useNdvStore((s) => s.setOutputView);
  const itemIndex = useNdvStore(
    (s) => s.itemIndex[nodeId]?.output ?? 0,
  );
  const setItemIndex = useNdvStore((s) => s.setItemIndex);

  const items = useMemo(() => asItems(data), [data]);
  const safeIndex = Math.max(0, Math.min(itemIndex, Math.max(0, items.length - 1)));
  const current = items[safeIndex];
  const showBinary = hasBinary(current);

  useItemNavKeys(enableKeyNav, items.length, safeIndex, (next) =>
    setItemIndex(nodeId, "output", next),
  );

  const tabs: TabItem[] = [
    {
      id: "schema",
      label: t("app.ndv.output.view.schema"),
      content: <SchemaView data={current} />,
    },
    {
      id: "table",
      label: t("app.ndv.output.view.table"),
      content: <TableView data={Array.isArray(data) ? data : current} />,
    },
    {
      id: "json",
      label: t("app.ndv.output.view.json"),
      content: <JsonView data={current} />,
    },
  ];

  if (showBinary) {
    tabs.push({
      id: "binary",
      label: t("app.ndv.output.view.binary"),
      content: <BinaryView binary={extractBinary(current)} />,
    });
  }

  const effectiveView: NdvViewMode =
    view === "binary" && !showBinary ? "schema" : view;

  return (
    <div className="gc-ndv-view" data-testid="output-view">
      <div className="gc-ndv-view__header">
        <span className="gc-ndv-view__title">{t("app.ndv.output.title")}</span>
        <ItemNavigator
          count={items.length}
          index={safeIndex}
          onChange={(next) => setItemIndex(nodeId, "output", next)}
        />
        <div className="gc-ndv-view__spacer" />
        <Button
          variant="ghost"
          size="xsmall"
          iconLeft="pin"
          aria-label={pinned ? t("app.ndv.pin.unpin") : t("app.ndv.pin.pin")}
          title={pinned ? t("app.ndv.pin.unpin") : t("app.ndv.pin.pin")}
          data-pinned={pinned ? "true" : "false"}
          data-testid="output-pin-button"
          onClick={() => onTogglePin?.(!pinned, data)}
        />
      </div>
      <Tabs
        value={effectiveView}
        onValueChange={(v) => setView(nodeId, v as NdvViewMode)}
        items={tabs}
        size="small"
        variant="underline"
      />
    </div>
  );
}
