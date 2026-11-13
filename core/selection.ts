export type SelectionState = {
  ids: string[];
  primaryId: string | null;
  anchorId: string | null;
};

export type SelectionModifiers = {
  range?: boolean;
  toggle?: boolean;
};

export type GridItem = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

function unique(ids: readonly string[]) {
  return [...new Set(ids)];
}

export function normalizeSelection(
  availableIds: Iterable<string>,
  selection: Partial<SelectionState>,
): SelectionState {
  const available = new Set(availableIds);
  const ids = unique(selection.ids ?? []).filter((id) => available.has(id));
  const primaryId =
    selection.primaryId && ids.includes(selection.primaryId)
      ? selection.primaryId
      : (ids[0] ?? null);
  return {
    ids,
    primaryId,
    anchorId:
      selection.anchorId && available.has(selection.anchorId)
        ? selection.anchorId
        : primaryId,
  };
}

export function rangeIds(
  visibleIds: readonly string[],
  anchorId: string | null,
  targetId: string,
) {
  const targetIndex = visibleIds.indexOf(targetId);
  if (targetIndex < 0) return [];
  const anchorIndex = anchorId ? visibleIds.indexOf(anchorId) : -1;
  if (anchorIndex < 0) return [targetId];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return visibleIds.slice(start, end + 1);
}

export function selectItem(
  selection: SelectionState,
  visibleIds: readonly string[],
  id: string,
  modifiers: SelectionModifiers = {},
): SelectionState {
  if (modifiers.range) {
    const anchorId =
      selection.anchorId && visibleIds.includes(selection.anchorId)
        ? selection.anchorId
        : selection.primaryId && visibleIds.includes(selection.primaryId)
          ? selection.primaryId
          : id;
    return {
      ids: rangeIds(visibleIds, anchorId, id),
      primaryId: id,
      anchorId,
    };
  }
  if (modifiers.toggle) {
    const selected = selection.ids.includes(id);
    const ids = selected
      ? selection.ids.filter((candidate) => candidate !== id)
      : [...selection.ids, id];
    const primaryId = selected
      ? selection.primaryId === id
        ? (ids.at(-1) ?? null)
        : selection.primaryId
      : id;
    return {
      ids,
      primaryId,
      anchorId: primaryId ?? selection.anchorId,
    };
  }
  return { ids: [id], primaryId: id, anchorId: id };
}

export function moveInList(
  visibleIds: readonly string[],
  currentId: string | null,
  direction: "previous" | "next" | "first" | "last",
) {
  if (!visibleIds.length) return null;
  if (direction === "first") return visibleIds[0];
  if (direction === "last") return visibleIds.at(-1) ?? null;
  const index = currentId ? visibleIds.indexOf(currentId) : -1;
  if (index < 0)
    return direction === "previous" ? visibleIds.at(-1)! : visibleIds[0];
  const delta = direction === "previous" ? -1 : 1;
  return visibleIds[
    Math.max(0, Math.min(visibleIds.length - 1, index + delta))
  ];
}

export function moveInGrid(
  items: readonly GridItem[],
  currentId: string | null,
  direction: "left" | "right" | "up" | "down",
) {
  if (!items.length) return null;
  const current = items.find((item) => item.id === currentId);
  if (!current)
    return direction === "up" || direction === "left"
      ? items.at(-1)!.id
      : items[0].id;
  if (direction === "left" || direction === "right") {
    return moveInList(
      items.map(({ id }) => id),
      current.id,
      direction === "left" ? "previous" : "next",
    );
  }
  const candidates = items.filter((item) =>
    direction === "up"
      ? item.top < current.top - 1
      : item.top > current.top + 1,
  );
  const rowDistance = Math.min(
    ...candidates.map((item) => Math.abs(item.top - current.top)),
  );
  const centerX = current.left + current.width / 2;
  return (
    candidates
      .filter(
        (item) => Math.abs(Math.abs(item.top - current.top) - rowDistance) < 1,
      )
      .sort(
        (a, b) =>
          Math.abs(a.left + a.width / 2 - centerX) -
          Math.abs(b.left + b.width / 2 - centerX),
      )[0]?.id ?? current.id
  );
}
