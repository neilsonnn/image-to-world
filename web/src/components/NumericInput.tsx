import { TextField } from "@radix-ui/themes";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export type NumericInputProps = {
  value: number | undefined;
  onCommit: (value: number) => void;
  onPreview?: (value: number | undefined) => void;
  label?: string;
  inlineLabel?: boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
};

function clamp(value: number, min?: number, max?: number) {
  return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));
}

export function NumericInput({
  value,
  onCommit,
  onPreview,
  label,
  inlineLabel = true,
  min,
  max,
  step = 0.05,
  placeholder = value === undefined ? "Mixed" : undefined,
  disabled,
}: NumericInputProps) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(draft);
  const editing = useRef(false);
  const start = useRef(value);
  const scrub = useRef<
    { pointer: number; x: number; value: number } | undefined
  >(undefined);

  useEffect(() => {
    if (!editing.current) {
      const text = value === undefined ? "" : String(Number(value.toFixed(4)));
      draftRef.current = text;
      setDraft(text);
    }
  }, [value]);

  const preview = (next: number) => {
    const text = String(Number(clamp(next, min, max).toFixed(6)));
    draftRef.current = text;
    setDraft(text);
    onPreview?.(Number(text));
  };
  const revert = () => {
    const original = start.current;
    const text =
      original === undefined ? "" : String(Number(original.toFixed(4)));
    draftRef.current = text;
    setDraft(text);
    editing.current = false;
    onPreview?.(undefined);
  };
  const commit = () => {
    if (!editing.current) return;
    const next = Number(draftRef.current);
    editing.current = false;
    if (draftRef.current.trim() && Number.isFinite(next))
      onCommit(clamp(next, min, max));
    else revert();
  };
  const begin = () => {
    if (!editing.current) {
      editing.current = true;
      start.current = value;
    }
  };
  const keyStep = (event: KeyboardEvent<HTMLInputElement>) => {
    const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
    return step * multiplier;
  };

  useEffect(() => {
    const cancelScrub = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !scrub.current) return;
      event.preventDefault();
      scrub.current = undefined;
      revert();
    };
    window.addEventListener("keydown", cancelScrub, true);
    return () => window.removeEventListener("keydown", cancelScrub, true);
  });

  return (
    <TextField.Root
      size="1"
      className="numeric-input"
      ref={inputRef}
      type="text"
      aria-label={label}
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={begin}
      onChange={(event) => {
        begin();
        draftRef.current = event.target.value;
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          event.currentTarget.select();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          revert();
          event.currentTarget.select();
          return;
        }
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        begin();
        const current = Number(draftRef.current);
        const base = Number.isFinite(current) ? current : (value ?? 0);
        preview(base + (event.key === "ArrowUp" ? 1 : -1) * keyStep(event));
      }}
      onKeyUp={(event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") commit();
      }}
    >
      {label && inlineLabel && (
        <TextField.Slot side="left">
          <span
            className="numeric-scrub-label"
            onPointerDown={(event) => {
              if (disabled || event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              begin();
              const initial = Number(draftRef.current);
              scrub.current = {
                pointer: event.pointerId,
                x: event.clientX,
                value: Number.isFinite(initial) ? initial : (value ?? 0),
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const active = scrub.current;
              if (!active || active.pointer !== event.pointerId) return;
              const modifier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
              preview(
                active.value + (event.clientX - active.x) * step * modifier,
              );
            }}
            onPointerUp={(event) => {
              if (scrub.current?.pointer !== event.pointerId) return;
              scrub.current = undefined;
              inputRef.current?.focus({ preventScroll: true });
              commit();
            }}
            onPointerCancel={() => {
              scrub.current = undefined;
              revert();
            }}
          >
            {label}
          </span>
        </TextField.Slot>
      )}
    </TextField.Root>
  );
}
