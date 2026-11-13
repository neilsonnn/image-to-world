import {
  useEffect,
  useMemo,
  useRef,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Handler = (event: KeyboardEvent) => void;

const handlers = new Map<
  string,
  { handler: Handler; duringGesture: boolean }
>();
const globalHandlers = new Set<Handler>();
let hoveredPane: string | null = null;
let focusedPane: string | null = null;
let gesturePane: string | null = null;
let listening = false;

function keyboardIsOwned(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
    return true;
  const target = event.target instanceof Element ? event.target : null;
  if (
    target?.closest(
      "input, textarea, select, [role=slider], [role=spinbutton], [contenteditable]:not([contenteditable='false'])",
    )
  )
    return true;
  return Boolean(
    document.querySelector(
      "dialog[open], [role='dialog'], [role='menu'], [data-radix-menu-content], [role='listbox'][data-state='open']",
    ),
  );
}

function routeKeyDown(event: KeyboardEvent) {
  if (keyboardIsOwned(event)) return;
  const pane = gesturePane ?? hoveredPane ?? focusedPane;
  const entry = pane ? handlers.get(pane) : undefined;
  if (gesturePane && event.key !== "Escape" && !entry?.duringGesture) return;
  entry?.handler(event);
  if (!event.defaultPrevented || event.key === "Escape")
    for (const handler of globalHandlers) handler(event);
  if (event.key === "Escape" && gesturePane === pane) gesturePane = null;
}

function clearHover(event: MouseEvent) {
  if (!event.relatedTarget) hoveredPane = null;
}

function clearWindowState() {
  hoveredPane = null;
  gesturePane = null;
}

function releaseGesture() {
  gesturePane = null;
}

function startListening() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("keydown", routeKeyDown);
  document.addEventListener("mouseout", clearHover);
  window.addEventListener("blur", clearWindowState);
  window.addEventListener("pointerup", releaseGesture);
  window.addEventListener("pointercancel", releaseGesture);
  window.addEventListener("dragend", releaseGesture);
}

function stopListening() {
  if (!listening || handlers.size || globalHandlers.size) return;
  listening = false;
  document.removeEventListener("keydown", routeKeyDown);
  document.removeEventListener("mouseout", clearHover);
  window.removeEventListener("blur", clearWindowState);
  window.removeEventListener("pointerup", releaseGesture);
  window.removeEventListener("pointercancel", releaseGesture);
  window.removeEventListener("dragend", releaseGesture);
}

export function useGlobalShortcuts(handler: Handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const route = (event: KeyboardEvent) => handlerRef.current(event);
    globalHandlers.add(route);
    startListening();
    return () => {
      globalHandlers.delete(route);
      stopListening();
    };
  }, []);
}

export function claimPaneShortcutGesture(id: string) {
  gesturePane = id;
}

export function releasePaneShortcutGesture(id?: string) {
  if (!id || gesturePane === id) gesturePane = null;
}

/**
 * Registers one pane with the document shortcut router. Spread the returned
 * props onto the pane root; handlers must preventDefault for consumed keys.
 */
export function usePaneShortcuts(
  id: string,
  handler: Handler,
  duringGesture = false,
) {
  const handlerRef = useRef(handler);
  const elementRef = useRef<HTMLElement | null>(null);
  handlerRef.current = handler;

  useEffect(() => {
    handlers.set(id, {
      handler: (event) => handlerRef.current(event),
      duringGesture,
    });
    startListening();
    return () => {
      handlers.delete(id);
      if (hoveredPane === id) hoveredPane = null;
      if (focusedPane === id) focusedPane = null;
      if (gesturePane === id) gesturePane = null;
      stopListening();
    };
  }, [id, duringGesture]);

  return useMemo(
    () => ({
      ref: (element: HTMLElement | null) => {
        elementRef.current = element;
      },
      "data-pane-shortcuts": id,
      onPointerEnter: () => {
        hoveredPane = id;
      },
      onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => {
        if (
          hoveredPane === id &&
          !(
            event.relatedTarget instanceof Node &&
            elementRef.current?.contains(event.relatedTarget)
          )
        )
          hoveredPane = null;
      },
      onPointerDownCapture: () => {
        gesturePane = id;
      },
      onFocusCapture: () => {
        focusedPane = id;
      },
      onBlurCapture: (event: ReactFocusEvent<HTMLElement>) => {
        if (!(
          event.relatedTarget instanceof Node &&
          elementRef.current?.contains(event.relatedTarget)
        )) {
          if (focusedPane === id) focusedPane = null;
        }
      },
    }),
    [id],
  );
}
