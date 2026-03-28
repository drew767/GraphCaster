// Copyright GraphCaster. All Rights Reserved.

export type GcCursorAgentCwdBase = "workspace_root" | "graphs_root" | "artifact_dir";

export function parseExtraArgsJson(text: string): string[] {
  const t = text.trim();
  if (t === "") {
    return [];
  }
  const parsed: unknown = JSON.parse(t);
  if (!Array.isArray(parsed)) {
    throw new Error("extraArgsMustBeArray");
  }
  return parsed.map((x) => String(x));
}

export function buildGcCursorAgentPayload(fields: {
  prompt: string;
  promptFile: string;
  cwdBase: GcCursorAgentCwdBase;
  cwdRelative: string;
  model: string;
  outputFormat: string;
  extraArgsJson: string;
  printMode: boolean;
  applyFileChanges: boolean;
}): Record<string, unknown> {
  const extraArgs = parseExtraArgsJson(fields.extraArgsJson);
  const out: Record<string, unknown> = {
    presetVersion: 1,
    cwdBase: fields.cwdBase,
    printMode: fields.printMode,
    applyFileChanges: fields.applyFileChanges,
  };
  if (fields.prompt.trim() !== "") {
    out.prompt = fields.prompt;
  }
  if (fields.promptFile.trim() !== "") {
    out.promptFile = fields.promptFile.trim();
  }
  if (fields.cwdRelative.trim() !== "") {
    out.cwdRelative = fields.cwdRelative.trim();
  }
  if (fields.model.trim() !== "") {
    out.model = fields.model.trim();
  }
  if (fields.outputFormat.trim() !== "") {
    out.outputFormat = fields.outputFormat.trim();
  }
  if (extraArgs.length > 0) {
    out.extraArgs = extraArgs;
  }
  return out;
}

export function cursorAgentUiValidationKey(fields: { prompt: string; promptFile: string }): string | null {
  if (fields.prompt.trim() === "" && fields.promptFile.trim() === "") {
    return "app.inspector.cursorAgentNeedPrompt";
  }
  return null;
}
