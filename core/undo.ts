import type { Edit, Workspace } from "./schema";

type Change = Edit["changes"][number];
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length && a.every((value, index) => equal(value, b[index]))
    );
  if (record(a) && record(b)) {
    const keys = Object.keys(a).filter((key) => a[key] !== undefined);
    return (
      keys.length ===
        Object.keys(b).filter((key) => b[key] !== undefined).length &&
      keys.every((key) => equal(a[key], b[key]))
    );
  }
  return false;
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function editChanges(before: Workspace, after: Workspace) {
  const changes: Change[] = [];
  const visit = (a: unknown, b: unknown, path: string[]) => {
    if (equal(a, b)) return;
    if (record(a) && record(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        visit(a[key], b[key], [...path, key]);
    } else
      changes.push({
        path,
        before: structuredClone(a),
        after: structuredClone(b),
      });
  };
  for (const key of [
    "nodes",
    "assets",
    "name",
    "imageDrafts",
    "imageVersions",
  ] as const)
    visit(before[key], after[key], [key]);
  for (const key of [
    "viewportCamera",
    "viewingCameraId",
    "freeCamera",
    "atlas",
    "display",
    "grid",
    "pointSize",
  ] as const)
    visit(before.settings[key], after.settings[key], ["settings", key]);
  return changes;
}

export function restoreEdit(
  workspace: Workspace,
  edit: Edit,
  direction: "undo" | "redo",
) {
  for (const change of edit.changes) {
    if (
      !(
        ["nodes", "assets", "name", "imageDrafts", "imageVersions"].includes(
          change.path[0],
        ) ||
        (change.path[0] === "settings" &&
          [
            "viewportCamera",
            "viewingCameraId",
            "freeCamera",
            "atlas",
            "display",
            "grid",
            "pointSize",
          ].includes(change.path[1]))
      ) ||
      change.path.some((key) =>
        ["__proto__", "constructor", "prototype"].includes(key),
      )
    )
      throw new Error("Invalid edit history path");
    let parent = workspace as unknown as Record<string, unknown>;
    for (const key of change.path.slice(0, -1)) {
      if (!record(parent[key]))
        throw new Error("Cannot undo: the affected object changed externally");
      parent = parent[key];
    }
    const key = change.path.at(-1)!;
    const expected = direction === "undo" ? change.after : change.before;
    if (!equal(parent[key], expected))
      throw new Error(
        "Cannot undo/redo: the affected field changed externally",
      );
    const value = direction === "undo" ? change.before : change.after;
    if (value === undefined) delete parent[key];
    else parent[key] = structuredClone(value);
  }
  const selection = edit.selection?.[direction === "undo" ? "before" : "after"];
  if (selection) Object.assign(workspace, structuredClone(selection));
}

export function editSelection(workspace: Workspace) {
  return {
    selection: [...workspace.selection],
    primaryId: workspace.primaryId,
    selectionAnchor: workspace.selectionAnchor,
  };
}
