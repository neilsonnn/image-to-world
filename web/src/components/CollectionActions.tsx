import {
  ArrowCounterClockwise,
  FolderOpen,
  Trash,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Hint } from "./ui";

export function CollectionActions({
  name,
  deleteLabel = `Move ${name} to Trash`,
  onReveal,
  onDelete,
  onRestore,
  children,
}: {
  name: string;
  /** Row-specific actions shown before the shared ones. */
  children?: ReactNode;
  deleteLabel?: string;
  onReveal?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
}) {
  return (
    <span className="collection-row-actions">
      {children}
      {onReveal && (
        <Hint label={`Reveal ${name} in Finder`}>
          <button
            type="button"
            className="collection-row-action"
            aria-label={`Reveal ${name} in Finder`}
            onClick={onReveal}
          >
            <FolderOpen />
          </button>
        </Hint>
      )}
      {onRestore && (
        <Hint label={`Restore ${name}`}>
          <button
            type="button"
            className="collection-row-action"
            aria-label={`Restore ${name}`}
            onClick={onRestore}
          >
            <ArrowCounterClockwise />
          </button>
        </Hint>
      )}
      {onDelete && (
        <Hint label={deleteLabel}>
          <button
            type="button"
            className="collection-row-action"
            aria-label={deleteLabel}
            onClick={onDelete}
          >
            <Trash />
          </button>
        </Hint>
      )}
    </span>
  );
}
