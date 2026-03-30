// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { HistoryRunEvent } from "../../stores/historyStore";

type Props = {
  events: HistoryRunEvent[];
  currentIndex: number;
  onSeek: (index: number) => void;
  onStepForward: () => void;
  onStepBackward: () => void;
};

export function EventTimeline({
  events,
  currentIndex,
  onSeek,
  onStepForward,
  onStepBackward,
}: Props) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current && currentIndex >= 0 && events.length > 0) {
      const item = listRef.current.children[currentIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentIndex, events.length]);

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

      <div className="gc-event-timeline-events" ref={listRef}>
        {events.map((event, index) => (
          <div
            key={`${event.index}-${index}`}
            className={`gc-timeline-event${index === safeIndex ? " gc-timeline-event--current" : ""}`}
            role="button"
            tabIndex={0}
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
        ))}
      </div>
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
