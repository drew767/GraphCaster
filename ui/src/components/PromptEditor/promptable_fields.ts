// Copyright GraphCaster. All Rights Reserved.

/**
 * Frontend mapping of (nodeType → field names) that should render as PromptEditor
 * instead of a plain <textarea>. Until backend schemas declare x-prompt, this
 * hardcoded list controls which inspector fields get the full Monaco prompt editor.
 */
export const PROMPTABLE_FIELDS: Record<string, string[]> = {
  prompt_concat: ["template"],
  llm_agent: ["systemPrompt"],
  agent: ["systemPrompt"],
  ai_route: ["systemPrompt"],
};

export function isPromptableField(nodeType: string, fieldName: string): boolean {
  return (PROMPTABLE_FIELDS[nodeType] ?? []).includes(fieldName);
}
