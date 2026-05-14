// Copyright GraphCaster. All Rights Reserved.

import React, { useEffect, useState } from "react";

import type { CollabAwarenessState } from "./awareness";
import type { CollabProvider } from "./yjs_provider";

interface Props {
  provider: CollabProvider;
  localUserId: string;
}

export function CollaboratorAvatars({ provider, localUserId }: Props): React.ReactElement {
  const [peers, setPeers] = useState<CollabAwarenessState[]>([]);

  useEffect(() => {
    function onAwareness(): void {
      const next: CollabAwarenessState[] = [];
      provider.awareness.states.forEach((state, clientId) => {
        if (clientId === provider.awareness.clientId) return;
        if (state && state.userId && state.userId !== localUserId) {
          next.push(state as CollabAwarenessState);
        }
      });
      setPeers(next);
    }

    provider.awareness.listeners.add(onAwareness);
    return () => {
      provider.awareness.listeners.delete(onAwareness);
    };
  }, [provider, localUserId]);

  if (peers.length === 0) return <></>;

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        display: "flex",
        flexDirection: "row",
        gap: 4,
        zIndex: 100,
      }}
    >
      {peers.map((peer) => (
        <Avatar key={peer.userId} state={peer} />
      ))}
    </div>
  );
}

function Avatar({ state }: { state: CollabAwarenessState }): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const initial = (state.name ?? state.userId ?? "?")[0]?.toUpperCase() ?? "?";
  const color = state.color ?? "#6366f1";

  return (
    <div
      title={state.name ?? state.userId}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: 12,
        fontWeight: 700,
        cursor: "default",
        userSelect: "none",
        border: "2px solid #fff",
        boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
      }}
    >
      {initial}
      {hovered && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 4px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.75)",
            color: "#fff",
            fontSize: 11,
            padding: "2px 6px",
            borderRadius: 4,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {state.name ?? state.userId}
        </div>
      )}
    </div>
  );
}
