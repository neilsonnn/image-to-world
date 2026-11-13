import { orderedChildren } from "./scene";
import type { SceneNode } from "./schema";

export function collectionMatches(query: string, values: string[]) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = values.join(" ").toLocaleLowerCase();
  return terms.every((term) => text.includes(term));
}

export type CollectionTreeRow = {
  node: SceneNode;
  depth: number;
  expanded: boolean;
};

export function collectionTreeRows(
  nodes: Record<string, SceneNode>,
  expandedIds: Iterable<string>,
  query: string,
) {
  const expanded = new Set(expandedIds);
  const searching = Boolean(query.trim());
  const matches = new Set(
    Object.values(nodes)
      .filter((node) => collectionMatches(query, [node.name, node.kind]))
      .map((node) => node.id),
  );
  const retained = new Set(matches);
  if (searching) {
    for (const id of matches) {
      let parentId = nodes[id]?.parentId;
      while (parentId) {
        retained.add(parentId);
        parentId = nodes[parentId]?.parentId ?? null;
      }
    }
  }

  const rows: CollectionTreeRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of orderedChildren(nodes, parentId)) {
      if (searching && !retained.has(node.id)) continue;
      const open = searching || expanded.has(node.id);
      rows.push({ node, depth, expanded: open });
      if (open) walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}
