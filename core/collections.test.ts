import { expect, test } from "bun:test";
import { collectionMatches, collectionTreeRows } from "./collections";
import { applyCommand } from "./commands";
import { commandSchema, emptyWorkspace, nodeSchema } from "./schema";

test("search finds collapsed descendants with their ancestors and preserves expansion", () => {
  const nodes = Object.fromEntries(
    [
      nodeSchema.parse({ id: "root", name: "Room", kind: "group" }),
      nodeSchema.parse({
        id: "camera",
        name: "Front",
        kind: "camera",
        parentId: "root",
      }),
      nodeSchema.parse({
        id: "other",
        name: "Side",
        kind: "camera",
        parentId: "root",
      }),
    ].map((node) => [node.id, node]),
  );
  const expanded: string[] = [];
  expect(
    collectionTreeRows(nodes, expanded, "FRONT camera").map((row) => [
      row.node.id,
      row.depth,
    ]),
  ).toEqual([
    ["root", 0],
    ["camera", 1],
  ]);
  expect(
    collectionTreeRows(nodes, expanded, "").map((row) => row.node.id),
  ).toEqual(["root"]);
});

test("asset search matches terms across name, kind, and nested path", () => {
  expect(
    collectionMatches("  foyer PNG ", [
      "Camera 1",
      "image",
      "foyer/camera.png",
    ]),
  ).toBe(true);
  expect(
    collectionMatches("foyer video", ["Camera 1", "image", "foyer/camera.png"]),
  ).toBe(false);
});

test("independent collection patches preserve search, layout, and expansion", () => {
  const state = emptyWorkspace();
  state.settings.collections.expandedNodeIds = ["room"];
  for (const collections of [
    { assetSearch: "wood" },
    { sceneSearch: "camera" },
    { assetTrash: true },
  ])
    applyCommand(
      state,
      commandSchema.parse({
        type: "workspace.update",
        settings: { collections },
      }),
    );
  expect(state.settings.collections).toMatchObject({
    assetSearch: "wood",
    sceneSearch: "camera",
    assetTrash: true,
    expandedNodeIds: ["room"],
  });
});
