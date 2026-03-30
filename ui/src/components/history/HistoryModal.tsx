// Copyright GraphCaster. All Rights Reserved.

import { RunHistoryModal } from "../RunHistoryModal";

export type HistoryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  artifactsBase: string;
  graphId: string;
};

/** Thin alias for the run-history dialog (`open` prop maps from `isOpen`). */
export function HistoryModal({ isOpen, onClose, artifactsBase, graphId }: HistoryModalProps) {
  return (
    <RunHistoryModal open={isOpen} onClose={onClose} artifactsBase={artifactsBase} graphId={graphId} />
  );
}
