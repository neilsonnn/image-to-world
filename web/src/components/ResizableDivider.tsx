import { useEffect, useRef } from "react";

type ResizableDividerProps = {
  label: string;
  orientation: "horizontal" | "vertical";
  value: number;
  min: number;
  max: number;
  step: number;
  pointerValue: (
    startValue: number,
    startPosition: number,
    currentPosition: number,
  ) => number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ResizableDivider({
  label,
  orientation,
  value,
  min,
  max,
  step,
  pointerValue,
  onPreview,
  onCommit,
}: ResizableDividerProps) {
  const dragRef = useRef<{
    pointerId: number;
    startPosition: number;
    startValue: number;
    previewValue: number;
    target: HTMLDivElement;
  } | null>(null);

  const cancelDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    onPreview(drag.startValue);
    if (drag.target.hasPointerCapture(drag.pointerId))
      drag.target.releasePointerCapture(drag.pointerId);
    dragRef.current = null;
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !dragRef.current) return;
      event.preventDefault();
      cancelDrag();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  });

  const position = (event: React.PointerEvent) =>
    orientation === "vertical" ? event.clientX : event.clientY;

  const commitKeyboardValue = (next: number) => {
    const clamped = clamp(next, min, max);
    onPreview(clamped);
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <div
      className={`panel-divider panel-divider-${orientation}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value * 1000) / 1000}
      tabIndex={0}
      onKeyDown={(event) => {
        const decrease = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
        const increase =
          orientation === "vertical" ? "ArrowRight" : "ArrowDown";
        if (event.key === decrease) {
          event.preventDefault();
          commitKeyboardValue(value - step);
        } else if (event.key === increase) {
          event.preventDefault();
          commitKeyboardValue(value + step);
        } else if (event.key === "Home") {
          event.preventDefault();
          commitKeyboardValue(min);
        } else if (event.key === "End") {
          event.preventDefault();
          commitKeyboardValue(max);
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          startPosition: position(event),
          startValue: value,
          previewValue: value,
          target: event.currentTarget,
        };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const next = clamp(
          pointerValue(drag.startValue, drag.startPosition, position(event)),
          min,
          max,
        );
        drag.previewValue = next;
        onPreview(next);
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current = null;
        if (drag.previewValue !== drag.startValue) onCommit(drag.previewValue);
      }}
      onPointerCancel={cancelDrag}
    />
  );
}
