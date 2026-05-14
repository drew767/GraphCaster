// Copyright GraphCaster. All Rights Reserved.

import { useVirtualList } from "../../hooks/useVirtualList";
import type { RunEvent } from "./traceTree";

type Props = {
  events: RunEvent[];
};

const EVENT_ROW_HEIGHT_PX = 22;
const RENDER_WINDOW_OVERSCAN = 10;
const VIRTUALIZE_THRESHOLD = 100;

export function EventStream({ events }: Props) {
  const shouldVirtualize = events.length >= VIRTUALIZE_THRESHOLD;
  const v = useVirtualList({
    itemCount: shouldVirtualize ? events.length : 0,
    itemHeight: EVENT_ROW_HEIGHT_PX,
    overscan: RENDER_WINDOW_OVERSCAN,
    estimatedViewportHeight: 360,
  });

  if (events.length === 0) {
    return (
      <div className="gc-ri-empty" data-testid="gc-ri-events-empty">
        No raw events.
      </div>
    );
  }

  if (!shouldVirtualize) {
    return (
      <div className="gc-ri-event-stream" data-testid="gc-ri-event-stream">
        {events.map((ev, i) => (
          <pre key={i} className="gc-ri-event-stream__line" data-testid="gc-ri-event-stream-line">
            {JSON.stringify(ev)}
          </pre>
        ))}
      </div>
    );
  }

  const slice = events.slice(v.startIndex, v.endIndex);

  return (
    <div
      ref={v.containerRef}
      className="gc-ri-event-stream gc-ri-event-stream--virtual"
      data-testid="gc-ri-event-stream"
      onScroll={v.onScroll}
      style={{ overflowY: "auto", height: "100%", minHeight: 0 }}
    >
      <div style={{ position: "relative", height: v.totalHeight }}>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            transform: `translateY(${v.offsetTop}px)`,
          }}
        >
          {slice.map((ev, i) => (
            <pre
              key={v.startIndex + i}
              className="gc-ri-event-stream__line"
              data-testid="gc-ri-event-stream-line"
              style={{
                height: EVENT_ROW_HEIGHT_PX,
                overflow: "hidden",
                boxSizing: "border-box",
                margin: 0,
              }}
            >
              {JSON.stringify(ev)}
            </pre>
          ))}
        </div>
      </div>
    </div>
  );
}
