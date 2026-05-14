// Copyright GraphCaster. All Rights Reserved.

export type HumanInputKind = "text" | "choice" | "approval" | "json";

export interface PausedRunItem {
  runId: string;
  graphId: string;
  pausedAtNode: string;
  prompt: string;
  kind: HumanInputKind;
  choices: string[] | null;
  pausedAt: string;
  timeoutSec: number;
}
