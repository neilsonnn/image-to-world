import { reparentNode } from "./cameras";
import type { SceneNode, Workspace } from "./schema";

export function orderedChildren(
  nodes: Record<string, SceneNode>,
  parentId: string | null,
) {
  return Object.values(nodes)
    .filter((node) => node.parentId === parentId)
    .map((node, index) => ({ node, order: node.order ?? index }))
    .sort((a, b) => a.order - b.order)
    .map((item) => item.node);
}

const inactiveCache = new WeakMap<Record<string, SceneNode>, Set<string>>();

/**
 * IDs of nodes that are hidden or sit under a hidden ancestor. Computed once per
 * `nodes` record (snapshots replace it on any node change) in a single pass.
 */
export function inactiveNodeIds(nodes: Record<string, SceneNode>) {
  let inactive = inactiveCache.get(nodes);
  if (inactive) return inactive;
  const result = new Set<string>();
  const known = new Map<string, boolean>();
  const resolve = (id: string): boolean => {
    const cached = known.get(id);
    if (cached !== undefined) return cached;
    const node = nodes[id];
    const hidden =
      !node ||
      !node.visible ||
      (node.parentId !== null && resolve(node.parentId));
    known.set(id, hidden);
    if (hidden) result.add(id);
    return hidden;
  };
  for (const id of Object.keys(nodes)) resolve(id);
  inactive = result;
  inactiveCache.set(nodes, inactive);
  return inactive;
}

export function selectedNodes(
  workspace: Pick<Workspace, "nodes" | "selection">,
) {
  return workspace.selection.flatMap((id) =>
    workspace.nodes[id] ? [workspace.nodes[id]] : [],
  );
}

export function selectedRoots(nodes: Record<string, SceneNode>, ids: string[]) {
  const selected = new Set(ids);
  return [...selected].filter((id) => {
    if (!nodes[id]) throw new Error(`Unknown node ${id}`);
    let parent = nodes[id].parentId;
    while (parent) {
      if (selected.has(parent)) return false;
      parent = nodes[parent]?.parentId ?? null;
    }
    return true;
  });
}

export function moveNodes(
  nodes: Record<string, SceneNode>,
  ids: string[],
  parentId: string | null,
  beforeId?: string | null,
) {
  if (parentId && !nodes[parentId])
    throw new Error(`Unknown parent ${parentId}`);
  const roots = new Set(selectedRoots(nodes, ids));
  let parent = parentId;
  while (parent) {
    if (roots.has(parent))
      throw new Error("Cannot move a node inside itself or its descendants");
    parent = nodes[parent].parentId;
  }
  if (
    beforeId &&
    (!nodes[beforeId] ||
      nodes[beforeId].parentId !== parentId ||
      roots.has(beforeId))
  )
    throw new Error(
      "Insertion target must be an unmoved sibling in the destination",
    );
  const ordered: string[] = [];
  const walk = (parent: string | null) => {
    for (const child of orderedChildren(nodes, parent)) {
      if (roots.has(child.id)) ordered.push(child.id);
      walk(child.id);
    }
  };
  walk(null);
  const next = { ...nodes };
  for (const id of ordered) next[id] = reparentNode(nodes[id], parentId, nodes);
  const siblings = orderedChildren(nodes, parentId)
    .filter((node) => !roots.has(node.id))
    .map((node) => node.id);
  const index = beforeId ? siblings.indexOf(beforeId) : siblings.length;
  siblings.splice(index, 0, ...ordered);
  siblings.forEach((id, order) => {
    next[id] = { ...next[id], order };
  });
  return next;
}
