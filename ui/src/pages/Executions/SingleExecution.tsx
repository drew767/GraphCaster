// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ExecutionCanvas } from "./ExecutionCanvas";
import { ExecutionHeader, type HeaderHandlers } from "./ExecutionHeader";
import { ExecutionNodeList } from "./ExecutionNodeList";
import { NdvReadOnly } from "./NdvReadOnly";
import { RawRunModal } from "./RawRunModal";
import {
  executionsApi as defaultExecutionsApi,
  type ExecutionPayload,
  type ExecutionsApi,
  type ExecutionNodePayload,
} from "./executionsApi";
import { useParams } from "./useParams";

type Props = {
  runIdOverride?: string;
  apiOverride?: ExecutionsApi;
  payloadOverride?: ExecutionPayload | null;
  handlersOverride?: HeaderHandlers;
};

export function SingleExecution({
  runIdOverride,
  apiOverride,
  payloadOverride,
  handlersOverride,
}: Props = {}) {
  const { t } = useTranslation();
  const params = useParams(runIdOverride ? { runId: runIdOverride } : undefined);
  const runId = runIdOverride ?? params.runId ?? "";
  const api = apiOverride ?? defaultExecutionsApi;

  const [execution, setExecution] = useState<ExecutionPayload | null>(payloadOverride ?? null);
  const [loading, setLoading] = useState<boolean>(payloadOverride === undefined && !!runId);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (payloadOverride !== undefined) {
      setExecution(payloadOverride);
      setLoading(false);
      return;
    }
    let cancelled = false;
    if (!runId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .getExecution(runId)
      .then((data) => {
        if (cancelled) return;
        setExecution(data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setExecution(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, api, payloadOverride]);

  const selectedNode: ExecutionNodePayload | null = useMemo(() => {
    if (!execution || !selectedNodeId) {
      return null;
    }
    return execution.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [execution, selectedNodeId]);

  const handlers: HeaderHandlers = {
    ...(handlersOverride ?? {}),
    onShowRaw: handlersOverride?.onShowRaw ?? (() => setRawOpen(true)),
  };

  if (loading) {
    return (
      <div className="gc-exec-page gc-exec-page--loading" data-testid="gc-exec-page">
        <p>{t("executions.detail.loading")}</p>
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="gc-exec-page gc-exec-page--empty" data-testid="gc-exec-page">
        <p>{t("executions.detail.notFound", { runId })}</p>
      </div>
    );
  }

  const handleSelectNode = (id: string) => {
    setSelectedNodeId(id);
    setDrawerOpen(true);
  };

  return (
    <div
      className="gc-exec-page"
      data-testid="gc-exec-page"
      style={{
        display: "grid",
        gridTemplateRows: "auto 1fr",
        gridTemplateColumns: "1fr",
        height: "100%",
        minHeight: 0,
      }}
    >
      <div style={{ position: "sticky", top: 0, zIndex: 5 }}>
        <ExecutionHeader execution={execution} handlers={handlers} />
      </div>
      <div
        className="gc-exec-page__body"
        style={{
          display: "grid",
          gridTemplateColumns: drawerOpen ? "280px 1fr 720px" : "280px 1fr",
          minHeight: 0,
          height: "100%",
        }}
      >
        <ExecutionNodeList
          nodes={execution.nodes}
          selectedNodeId={selectedNodeId}
          onSelect={handleSelectNode}
        />
        <ExecutionCanvas
          execution={execution}
          selectedNodeId={selectedNodeId}
          onSelectNode={handleSelectNode}
        />
        <NdvReadOnly
          node={selectedNode}
          open={drawerOpen && !!selectedNode}
          onClose={() => setDrawerOpen(false)}
        />
      </div>
      <RawRunModal
        open={rawOpen}
        onClose={() => setRawOpen(false)}
        payload={execution}
      />
    </div>
  );
}

export default SingleExecution;
