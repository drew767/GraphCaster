// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useVirtualList } from "../../hooks/useVirtualList";
import type { HistoryRunEvent } from "../../stores/historyStore";

type Props = {
  events: HistoryRunEvent[];
  currentIndex: number;
  onSeek: (index: number) => void;
  onStepForward: () => void;
  onStepBackward: () => void;
};

const EVENT_ROW_HEIGHT_PX = 28;
const RENDER_WINDOW_OVERSCAN = 10;
const VIRTUALIZE_THRESHOLD = 100;

export function EventTimeline({
  events,
  currentIndex,
  onSeek,
  onStepForward,
  onStepBackward,
}: Props) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);

  const shouldVirtualize = events.length >= VIRTUALIZE_THRESHOLD;

  const v = useVirtualList({
    itemCount: shouldVirtualize ? events.length : 0,
    itemHeight: EVENT_ROW_HEIGHT_PX,
    overscan: RENDER_WINDOW_OVERSCAN,
    estimatedViewportHeight: 360,
  });

  useEffect(() => {
    if (currentIndex < 0 || events.length === 0) {
      return;
    }
    if (shouldVirtualize) {
      v.scrollToIndex(currentIndex, "center");
      return;
    }
    const root = listRef.current;
    if (root != null) {
      const item = root.children[currentIndex] as HTMLElement | undefined;
      if (item != null && typeof item.scrollIntoView === "function") {
        item.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    // v is stable per-call but only its scrollToIndex matters; exclude to avoid resetting
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, events.length, shouldVirtualize]);

  const maxIdx = Math.max(0, events.length - 1);
  const safeIndex = Math.min(Math.max(0, currentIndex), maxIdx);

  return (
    <div className="gc-event-timeline">
      <div className="gc-event-timeline-controls">
        <button type="button" onClick={onStepBackward} disabled={safeIndex <= 0}>
          ← {t("app.runHistory.timelinePrev", { defaultValue: "Prev" })}
        </button>
        <span>
          {events.length === 0 ? "0" : safeIndex + 1} / {events.length}
        </span>
        <button type="button" onClick={onStepForward} disabled={events.length === 0 || safeIndex >= maxIdx}>
          {t("app.runHistory.timelineNext", { defaultValue: "Next" })} →
        </button>
      </div>

      <div className="gc-event-timeline-slider">
        <input
          type="range"
          min={0}
          max={maxIdx}
          value={events.length === 0 ? 0 : safeIndex}
          disabled={events.length === 0}
          onChange={(e) => onSeek(Number.parseInt(e.target.value, 10))}
          aria-label={t("app.runHistory.timelineSlider", { defaultValue: "Event index" })}
        />
      </div>

      {shouldVirtualize ? (
        <div
          ref={v.containerRef}
          className="gc-event-timeline-events gc-event-timeline-events--virtual"
          data-testid="gc-event-timeline-scroll"
          onScroll={v.onScroll}
          style={{ overflowY: "auto", position: "relative" }}
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
              {events.slice(v.startIndex, v.endIndex).map((event, i) => {
                const index = v.startIndex + i;
                return (
                  <TimelineRow
                    key={`${event.index}-${index}`}
                    event={event}
                    index={index}
                    current={index === safeIndex}
                    onSeek={onSeek}
                    rowHeight={EVENT_ROW_HEIGHT_PX}
                  />
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="gc-event-timeline-events" ref={listRef}>
          {events.map((event, index) => (
            <TimelineRow
              key={`${event.index}-${index}`}
              event={event}
              index={index}
              current={index === safeIndex}
              onSeek={onSeek}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type TimelineRowProps = {
  event: HistoryRunEvent;
  index: number;
  current: boolean;
  onSeek: (index: number) => void;
  rowHeight?: number;
};

function TimelineRow({ event, index, current, onSeek, rowHeight }: TimelineRowProps) {
  return (
    <div
      className={`gc-timeline-event${current ? " gc-timeline-event--current" : ""}`}
      data-testid="gc-timeline-event"
      role="button"
      tabIndex={0}
      style={rowHeight != null ? { height: rowHeight, boxSizing: "border-box" } : undefined}
      onClick={() => onSeek(index)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSeek(index);
        }
      }}
    >
      <span className="gc-timeline-event-index">{index}</span>
      <span className="gc-timeline-event-type">{event.type}</span>
      {event.nodeId != null && event.nodeId !== "" ? (
        <span className="gc-timeline-event-node">{event.nodeId}</span>
      ) : null}
      <span className="gc-timeline-event-time">{formatTime(event.timestamp)}</span>
    </div>
  );
}

function formatTime(isoString: string): string {
  if (isoString.trim() === "") {
    return "";
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return date.toLocaleTimeString();
}
