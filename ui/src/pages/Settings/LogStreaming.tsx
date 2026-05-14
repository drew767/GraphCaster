// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";

import {
  Button,
  ExternalLink,
  Heading,
  Input,
  Notice,
  Select,
  Text,
} from "../../components/ui";

const DOCS_URL = "https://graph-caster.example.com/docs/enterprise/log-streaming";

export default function LogStreamingPage() {
  const { t } = useTranslation();

  const destinationOptions = [
    { value: "datadog", label: t("app.settings.logStreaming.destinations.datadog") },
    { value: "splunk", label: t("app.settings.logStreaming.destinations.splunk") },
    { value: "elasticsearch", label: t("app.settings.logStreaming.destinations.elasticsearch") },
  ];

  return (
    <div data-testid="log-streaming-page">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <Heading level={2} size="xl">
          {t("app.settings.logStreaming.title")}
        </Heading>
      </div>

      <div style={{ marginBottom: 20 }}>
        <Notice type="info">
          <span data-testid="log-streaming-enterprise-notice">
            {t("app.settings.logStreaming.enterpriseNotice")}
          </span>
        </Notice>
      </div>

      <fieldset
        disabled
        aria-disabled="true"
        data-testid="log-streaming-form"
        style={{
          border: "1px solid var(--color--border, rgba(28,28,30,0.12))",
          borderRadius: "var(--radius--3xs, 6px)",
          padding: 20,
          background: "var(--color--surface--tint-1, rgba(28,28,30,0.02))",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          opacity: 0.7,
        }}
      >
        <legend
          style={{
            padding: "0 6px",
            fontSize: 13,
            color: "var(--color--text--tint-2, rgba(28,28,30,0.55))",
          }}
        >
          {t("app.settings.logStreaming.configurationLegend")}
        </legend>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size="sm" weight="medium">
            {t("app.settings.logStreaming.fields.destination")}
          </Text>
          <Select
            value="datadog"
            options={destinationOptions}
            disabled
            data-testid="log-streaming-destination"
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size="sm" weight="medium">
            {t("app.settings.logStreaming.fields.url")}
          </Text>
          <Input
            value=""
            placeholder={t("app.settings.logStreaming.fields.urlPlaceholder")}
            disabled
            data-testid="log-streaming-url"
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size="sm" weight="medium">
            {t("app.settings.logStreaming.fields.apiKey")}
          </Text>
          <Input
            type="password"
            value=""
            placeholder={t("app.settings.logStreaming.fields.apiKeyPlaceholder")}
            disabled
            data-testid="log-streaming-api-key"
          />
        </label>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="outline" size="small" disabled data-testid="log-streaming-test-btn">
            {t("app.settings.logStreaming.actions.test")}
          </Button>
          <Button variant="solid" size="small" disabled data-testid="log-streaming-save-btn">
            {t("app.settings.logStreaming.actions.save")}
          </Button>
        </div>
      </fieldset>

      <div style={{ marginTop: 18, display: "flex", gap: 16, alignItems: "center" }}>
        <ExternalLink href={DOCS_URL} data-testid="log-streaming-learn-more">
          {t("app.settings.logStreaming.actions.learnMore")}
        </ExternalLink>
        <span style={{ fontSize: 13, color: "var(--color--text--tint-2, rgba(28,28,30,0.55))" }}>
          {t("app.settings.logStreaming.contactSales")}
        </span>
      </div>
    </div>
  );
}
