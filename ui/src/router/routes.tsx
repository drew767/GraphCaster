// Copyright GraphCaster. All Rights Reserved.

import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Loading } from "../components/ui";

const HomeView = lazy(() => import("../pages/Home/Home"));
const WorkflowsView = lazy(() => import("../pages/Workflows/Workflows"));
const WorkflowEditorView = lazy(() => import("../pages/Workflow/WorkflowEditor"));
const ExecutionsView = lazy(() => import("../pages/Executions/Executions"));
const SingleExecutionView = lazy(() => import("../pages/Executions/SingleExecution"));
const TemplatesView = lazy(() =>
  import("../pages/Templates/TemplatesPage").then((m) => ({ default: m.TemplatesPage }))
);
const NotFoundView = lazy(() => import("../pages/errors/NotFound"));
const EntityNotFoundView = lazy(() => import("../pages/errors/EntityNotFound"));
const UnauthorizedView = lazy(() => import("../pages/errors/Unauthorized"));

const SigninView = lazy(() => import("../pages/Auth/Signin"));
const SignupView = lazy(() => import("../pages/Auth/Signup"));
const SignoutView = lazy(() => import("../pages/Auth/Signout"));
const ForgotPasswordView = lazy(() => import("../pages/Auth/ForgotPassword"));
const ChangePasswordView = lazy(() => import("../pages/Auth/ChangePassword"));
const SetupView = lazy(() => import("../pages/Auth/Setup"));

const CredentialsView = lazy(() => import("../pages/Credentials/Credentials"));

const SettingsPage = lazy(() => import("../pages/Settings/Settings"));
const PersonalPage = lazy(() => import("../pages/Settings/Personal"));
const ApiKeysPage = lazy(() => import("../pages/Settings/ApiKeys"));
const ExternalSecretsPage = lazy(() => import("../pages/Settings/ExternalSecrets"));
const CommunityNodesPage = lazy(() => import("../pages/Settings/CommunityNodes"));
const UsersPage = lazy(() => import("../pages/Settings/Users"));
const SourceControlPage = lazy(() => import("../pages/Settings/SourceControl"));
const SsoPage = lazy(() => import("../pages/Settings/Sso"));
const AuditLogPage = lazy(() => import("../pages/Settings/AuditLog"));
const VariablesPage = lazy(() => import("../pages/Settings/Variables"));
const LogStreamingPage = lazy(() => import("../pages/Settings/LogStreaming"));
const WorkerViewPage = lazy(() => import("../pages/Settings/WorkerView"));
const EnvironmentsPage = lazy(() => import("../pages/Settings/Environments"));

const StubSettingsPageLazy = lazy(() =>
  import("../pages/Settings/StubSettingsPage").then((m) => ({ default: m.StubSettingsPage }))
);

const ProjectsView = lazy(() => import("../pages/Projects/Projects"));
const ProjectDetailsView = lazy(() => import("../pages/Projects/ProjectDetails"));

function Stub({ title }: { title: string }) {
  return (
    <Suspense fallback={<Loading />}>
      <StubSettingsPageLazy title={title} />
    </Suspense>
  );
}

export function AppRoutes() {
  return (
    <Suspense fallback={<Loading variant="fullscreen" />}>
      <Routes>
        <Route path="/" element={<Navigate to="/home/workflows" replace />} />
        <Route path="/home" element={<Navigate to="/home/workflows" replace />} />
        <Route path="/home/workflows" element={<WorkflowsView />} />
        <Route path="/home/workflows/folder/*" element={<WorkflowsView />} />
        <Route path="/workflow/:graphId" element={<WorkflowEditorView />} />
        <Route path="/workflow/new" element={<WorkflowEditorView />} />
        <Route path="/home/executions" element={<ExecutionsView />} />
        <Route path="/home/executions/:runId" element={<SingleExecutionView />} />
        <Route path="/templates" element={<TemplatesView />} />
        <Route path="/home/credentials" element={<CredentialsView />} />

        <Route path="/settings" element={<Navigate to="/settings/personal" replace />} />
        <Route path="/settings/*" element={<SettingsPage />}>
          <Route path="personal" element={<PersonalPage />} />
          <Route path="api-keys" element={<ApiKeysPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="external-secrets" element={<ExternalSecretsPage />} />
          <Route path="community-nodes" element={<CommunityNodesPage />} />
          <Route path="source-control" element={<SourceControlPage />} />
          <Route path="sso" element={<SsoPage />} />
          <Route path="audit" element={<AuditLogPage />} />
          <Route path="variables" element={<VariablesPage />} />
          <Route path="environments" element={<EnvironmentsPage />} />
          <Route path="log-streaming" element={<LogStreamingPage />} />
          <Route path="workers" element={<WorkerViewPage />} />
          <Route path="about" element={<Stub title="About" />} />
        </Route>

        {/* Auth */}
        <Route path="/signin" element={<SigninView />} />
        <Route path="/signup" element={<SignupView />} />
        <Route path="/signout" element={<SignoutView />} />
        <Route path="/forgot-password" element={<ForgotPasswordView />} />
        <Route path="/change-password" element={<ChangePasswordView />} />
        <Route path="/setup" element={<SetupView />} />

        {/* Projects */}
        <Route path="/projects" element={<ProjectsView />} />
        <Route path="/projects/:projectId" element={<ProjectDetailsView />} />

        {/* Named error pages */}
        <Route path="/entity-not-found" element={<EntityNotFoundView />} />
        <Route path="/unauthorized" element={<UnauthorizedView />} />

        <Route path="*" element={<NotFoundView />} />
      </Routes>
    </Suspense>
  );
}
