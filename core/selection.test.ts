import { emptyWorkspace } from "./schema";
import { selectedNodes, selectedRoots } from "./scene";
import { expect, test } from "bun:test";
import {
  moveInGrid,
  moveInList,
  normalizeSelection,
  selectItem,
} from "./selection";

const ids = ["a", "b", "c", "d", "e"];
const empty = { ids: [], primaryId: null, anchorId: null };

test("range selection shrinks and reverses around a stable anchor", () => {
  const start = selectItem(empty, ids, "c");
  const extended = selectItem(start, ids, "e", { range: true });
  expect(extended.ids).toEqual(["c", "d", "e"]);
  const reversed = selectItem(extended, ids, "b", { range: true });
  expect(reversed).toEqual({ ids: ["b", "c"], primaryId: "b", anchorId: "c" });
});

test("removing the primary selection retains a usable primary and removes stale IDs", () => {
  const start = { ids: ["a", "c"], primaryId: "c", anchorId: "c" };
  const toggled = selectItem(start, ids, "c", { toggle: true });
  expect(normalizeSelection(["a", "b"], toggled)).toEqual({
    ids: ["a"],
    primaryId: "a",
    anchorId: "a",
  });
});

test("list entry with no selection starts at the appropriate boundary", () => {
  expect(moveInList(ids, null, "next")).toBe("a");
  expect(moveInList(ids, null, "previous")).toBe("e");
  expect(moveInList([], "a", "next")).toBeNull();
});

test("grid arrows follow adjacent rows and clamp an incomplete final row", () => {
  for (const columns of [2, 3]) {
    const items = ids.map((id, index) => ({
      id,
      left: (index % columns) * 100,
      top: Math.floor(index / columns) * 80,
      width: 90,
      height: 70,
    }));
    expect(moveInGrid(items, "a", "down")).toBe(ids[columns]);
    expect(moveInGrid(items, "e", "right")).toBe("e");
    expect(moveInGrid(items, ids[columns - 1], "right")).toBe(ids[columns]);
    expect(moveInGrid(items, null, "down")).toBe("a");
  }
});

test("asset-only selection produces no scene roots without treating assets as unknown nodes", () => {
  const state = emptyWorkspace();
  state.selection = ["asset_photo"];
  expect(
    selectedRoots(
      state.nodes,
      selectedNodes(state).map((node) => node.id),
    ),
  ).toEqual([]);
});
