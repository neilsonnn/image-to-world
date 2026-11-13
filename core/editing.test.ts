import { expect, test } from "bun:test";
import { worldMatrix } from "./cameras";
import { applyCommand } from "./commands";
import { orderedChildren } from "./scene";
import { emptyWorkspace, nodeSchema, workspaceSchema } from "./schema";

const node = (id: string, parentId: string | null = null) =>
  nodeSchema.parse({ id, name: id, kind: "group", parentId });

test("moving a selected parent and child preserves nesting and world transforms", () => {
  const state = emptyWorkspace();
  state.nodes = {
    a: node("a"),
    child: node("child", "a"),
    b: node("b"),
    target: node("target"),
  };
  state.nodes.a.transform.position = [2, 3, 4];
  state.nodes.target.transform.position = [7, 8, 9];
  state.nodes.target.transform.scale = [2, 2, 2];
  const before = worldMatrix(state.nodes.child, state.nodes).elements;
  applyCommand(state, {
    type: "nodes.move",
    ids: ["child", "a", "b"],
    parentId: "target",
  });
  expect(state.nodes.child.parentId).toBe("a");
  expect(worldMatrix(state.nodes.child, state.nodes).elements).toEqual(before);
  expect(orderedChildren(state.nodes, "target").map((n) => n.id)).toEqual([
    "a",
    "b",
  ]);
  applyCommand(state, { type: "history.undo" });
  expect(state.nodes.a.parentId).toBeNull();
  expect(state.nodes.b.parentId).toBeNull();
});

test("before insertion order survives JSON persistence and redo", () => {
  const state = emptyWorkspace();
  state.nodes = { a: node("a"), b: node("b"), c: node("c"), d: node("d") };
  applyCommand(state, {
    type: "nodes.move",
    ids: ["d", "c"],
    parentId: null,
    beforeId: "b",
  });
  const reopened = workspaceSchema.parse(JSON.parse(JSON.stringify(state)));
  expect(orderedChildren(reopened.nodes, null).map((n) => n.id)).toEqual([
    "a",
    "c",
    "d",
    "b",
  ]);
  applyCommand(reopened, { type: "history.undo" });
  expect(orderedChildren(reopened.nodes, null).map((n) => n.id)).toEqual([
    "a",
    "b",
    "c",
    "d",
  ]);
  applyCommand(reopened, { type: "history.redo" });
  expect(orderedChildren(reopened.nodes, null).map((n) => n.id)).toEqual([
    "a",
    "c",
    "d",
    "b",
  ]);
});

test("invalid multi-node moves do not partially mutate or append history", () => {
  const state = emptyWorkspace();
  state.nodes = { a: node("a"), child: node("child", "a"), b: node("b") };
  const before = structuredClone(state);
  expect(() =>
    applyCommand(state, {
      type: "nodes.move",
      ids: ["b", "a"],
      parentId: "child",
    }),
  ).toThrow("descendants");
  expect(state).toEqual(before);
});

test("undo preserves background changes and detects conflicting edits atomically", () => {
  const state = emptyWorkspace();
  state.nodes.a = node("a");
  applyCommand(state, {
    type: "nodes.put",
    nodes: [{ ...state.nodes.a, name: "Renamed", visible: false }],
  });
  state.nodes.a.transform.position = [1, 2, 3];
  state.name = "External workspace name";
  applyCommand(state, { type: "history.undo" });
  expect(state.nodes.a.name).toBe("a");
  expect(state.nodes.a.transform.position).toEqual([1, 2, 3]);
  expect(state.name).toBe("External workspace name");
  applyCommand(state, { type: "history.redo" });
  state.nodes.a.visible = true;
  const before = structuredClone(state);
  expect(() => applyCommand(state, { type: "history.undo" })).toThrow(
    "changed externally",
  );
  expect(state).toEqual(before);
});

test("duplicate and delete affect scene instances without copying or deleting source assets", () => {
  const state = emptyWorkspace();
  state.assets.image = {
    id: "image",
    name: "Image",
    path: "image.png",
    kind: "image",
    mimeType: "image/png",
    size: 1,
    modifiedAt: 1,
    missing: false,
  };
  state.nodes = {
    a: node("a"),
    image: {
      ...node("image", "a"),
      id: "image-node",
      kind: "image",
      assetId: "image",
    },
  };
  state.nodes["image-node"] = state.nodes.image;
  delete state.nodes.image;
  applyCommand(state, { type: "nodes.duplicate", ids: ["a", "image-node"] });
  const copy = state.primaryId!;
  expect(orderedChildren(state.nodes, copy)[0].assetId).toBe("image");
  applyCommand(state, { type: "nodes.remove", ids: ["a", copy] });
  expect(Object.keys(state.nodes)).toHaveLength(0);
  expect(Object.keys(state.assets)).toEqual(["image"]);
});

test("omitted optional settings receive defaults without losing image drafts", () => {
  const original = emptyWorkspace();
  original.settings.editor2d.height = 520;
  original.imageDrafts.image = {
    strokes: [
      {
        id: "s",
        points: [[0.2, 0.3]],
        color: "#ff0000",
        size: 0.02,
        erase: false,
      },
    ],
    layers: [],
  };
  const input = JSON.parse(JSON.stringify(original));
  delete input.settings.layout;
  delete input.settings.collections;
  delete input.settings.display;
  delete input.primaryId;
  delete input.selectionAnchor;
  delete input.undo;
  delete input.redo;
  const parsed = workspaceSchema.parse(input);
  expect(parsed.settings.layout.rightWidth).toBe(280);
  expect(parsed.settings.editor2d.height).toBe(520);
  expect(parsed.imageDrafts).toEqual(original.imageDrafts);
});

test("draft undo is scoped to its image and leaves scene undo independently available", () => {
  const state = emptyWorkspace();
  const asset = {
    id: "a",
    name: "A",
    path: "a.png",
    kind: "image" as const,
    mimeType: "image/png",
    size: 1,
    modifiedAt: 1,
    missing: false,
  };
  state.assets = { a: asset, b: { ...asset, id: "b", path: "b.png" } };
  state.nodes.n = node("n");
  applyCommand(state, {
    type: "nodes.put",
    nodes: [{ ...state.nodes.n, name: "Renamed" }],
  });
  const draft = {
    strokes: [
      {
        id: "s",
        points: [[0.2, 0.3] as [number, number]],
        color: "#ff0000",
        size: 0.02,
        erase: false,
      },
    ],
    layers: [],
  };
  applyCommand(state, { type: "image.draft", assetId: "a", draft });
  applyCommand(state, { type: "image.draft", assetId: "b", draft });
  applyCommand(state, { type: "history.undo", assetId: "a" });
  expect(state.imageDrafts.a).toBeUndefined();
  expect(state.imageDrafts.b).toEqual(draft);
  applyCommand(state, { type: "history.undo" });
  expect(state.nodes.n.name).toBe("n");
  applyCommand(state, { type: "history.redo", assetId: "a" });
  expect(state.imageDrafts.a).toEqual(draft);
});

test("a mixed-object property edit is atomic and one undo entry", () => {
  const state = emptyWorkspace();
  state.nodes.n = node("n");
  state.assets.a = {
    id: "a",
    name: "A",
    path: "a.png",
    kind: "image",
    mimeType: "image/png",
    size: 1,
    modifiedAt: 1,
    missing: false,
    depthAssetId: "depth",
  };
  applyCommand(state, {
    type: "edit.batch",
    commands: [
      { type: "nodes.put", nodes: [{ ...state.nodes.n, name: "Renamed" }] },
      {
        type: "assets.update",
        id: "a",
        patch: { name: "Renamed", depthAssetId: null },
      },
    ],
  });
  expect(state.undo).toHaveLength(1);
  expect(state.assets.a.depthAssetId).toBeUndefined();
  applyCommand(state, { type: "history.undo" });
  expect([
    state.nodes.n.name,
    state.assets.a.name,
    state.assets.a.depthAssetId,
  ]).toEqual(["n", "A", "depth"]);
  const before = structuredClone(state);
  expect(() =>
    applyCommand(state, {
      type: "edit.batch",
      commands: [
        { type: "nodes.put", nodes: [{ ...state.nodes.n, name: "Changed" }] },
        { type: "assets.update", id: "missing", patch: { name: "Invalid" } },
      ],
    }),
  ).toThrow("does not exist");
  expect(state).toEqual(before);
});
