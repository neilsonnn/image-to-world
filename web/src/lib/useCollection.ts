import { useCallback, useRef, type MouseEvent as ReactMouseEvent } from "react";
import {
  moveInGrid,
  moveInList,
  selectItem,
  type GridItem,
  type SelectionState,
} from "../../../core/selection";
import { usePaneShortcuts } from "./shortcuts";

type CollectionOptions = {
  id: string;
  visibleIds: string[];
  selection: SelectionState;
  layout?: "list" | "grid";
  onSelectionChange: (selection: SelectionState) => unknown | Promise<unknown>;
  onOpen?: (id: string) => void;
  onNavigate?: (id: string) => void;
  onRename?: (id: string) => void;
  onDelete?: () => void;
  onMoveToParent?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onDuplicate?: () => void;
  onLeft?: (id: string) => string | null | undefined;
  onRight?: (id: string) => string | null | undefined;
  onEscape?: () => void;
};

export function useCollection({
  id,
  visibleIds,
  selection,
  layout = "list",
  onSelectionChange,
  onOpen,
  onNavigate,
  onRename,
  onDelete,
  onMoveToParent,
  onUndo,
  onRedo,
  onDuplicate,
  onLeft,
  onRight,
  onEscape,
}: CollectionOptions) {
  const itemElements = useRef(new Map<string, HTMLElement>());
  const pending = useRef(0);
  const selectionRef = useRef(selection);
  if (!pending.current) selectionRef.current = selection;
  const navigationId = () => {
    const current = selectionRef.current;
    return current.primaryId && visibleIds.includes(current.primaryId)
      ? current.primaryId
      : (visibleIds.find((candidate) => current.ids.includes(candidate)) ??
          null);
  };
  const currentId = navigationId();

  const commit = useCallback(
    (next: SelectionState, focus = false) => {
      selectionRef.current = next;
      pending.current += 1;
      void Promise.resolve(onSelectionChange(next)).finally(() => {
        pending.current -= 1;
      });
      if (!focus || !next.primaryId) return;
      requestAnimationFrame(() => {
        const element = itemElements.current.get(next.primaryId!);
        element?.focus({ preventScroll: true });
        element?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    },
    [onSelectionChange],
  );

  const moveTo = useCallback(
    (targetId: string | null, extend: boolean) => {
      if (!targetId) return;
      onNavigate?.(targetId);
      commit(
        selectItem(selectionRef.current, visibleIds, targetId, {
          range: extend,
        }),
        true,
      );
    },
    [commit, selection, visibleIds, onNavigate],
  );

  const shortcutProps = usePaneShortcuts(id, (event) => {
    const currentId = navigationId();
    const toggle = event.metaKey || event.ctrlKey;
    if (toggle && event.key.toLowerCase() === "z" && (onUndo || onRedo)) {
      event.preventDefault();
      if (event.shiftKey) onRedo?.();
      else onUndo?.();
      return;
    }
    if (toggle && event.key.toLowerCase() === "d" && onDuplicate) {
      event.preventDefault();
      onDuplicate();
      return;
    }
    const direction =
      event.key === "ArrowUp"
        ? "previous"
        : event.key === "ArrowDown"
          ? "next"
          : null;
    if (direction) {
      event.preventDefault();
      if (layout === "grid") {
        const rects: GridItem[] = visibleIds.flatMap((itemId) => {
          const rect = itemElements.current
            .get(itemId)
            ?.getBoundingClientRect();
          return rect
            ? [
                {
                  id: itemId,
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                },
              ]
            : [];
        });
        moveTo(
          moveInGrid(
            rects,
            currentId,
            direction === "previous" ? "up" : "down",
          ),
          event.shiftKey,
        );
      } else {
        moveTo(moveInList(visibleIds, currentId, direction), event.shiftKey);
      }
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      if (event.key === "ArrowLeft" && event.altKey && onMoveToParent) {
        onMoveToParent();
        return;
      }
      if (layout === "grid") {
        const rects: GridItem[] = visibleIds.flatMap((itemId) => {
          const rect = itemElements.current
            .get(itemId)
            ?.getBoundingClientRect();
          return rect
            ? [
                {
                  id: itemId,
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                },
              ]
            : [];
        });
        moveTo(
          moveInGrid(
            rects,
            currentId,
            event.key === "ArrowLeft" ? "left" : "right",
          ),
          event.shiftKey,
        );
      } else if (currentId) {
        const target =
          event.key === "ArrowLeft"
            ? onLeft?.(currentId)
            : onRight?.(currentId);
        if (target) moveTo(target, event.shiftKey);
      }
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      moveTo(
        moveInList(
          visibleIds,
          currentId,
          event.key === "Home" ? "first" : "last",
        ),
        event.shiftKey,
      );
      return;
    }
    if (toggle && event.key.toLowerCase() === "a") {
      event.preventDefault();
      if (!visibleIds.length) return;
      commit({
        ids: [...visibleIds],
        primaryId: currentId ?? visibleIds[0],
        anchorId: currentId ?? visibleIds[0],
      });
      return;
    }
    if (toggle && event.key === " " && currentId) {
      event.preventDefault();
      commit(
        selectItem(selectionRef.current, visibleIds, currentId, {
          toggle: true,
        }),
      );
      return;
    }
    if (event.key === "Enter" && currentId && onOpen) {
      event.preventDefault();
      onOpen(currentId);
      return;
    }
    if (event.key === "F2" && currentId && onRename) {
      event.preventDefault();
      onRename(currentId);
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && onDelete) {
      event.preventDefault();
      onDelete();
      return;
    }
    if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      onEscape();
    }
  });

  return {
    paneProps: shortcutProps,
    currentId,
    select: (itemId: string, event: ReactMouseEvent) => {
      commit(
        selectItem(selectionRef.current, visibleIds, itemId, {
          range: event.shiftKey,
          toggle: event.metaKey || event.ctrlKey,
        }),
      );
    },
    getItemProps: (itemId: string) => ({
      ref: (element: HTMLElement | null) => {
        if (element) itemElements.current.set(itemId, element);
        else itemElements.current.delete(itemId);
      },
      tabIndex: itemId === (currentId ?? visibleIds[0]) ? 0 : -1,
      "aria-selected": selection.ids.includes(itemId),
      onDoubleClick: onOpen ? () => onOpen(itemId) : undefined,
    }),
  };
}
