"use client";

import { useLayoutEffect, useRef, useState } from "react";

export const WIDGET_CANVAS_WIDTH = 1920;
export const WIDGET_CANVAS_HEIGHT = 1080;

export function useFixedWidgetCanvasScale() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const updateScale = () => {
      const nextScale = Math.min(
        viewport.clientWidth / WIDGET_CANVAS_WIDTH,
        viewport.clientHeight / WIDGET_CANVAS_HEIGHT,
      );

      setScale(
        Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1,
      );
    };

    updateScale();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateScale();
          });

    resizeObserver?.observe(viewport);
    window.addEventListener("resize", updateScale);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, []);

  return {
    viewportRef,
    scale,
    scaledWidth: WIDGET_CANVAS_WIDTH * scale,
    scaledHeight: WIDGET_CANVAS_HEIGHT * scale,
  };
}
