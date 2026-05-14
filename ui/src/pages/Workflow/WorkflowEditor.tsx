// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { AppShell } from "../../layout/AppShell";
import { WorkflowHeader } from "./WorkflowHeader";
import { useAiContextStore } from "../../app/stores/aiContextStore";
import { useWorkflowStore } from "../../app/stores/workflowStore";

export default function WorkflowEditorView() {
  const { i18n } = useTranslation();
  const { graphId } = useParams<{ graphId?: string }>();
  const workflowName = useWorkflowStore((s) =>
    graphId ? s.workflows[graphId]?.name ?? "" : "",
  );
  const setWorkflowContext = useAiContextStore((s) => s.setWorkflowContext);
  const clearContext = useAiContextStore((s) => s.clearContext);

  useEffect(() => {
    if (graphId) {
      setWorkflowContext(workflowName || graphId);
    }
    return () => clearContext();
  }, [graphId, workflowName, setWorkflowContext, clearContext]);

  const onLangChange = useCallback(
    (lng: string) => {
      void i18n.changeLanguage(lng);
    },
    [i18n],
  );

  return (
    <>
      {graphId && <WorkflowHeader workflowId={graphId} />}
      <AppShell onLangChange={onLangChange} />
    </>
  );
}
