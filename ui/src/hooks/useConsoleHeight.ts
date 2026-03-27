// Copyright Aura. All Rights Reserved.

import { useCallback, useEffect, useRef, useState } from "react";

const MIN_H = 96;
const MAX_FRAC = 0.55;

export function useConsoleHeight(initial: number) {
  const [height, setHeight] = useState(initial);
  const dragging = useRef(false);

  const onMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) {
      return;
    }
    const fromBottom = window.innerHeight - e.clientY;
    const maxH = window.innerHeight * MAX_FRAC;
    setHeight(Math.min(Math.max(fromBottom, MIN_H), maxH));
  }, []);

  const onUp = useCallback(() => {
    dragging.current = false;
    document.body.style.cursor = "";
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onMove, onUp]);

  const startDrag = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = "row-resize";
  }, []);

  return { height, startDrag };
}
