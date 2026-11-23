// A patch replaces a field, or one record in a keyed collection. No array indexes.
import type { Workspace } from "./schema";

export type FieldPatch = {
  field: keyof Workspace;
  key?: string;
  value?: unknown;
  removeEdits?: string[];
};
export type WorkspaceDelta = {
  base: number;
  revision: number;
  patches: FieldPatch[];
};
export const recordFields = new Set<keyof Workspace>([
  "nodes",
  "assets",
  "jobs",
  "settings",
  "imageDrafts",
  "imageVersions",
  "resultOwners",
  "resultApplications",
  "receipts",
]);

export function applyDelta(
  before: Workspace,
  delta: WorkspaceDelta,
): Workspace {
  const next = { ...before, revision: delta.revision };
  const copied = new Set<string>();
  for (const { field, key, value, removeEdits } of delta.patches) {
    if (removeEdits && (field === "undo" || field === "redo")) {
      const removed = new Set(removeEdits);
      next[field] = [
        ...next[field].filter((e) => !e.id || !removed.has(e.id)),
        ...(value as Workspace["undo"]),
      ];
      continue;
    }
    if (key === undefined) {
      Object.assign(next, { [field]: value });
      continue;
    }
    if (!copied.has(field)) {
      Object.assign(next, { [field]: { ...(next[field] as object) } });
      copied.add(field);
    }
    const records = next[field] as Record<string, unknown>;
    if (value === undefined) delete records[key];
    else
      Object.defineProperty(records, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  return next;
}
