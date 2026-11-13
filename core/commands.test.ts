import { describe, expect, test } from "bun:test";
import { cameraMatrix, samplePath, worldMatrix } from "./cameras";
import { applyCommand } from "./commands";
import { imageHistory } from "./history";
import { emptyWorkspace, identity, nodeSchema } from "./schema";

const node = (id: string, parentId: string | null = null) =>
  nodeSchema.parse({ id, name: id, kind: "group", parentId });
describe("scene commands", () => {
  test("reparenting preserves the world transform of a nested object", () => {
    const state = emptyWorkspace();
    const parent = node("parent");
    parent.transform.position = [5, 2, -3];
    parent.transform.scale = [2, 2, 2];
    const child = node("child", "parent");
    child.transform.position = [1, 0, 4];
    const destination = node("destination");
    destination.transform.position = [-4, 3, 2];
    state.nodes = { parent, child, destination };
    const before = worldMatrix(child, state.nodes).elements;
    applyCommand(state, {
      type: "nodes.reparent",
      ids: ["child"],
      parentId: "destination",
    });
    expect(worldMatrix(state.nodes.child, state.nodes).elements).toEqual(
      before,
    );
    expect(state.nodes.child.parentId).toBe("destination");
  });
  test("rejects parent cycles without changing the document", () => {
    const state = emptyWorkspace();
    applyCommand(state, {
      type: "nodes.put",
      nodes: [node("a"), node("b", "a")],
    });
    expect(() =>
      applyCommand(state, { type: "nodes.put", nodes: [node("a", "b")] }),
    ).toThrow("cycle");
    expect(state.nodes.a.parentId).toBeNull();
  });
  test("mixed asset and node selections share one collection and survive unrelated deletion", () => {
    const state = emptyWorkspace();
    state.assets.photo = {
      id: "photo",
      name: "photo",
      path: "photo.png",
      kind: "image",
      mimeType: "image/png",
      size: 1,
      modifiedAt: 0,
      missing: false,
    };
    applyCommand(state, {
      type: "nodes.put",
      nodes: [node("a"), node("b", "a"), node("c")],
    });
    applyCommand(state, {
      type: "selection.set",
      ids: ["photo", "b", "c", "b"],
    });
    applyCommand(state, { type: "nodes.remove", ids: ["a"] });
    expect(state.selection).toEqual(["photo", "c"]);
    expect(Object.keys(state.nodes)).toEqual(["c"]);
  });
  test("local clips can use any node or the scene root as a parent", () => {
    const state = emptyWorkspace();
    applyCommand(state, {
      type: "nodes.put",
      nodes: [
        {
          ...node("parent"),
          kind: "camera",
          projection: {
            width: 1,
            height: 1,
            fx: 1,
            fy: 1,
            cx: 0.5,
            cy: 0.5,
          },
        },
        {
          ...node("clip", "parent"),
          kind: "clip",
          clip: { scope: "local", invert: false, softness: 0 },
        },
        {
          ...node("root-clip"),
          kind: "clip",
          clip: { scope: "local", invert: false, softness: 0 },
        },
      ],
    });
  });
});
test("RDF cameras convert forward to the same world basis used by Three", () => {
  const camera = emptyWorkspace().settings.viewportCamera;
  camera.extrinsics = {
    position: [1, 2, 3],
    quaternion: [0, 0, 0, 1],
    coordinateSystem: "rdf",
  };
  expect(cameraMatrix(camera).elements).toEqual([
    1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 1, 2, 3, 1,
  ]);
});
test("path sampling preserves endpoints and applies scene parents", () => {
  const state = emptyWorkspace();
  const a = state.settings.viewportCamera;
  a.extrinsics = {
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    coordinateSystem: "rub",
  };
  const b = structuredClone(a);
  b.extrinsics.position = [10, 0, 0];
  const parent = node("group");
  parent.transform.position = [0, 5, 0];
  const path = {
    ...node("path", "group"),
    kind: "path" as const,
    transform: identity(),
    keyframes: [
      { id: "a", camera: a },
      { id: "b", camera: b },
    ],
  };
  state.nodes = { group: parent, path };
  const cameras = samplePath(path, state.nodes, 4);
  for (let i = 0; i < cameras.length; i++) {
    expect(cameras[i].extrinsics.position[0]).toBeCloseTo((i * 10) / 3);
    expect(cameras[i].extrinsics.position.slice(1)).toEqual([5, 0]);
  }
});
test("history includes sibling branches and pending generations", () => {
  const state = emptyWorkspace();
  const asset = {
    id: "a",
    name: "a",
    path: "a.png",
    kind: "image" as const,
    mimeType: "image/png",
    size: 1,
    modifiedAt: 0,
    missing: false,
  };
  state.assets = {
    a: asset,
    b: { ...asset, id: "b", parentAssetId: "a" },
    c: { ...asset, id: "c", parentAssetId: "a" },
    d: { ...asset, id: "d", parentAssetId: "b" },
  };
  expect(imageHistory(state, "d").assets.map((a) => a.id)).toEqual([
    "a",
    "b",
    "c",
    "d",
  ]);
});
