// Copyright GraphCaster. All Rights Reserved.

import type { IconName } from "../../components/ui/Icon/registry";

export interface CredentialField {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  placeholder?: string;
  required?: boolean;
}

export interface CredentialTypeDefinition {
  type: string;
  label: string;
  icon: IconName;
  description: string;
  fields: CredentialField[];
  isOAuth?: boolean;
}

export const CREDENTIAL_TYPES: CredentialTypeDefinition[] = [
  {
    type: "openai",
    label: "OpenAI",
    icon: "sparkles",
    description: "Connect to OpenAI API",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", placeholder: "sk-…", required: true },
      { key: "baseUrl", label: "Base URL", type: "url", placeholder: "https://api.openai.com/v1" },
    ],
  },
  {
    type: "anthropic",
    label: "Anthropic",
    icon: "anthropic",
    description: "Connect to Anthropic Claude API",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", placeholder: "sk-ant-…", required: true },
    ],
  },
  {
    type: "slack",
    label: "Slack",
    icon: "message-square",
    description: "Connect to Slack workspace",
    fields: [
      { key: "botToken", label: "Bot Token", type: "password", placeholder: "xoxb-…", required: true },
      { key: "signingSecret", label: "Signing Secret", type: "password" },
    ],
    isOAuth: true,
  },
  {
    type: "github",
    label: "GitHub",
    icon: "git-branch",
    description: "Connect to GitHub API",
    fields: [
      { key: "token", label: "Personal Access Token", type: "password", placeholder: "ghp_…", required: true },
    ],
    isOAuth: true,
  },
  {
    type: "generic-api-key",
    label: "Generic API Key",
    icon: "key-round",
    description: "Generic API key for any service",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", required: true },
      { key: "headerName", label: "Header name", type: "text", placeholder: "X-Api-Key" },
    ],
  },
  {
    type: "basic-auth",
    label: "Basic Auth",
    icon: "user-lock",
    description: "Username and password credentials",
    fields: [
      { key: "username", label: "Username", type: "text", required: true },
      { key: "password", label: "Password", type: "password", required: true },
    ],
  },
  {
    type: "bearer",
    label: "Bearer Token",
    icon: "shield",
    description: "Bearer token for Authorization header",
    fields: [
      { key: "token", label: "Token", type: "password", required: true },
    ],
  },
  {
    type: "aws",
    label: "AWS",
    icon: "cloud",
    description: "AWS access credentials",
    fields: [
      { key: "accessKeyId", label: "Access Key ID", type: "text", required: true },
      { key: "secretAccessKey", label: "Secret Access Key", type: "password", required: true },
      { key: "region", label: "Region", type: "text", placeholder: "us-east-1" },
    ],
  },
  {
    type: "database",
    label: "Database",
    icon: "database",
    description: "Database connection credentials",
    fields: [
      { key: "host", label: "Host", type: "text", placeholder: "localhost", required: true },
      { key: "port", label: "Port", type: "text", placeholder: "5432" },
      { key: "database", label: "Database", type: "text", required: true },
      { key: "username", label: "Username", type: "text", required: true },
      { key: "password", label: "Password", type: "password" },
    ],
  },
  {
    type: "custom",
    label: "Custom",
    icon: "wrench",
    description: "Custom credential with free-form fields",
    fields: [],
  },
];

export const CREDENTIAL_TYPE_MAP = new Map<string, CredentialTypeDefinition>(
  CREDENTIAL_TYPES.map((t) => [t.type, t]),
);

export function getCredentialTypeIcon(type: string): IconName {
  return CREDENTIAL_TYPE_MAP.get(type)?.icon ?? "key-round";
}

export function getCredentialTypeLabel(type: string): string {
  return CREDENTIAL_TYPE_MAP.get(type)?.label ?? type;
}
