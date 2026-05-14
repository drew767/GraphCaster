// Copyright GraphCaster. All Rights Reserved.

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Button, Card, Heading, Text } from "../../components/ui";
import { EmptyState } from "../../components/ui/EmptyState/EmptyState";

// Inline data stubs — replaced when UX41/UX42 hooks land.

interface WorkflowStub {
  id: string;
  title: string;
  modifiedAt: string;
}

interface ExecutionStub {
  id: string;
  workflowTitle: string;
  status: string;
  startedAt: string;
}

function useWorkflowsData(): { workflows: WorkflowStub[]; loading: boolean } {
  return { workflows: [], loading: false };
}

function useExecutionsData(): { executions: ExecutionStub[]; loading: boolean } {
  return { executions: [], loading: false };
}

const SUGGESTED_TEMPLATES = [
  { key: "helloWorld", path: "/templates?tpl=hello-world" },
  { key: "httpTask", path: "/templates?tpl=http-task" },
  { key: "llmSummarize", path: "/templates?tpl=llm-summarize" },
] as const;

export default function HomeView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workflows } = useWorkflowsData();
  const { executions } = useExecutionsData();

  const recentWorkflows = workflows.slice(0, 5);
  const recentExecutions = executions.slice(0, 5);

  // Auto-redirect to new workflow when the user has none.
  useEffect(() => {
    if (workflows.length === 0) {
      // Only redirect after confirming the list is actually empty (not just loading).
      // Because useWorkflowsData returns loading=false and empty list immediately as a
      // stub, a brief delay avoids false redirects once real hooks are connected.
      // Real implementation: gate on `!loading`.
    }
  }, [workflows.length, navigate]);

  return (
    <div className="gc-home" data-testid="home-view">
      {/* Top bar */}
      <div className="gc-home__topbar">
        <Heading level={1} size="xl">
          {t("app.home.welcome")}
        </Heading>
        <Button
          variant="solid"
          size="medium"
          iconLeft="plus"
          onClick={() => navigate("/workflow/new")}
          data-testid="create-new-workflow"
        >
          {t("app.home.createNew")}
        </Button>
      </div>

      {/* 3-column grid */}
      <div className="gc-home__grid">
        {/* Recent workflows */}
        <Card variant="outlined" padding="medium">
          <Card.Header title={<Heading level={3} size="sm">{t("app.home.recentWorkflows")}</Heading>} />
          <Card.Body>
            {recentWorkflows.length === 0 ? (
              <EmptyState
                icon="workflow"
                title={t("app.empty.home.title")}
                description={t("app.empty.home.description")}
                action={{
                  label: t("app.empty.home.action"),
                  onClick: () => navigate("/workflow/new"),
                  variant: "outline",
                }}
                size="small"
              />
            ) : (
              <ul className="gc-home__item-list" aria-label={t("app.home.recentWorkflows")}>
                {recentWorkflows.map((wf) => (
                  <li key={wf.id} className="gc-home__item-list-entry">
                    <button
                      className="gc-home__item-link"
                      onClick={() => navigate(`/workflow/${wf.id}`)}
                      data-testid={`workflow-link-${wf.id}`}
                    >
                      <Text size="sm" weight="medium">{wf.title}</Text>
                      <Text size="xs" color="secondary">{t("app.home.modified")}: {wf.modifiedAt}</Text>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card.Body>
        </Card>

        {/* Recent executions */}
        <Card variant="outlined" padding="medium">
          <Card.Header title={<Heading level={3} size="sm">{t("app.home.recentExecutions")}</Heading>} />
          <Card.Body>
            {recentExecutions.length === 0 ? (
              <Text size="sm" color="secondary">{t("app.home.noRecentExecutions")}</Text>
            ) : (
              <ul className="gc-home__item-list" aria-label={t("app.home.recentExecutions")}>
                {recentExecutions.map((ex) => (
                  <li key={ex.id} className="gc-home__item-list-entry">
                    <Text size="sm" weight="medium">{ex.workflowTitle}</Text>
                    <Text size="xs" color="secondary">
                      {t("app.home.status")}: {ex.status} — {ex.startedAt}
                    </Text>
                  </li>
                ))}
              </ul>
            )}
          </Card.Body>
        </Card>

        {/* Suggested templates */}
        <Card variant="outlined" padding="medium">
          <Card.Header title={<Heading level={3} size="sm">{t("app.home.suggestedTemplates")}</Heading>} />
          <Card.Body>
            <ul className="gc-home__item-list" aria-label={t("app.home.suggestedTemplates")}>
              {SUGGESTED_TEMPLATES.map((tpl) => (
                <li key={tpl.key} className="gc-home__template-entry">
                  <div>
                    <Text size="sm" weight="medium">{t(`app.home.templateTitle.${tpl.key}`)}</Text>
                    <Text size="xs" color="secondary">{t(`app.home.templateDesc.${tpl.key}`)}</Text>
                  </div>
                  <Button
                    variant="ghost"
                    size="xsmall"
                    onClick={() => navigate(tpl.path)}
                    data-testid={`use-template-${tpl.key}`}
                  >
                    {t("app.home.useTemplate")}
                  </Button>
                </li>
              ))}
            </ul>
          </Card.Body>
        </Card>
      </div>
    </div>
  );
}
