import { expect, test } from "bun:test";
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { applyCommand } from "./commands";
import { generationInput } from "./generation";
import {
  atlasContext,
  captureFrame,
  completeCapture,
  createCapture,
  sceneCamera,
} from "./captures";
import { captureClip, clipMasks, clippedOpacity } from "./clips";
import { inactiveNodeIds } from "./scene";
import { emptyWorkspace, identity, type Asset } from "./schema";
import { lookFlyCamera, zoomFlyCamera } from "../web/src/lib/fly";

function fixture() {
  const workspace = emptyWorkspace();
  const asset: Asset = {
    id: "photo",
    name: "Photo",
    path: "photo.png",
    kind: "image",
    mimeType: "image/png",
    size: 1,
    modifiedAt: 0,
    missing: false,
    depthAssetId: "depth",
    camera: {
      ...workspace.settings.viewportCamera,
      extrinsics: {
        position: [3, 1.7, 2],
        quaternion: new Quaternion()
          .setFromEuler(new Euler(-0.15, 0.2, 0.08, "YXZ"))
          .toArray(),
        coordinateSystem: "rub",
      },
    },
  };
  workspace.assets.photo = asset;
  workspace.assets.depth = {
    ...asset,
    id: "depth",
    name: "depth",
    path: "depth.exr",
    kind: "depth",
    camera: undefined,
    depthAssetId: undefined,
  };
  return { workspace, asset };
}

test("capture placement keeps viewport yaw on the floor parent and solved height/rotation on camera and points", () => {
  const { workspace, asset } = fixture();
  const placement = {
    ...workspace.settings.viewportCamera,
    extrinsics: {
      position: [8, 5, -4] as [number, number, number],
      quaternion: new Quaternion()
        .setFromEuler(new Euler(0.4, 0.7, 0.2, "YXZ"))
        .toArray(),
      coordinateSystem: "rub" as const,
    },
  };
  const nodes = createCapture(asset, "capture", placement);
  applyCommand(workspace, { type: "nodes.put", nodes });
  expect(nodes[0].transform.position).toEqual([8, 0, -4]);
  expect(nodes[1].transform.position).toEqual([0, 1.7, 0]);
  expect(nodes[1].transform.quaternion).toEqual(nodes[3].transform.quaternion);
  expect(
    new Euler().setFromQuaternion(
      new Quaternion(...nodes[0].transform.quaternion),
      "YXZ",
    ).y,
  ).toBeCloseTo(0.7);
  expect(atlasContext(workspace)).toHaveLength(1);
  expect(sceneCamera(workspace, "capture")!.extrinsics.position).toEqual([
    8, 1.7, -4,
  ]);
});

test("pose completion preserves moved parents and never resurrects deleted captures", () => {
  const { workspace, asset } = fixture();
  const source = { ...asset, camera: undefined, depthAssetId: undefined };
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: createCapture(source, "capture", workspace.settings.viewportCamera),
  });
  workspace.nodes.capture.transform.position = [10, 2, 12];
  completeCapture(
    workspace,
    "capture",
    asset,
    workspace.settings.viewportCamera,
  );
  expect(workspace.nodes.capture.transform.position).toEqual([10, 2, 12]);
  expect(workspace.nodes.capture_camera.transform.position[1]).toBe(1.7);
  applyCommand(workspace, { type: "nodes.remove", ids: ["capture"] });
  expect(() => completeCapture(workspace, "capture", asset)).toThrow(
    "parent is missing",
  );
  expect(workspace.nodes).toEqual({});
});

test("Atlas reads the points child's active geometry instead of the parent's saved result", () => {
  const { workspace, asset } = fixture();
  workspace.assets.otherDepth = { ...workspace.assets.depth, id: "otherDepth" };
  workspace.assets.reconstructed = {
    ...asset,
    id: "reconstructed",
    depthAssetId: "otherDepth",
  };
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: createCapture(asset, "capture"),
  });
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: [
      {
        ...workspace.nodes.capture_points,
        geometryAssetId: "reconstructed",
      },
    ],
  });
  expect(captureFrame(workspace, "capture").asset.depthAssetId).toBe(
    "otherDepth",
  );
  expect(workspace.nodes.capture.geometryAssetId).toBe(asset.id);
});

test("rearranging or deleting components stays legal but broken Atlas inputs report their cause", () => {
  const { workspace, asset } = fixture();
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: createCapture(asset, "capture"),
  });
  applyCommand(workspace, {
    type: "nodes.move",
    ids: ["capture_points"],
    parentId: "capture_camera",
  });
  expect(() => atlasContext(workspace)).toThrow("Photo: missing points child");
  applyCommand(workspace, { type: "history.undo" });
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: [
      {
        ...workspace.nodes.capture_points,
        id: "extra-points",
      },
    ],
  });
  expect(() => atlasContext(workspace)).toThrow(
    "Photo: ambiguous points child",
  );
  applyCommand(workspace, { type: "history.undo" });
  applyCommand(workspace, { type: "nodes.remove", ids: ["capture_camera"] });
  expect(() => atlasContext(workspace)).toThrow("Photo: missing camera child");
});

test("selected valid inputs do not validate unrelated broken posed images", () => {
  const { workspace, asset } = fixture();
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: [
      ...createCapture(asset, "valid"),
      ...createCapture(asset, "broken"),
    ],
  });
  applyCommand(workspace, { type: "nodes.remove", ids: ["broken_points"] });
  applyCommand(workspace, { type: "selection.set", ids: ["valid"] });
  expect(
    generationInput(workspace, { kind: "view", context: "selection" }),
  ).toMatchObject({ nodeIds: ["valid"] });
  applyCommand(workspace, { type: "selection.set", ids: [] });
  expect(() => generationInput(workspace, { kind: "view" })).toThrow(
    "missing points child",
  );
});

test("Atlas uses ordered visible context and accepts child selections without double counting", () => {
  const { workspace, asset } = fixture();
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: [...createCapture(asset, "a"), ...createCapture(asset, "b")],
  });
  workspace.settings.atlas.order = ["b", "a"];
  expect(atlasContext(workspace).map((frame) => frame.node.id)).toEqual([
    "b",
    "a",
  ]);
  expect(
    atlasContext(workspace, ["a", "a_camera", "a_points"]).map(
      (frame) => frame.node.id,
    ),
  ).toEqual(["a"]);
  workspace.settings.atlas.soloIds = ["b"];
  expect(atlasContext(workspace).map((frame) => frame.node.id)).toEqual(["b"]);
  workspace.nodes.b.visible = false;
  expect(atlasContext(workspace)).toEqual([]);
  workspace.settings.atlas.soloIds = [];
  workspace.settings.atlas.excludedIds = ["a"];
  expect(atlasContext(workspace)).toEqual([]);
});

test("camera view and exit restore the previous camera and are undoable", () => {
  const { workspace, asset } = fixture();
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: createCapture(asset, "a"),
  });
  const before = structuredClone(workspace.settings.viewportCamera);
  applyCommand(workspace, { type: "camera.view", nodeId: "a_camera" });
  expect(workspace.settings.viewportCamera).toEqual(
    sceneCamera(workspace, "a")!,
  );
  applyCommand(workspace, { type: "camera.release" });
  expect(workspace.settings.viewportCamera).toEqual(before);
  applyCommand(workspace, { type: "history.undo" });
  expect(workspace.settings.viewingCameraId).toBe("a_camera");
});

test("local clip masks follow their parent and leave other captures intact", () => {
  const { workspace, asset } = fixture();
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: [...createCapture(asset, "a"), ...createCapture(asset, "b")],
  });
  const clip = captureClip("a", [-1, -1, -1], [1, 1, 1]);
  applyCommand(workspace, { type: "nodes.put", nodes: [clip] });
  expect(
    clippedOpacity(new Vector3(3, 0, 2), clipMasks(workspace, "a_points")),
  ).toBe(1);
  expect(
    clippedOpacity(new Vector3(30, 0, 2), clipMasks(workspace, "a_points")),
  ).toBe(0);
  expect(clipMasks(workspace, "b_points")).toEqual([]);
  workspace.nodes.a.transform.position[0] += 10;
  expect(
    clippedOpacity(new Vector3(13, 0, 2), clipMasks(workspace, "a_points")),
  ).toBe(1);
});

test("local clip scope follows arbitrary parents and excludes the scene root", () => {
  const workspace = emptyWorkspace();
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: [
      {
        id: "parent",
        name: "Parent",
        kind: "camera",
        projection: { width: 1, height: 1, fx: 1, fy: 1, cx: 0.5, cy: 0.5 },
      },
      {
        id: "child",
        name: "Child",
        kind: "group",
        parentId: "parent",
      },
      {
        id: "clip",
        name: "Clip",
        kind: "clip",
        parentId: "parent",
        clip: { scope: "local", invert: false, softness: 0 },
      },
      {
        id: "rootClip",
        name: "Root clip",
        kind: "clip",
        clip: { scope: "local", invert: false, softness: 0 },
      },
    ],
  });
  expect(clipMasks(workspace, "child")).toHaveLength(1);
  expect(clipMasks(workspace, "parent")).toHaveLength(1);
  expect(clipMasks(workspace, "rootClip")).toEqual([]);
});

test("two-finger look keeps position and focal length while pinch only changes focal length", () => {
  const camera = new PerspectiveCamera(50);
  camera.position.set(2, 3, 4);
  lookFlyCamera(camera, 50, -20);
  expect(camera.position.toArray()).toEqual([2, 3, 4]);
  expect(camera.fov).toBe(50);
  expect(camera.quaternion.toArray()).not.toEqual([0, 0, 0, 1]);
  const quaternion = camera.quaternion.clone();
  zoomFlyCamera(camera, -20);
  expect(camera.fov).toBeLessThan(50);
  expect(camera.quaternion.toArray()).toEqual(quaternion.toArray());
  expect(camera.position.toArray()).toEqual([2, 3, 4]);
});

test("path context excludes and solos independently of the global context", () => {
  const { workspace, asset } = fixture();
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: [...createCapture(asset, "a"), ...createCapture(asset, "b")],
  });
  applyCommand(workspace, {
    type: "path.fromCameras",
    nodeIds: ["a_camera", "b_camera"],
    targetFrameCount: 36,
  });
  const pathId = workspace.primaryId!;
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: [
      {
        ...workspace.nodes[pathId],
        context: { order: ["b", "a"], excludedIds: ["a"], soloIds: [] },
      },
    ],
  });
  expect(
    atlasContext(workspace, undefined, pathId).map((frame) => frame.node.id),
  ).toEqual(["b"]);
  expect(atlasContext(workspace).map((frame) => frame.node.id)).toEqual([
    "a",
    "b",
  ]);
  applyCommand(workspace, { type: "history.undo" });
  expect(atlasContext(workspace, undefined, pathId)).toHaveLength(2);
});

test("joint posing preserves the estimated baseline between frames", () => {
  const { workspace, asset } = fixture();
  const placement = workspace.settings.viewportCamera;
  placement.extrinsics = {
    position: [0, 3, 0],
    quaternion: [0, 0, 0, 1],
    coordinateSystem: "rub",
  };
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: [
      ...createCapture({ ...asset, camera: undefined }, "a", placement),
      ...createCapture({ ...asset, camera: undefined }, "b", placement),
    ],
  });
  const second = {
    ...asset,
    camera: {
      ...asset.camera!,
      extrinsics: {
        ...asset.camera!.extrinsics,
        position: [6, 1.8, 3] as [number, number, number],
      },
    },
  };
  completeCapture(workspace, "a", asset, placement, [3, 0, 2]);
  completeCapture(workspace, "b", second, placement, [3, 0, 2]);
  expect(sceneCamera(workspace, "a")!.extrinsics.position).toEqual([0, 1.7, 0]);
  expect(sceneCamera(workspace, "b")!.extrinsics.position).toEqual([3, 1.8, 1]);
});

test("hiding a node makes its descendants inactive and the next snapshot sees edits", () => {
  const node = (id: string, parentId: string | null, visible = true) => ({
    id,
    name: id,
    kind: "group" as const,
    parentId,
    visible,
    transform: identity(),
  });
  const nodes = {
    root: node("root", null, false),
    child: node("child", "root"),
    grandchild: node("grandchild", "child"),
    other: node("other", null),
  };
  expect([...inactiveNodeIds(nodes)].sort()).toEqual([
    "child",
    "grandchild",
    "root",
  ]);
  const shown = { ...nodes, root: { ...nodes.root, visible: true } };
  expect(inactiveNodeIds(shown).size).toBe(0);
});
