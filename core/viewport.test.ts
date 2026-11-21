import { expect, test } from "bun:test";
import { Euler, Matrix4, PerspectiveCamera, Vector3 } from "three";
import {
  cameraMatrix,
  samplePath,
  transformNodes,
  worldMatrix,
} from "./cameras";
import { applyCommand } from "./commands";
import { sessionFormat } from "./formats";
import {
  cameraSchema,
  emptyWorkspace,
  nodeSchema,
  workspaceSchema,
} from "./schema";
import { selectedRoots } from "./scene";
import { sceneCamera } from "./captures";
import { generationInput } from "./generation";
import { transformCapabilities } from "./node-capabilities";
import { lookFlyCamera, moveFlyCamera } from "../web/src/lib/fly";
import {
  CameraTransition,
  CAMERA_TRANSITION_MS,
} from "../web/src/lib/camera-transition";

function scene() {
  const workspace = emptyWorkspace();
  workspace.nodes = {
    parent: nodeSchema.parse({
      id: "parent",
      name: "Parent",
      kind: "group",
      transform: {
        position: [5, 0, 0],
        quaternion: [0, 0, 0, 1],
        scale: [2, 2, 2],
      },
    }),
    child: nodeSchema.parse({
      id: "child",
      name: "Child",
      kind: "group",
      parentId: "parent",
    }),
    other: nodeSchema.parse({ id: "other", name: "Other", kind: "group" }),
  };
  applyCommand(workspace, {
    type: "selection.set",
    ids: ["child", "other"],
    primaryId: "child",
    anchorId: "other",
  });
  return workspace;
}

test("the default session format fits the persisted camera intrinsics", () => {
  const workspace = emptyWorkspace();
  const camera = workspace.settings.viewportCamera;
  expect(
    cameraSchema.safeParse({
      ...camera,
      intrinsics: { ...camera.intrinsics, ...sessionFormat(workspace) },
    }).success,
  ).toBe(true);
});

test("camera jumps interpolate pose and calibrated projection and land within 160ms", () => {
  const camera = new PerspectiveCamera(50, 16 / 9);
  const target = new PerspectiveCamera(80, 16 / 9);
  target.position.set(10, 2, -4);
  target.rotation.set(0.2, 1, 0);
  target.setViewOffset(1600, 900, 100, 50, 1400, 800);
  const transition = new CameraTransition(camera);
  transition.start(target, 1000);
  transition.update(1000);
  expect(camera.position.toArray()).toEqual([0, 0, 0]);
  transition.update(1000 + CAMERA_TRANSITION_MS / 2);
  expect(camera.position.x).toBeGreaterThan(0);
  expect(camera.position.x).toBeLessThan(10);
  expect(camera.quaternion.angleTo(target.quaternion)).toBeGreaterThan(0);
  expect(camera.fov).toBeGreaterThan(50);
  expect(camera.fov).toBeLessThan(80);
  transition.update(1000 + CAMERA_TRANSITION_MS);
  expect(transition.active).toBe(false);
  expect(camera.position.toArray()).toEqual(target.position.toArray());
  expect(camera.quaternion.angleTo(target.quaternion)).toBeCloseTo(0);
  camera.projectionMatrix.elements.forEach((value, index) =>
    expect(value).toBeCloseTo(target.projectionMatrix.elements[index]),
  );
  const product = camera.projectionMatrix
    .clone()
    .multiply(camera.projectionMatrixInverse);
  product.elements.forEach((value, index) =>
    expect(value).toBeCloseTo(new Matrix4().elements[index]),
  );
});

test("rapid camera jumps retarget from the visible pose and cancellation yields to fly input", () => {
  const camera = new PerspectiveCamera(50);
  const transition = new CameraTransition(camera);
  const first = camera.clone();
  first.position.x = 10;
  transition.start(first, 0);
  transition.update(60);
  const visible = camera.position.clone();
  const second = camera.clone();
  second.position.x = -5;
  transition.start(second, 60);
  transition.update(60);
  expect(camera.position.toArray()).toEqual(visible.toArray());
  transition.update(100);
  expect(camera.position.x).toBeLessThan(visible.x);
  transition.cancel();
  camera.position.set(3, 4, 5);
  transition.update(1000);
  expect(camera.position.toArray()).toEqual([3, 4, 5]);
  expect(transition.active).toBe(false);
  transition.start(second, 1000);
  transition.finish();
  expect(camera.position.toArray()).toEqual(second.position.toArray());
  expect(transition.active).toBe(false);
});

test("multi-selection world rotation undoes as one edit across parents", () => {
  const workspace = scene();
  const original = structuredClone(workspace.nodes);
  const pivot = new Matrix4().makeTranslation(2, 1, 0);
  const delta = pivot
    .clone()
    .multiply(new Matrix4().makeRotationZ(Math.PI / 2))
    .multiply(pivot.clone().invert());
  const ids = selectedRoots(workspace.nodes, workspace.selection);
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: transformNodes(workspace.nodes, ids, delta),
  });
  for (const id of ids) {
    const expected = delta
      .clone()
      .multiply(worldMatrix(original[id], original));
    worldMatrix(workspace.nodes[id], workspace.nodes).elements.forEach((v, i) =>
      expect(v).toBeCloseTo(expected.elements[i]),
    );
  }
  expect(workspace.undo).toHaveLength(1);
  const transformed = structuredClone(workspace.nodes);
  applyCommand(workspace, { type: "history.undo" });
  expect(workspace.nodes).toEqual(original);
  applyCommand(workspace, { type: "history.redo" });
  expect(workspace.nodes).toEqual(transformed);
});

test("parent plus child selection moves the child once and deletion undo restores selection", () => {
  const workspace = scene();
  applyCommand(workspace, {
    type: "selection.set",
    ids: ["parent", "child", "other"],
    primaryId: "child",
    anchorId: "parent",
  });
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: transformNodes(
      workspace.nodes,
      selectedRoots(workspace.nodes, workspace.selection),
      new Matrix4().makeTranslation(3, -1, 2),
    ),
  });
  expect(
    new Vector3()
      .setFromMatrixPosition(
        worldMatrix(workspace.nodes.child, workspace.nodes),
      )
      .toArray(),
  ).toEqual([8, -1, 2]);
  applyCommand(workspace, { type: "nodes.remove", ids: workspace.selection });
  expect(Object.keys(workspace.nodes)).toHaveLength(0);
  applyCommand(workspace, { type: "history.undo" });
  expect(workspace.selection).toEqual(["parent", "child", "other"]);
  expect(workspace.primaryId).toBe("child");
  expect(workspace.selectionAnchor).toBe("parent");
});

test("duplicate hierarchies retain IDs and selection through undo/redo after reload", () => {
  let workspace = scene();
  applyCommand(workspace, {
    type: "selection.set",
    ids: ["parent", "child", "other"],
  });
  applyCommand(workspace, {
    type: "nodes.duplicate",
    ids: workspace.selection,
  });
  const copies = structuredClone(workspace.nodes);
  const selection = [...workspace.selection];
  expect(selection).toHaveLength(2);
  workspace = workspaceSchema.parse(JSON.parse(JSON.stringify(workspace)));
  applyCommand(workspace, { type: "history.undo" });
  expect(Object.keys(workspace.nodes)).toHaveLength(3);
  expect(workspace.selection).toEqual(["parent", "child", "other"]);
  applyCommand(workspace, { type: "history.redo" });
  expect(workspace.nodes).toEqual(copies);
  expect(workspace.selection).toEqual(selection);
});

test("camera and display undo leaves panel layout alone", () => {
  const workspace = scene();
  const original = structuredClone(workspace.settings);
  const camera = structuredClone(original.viewportCamera);
  camera.extrinsics.position = [8, 3, 2];
  applyCommand(workspace, {
    type: "workspace.update",
    settings: { viewportCamera: camera },
  });
  applyCommand(workspace, {
    type: "workspace.update",
    settings: {
      display: { ...workspace.settings.display, showFrustums: false },
      grid: false,
      pointSize: 4,
    },
  });
  applyCommand(workspace, {
    type: "workspace.update",
    settings: { layout: { ...workspace.settings.layout, rightWidth: 260 } },
  });
  applyCommand(workspace, { type: "history.undo" });
  expect(workspace.settings.display).toEqual(original.display);
  expect(workspace.settings.grid).toBe(original.grid);
  expect(workspace.settings.pointSize).toBe(original.pointSize);
  expect(workspace.settings.viewportCamera).toEqual(camera);
  applyCommand(workspace, { type: "history.undo" });
  expect(workspace.settings.viewportCamera).toEqual(original.viewportCamera);
  expect(workspace.settings.layout.rightWidth).toBe(260);
});

test("rotation under nonuniform parent rejects unrepresentable shear", () => {
  const workspace = scene();
  workspace.nodes.parent.transform.scale = [2, 1, 1];
  expect(() =>
    transformNodes(
      workspace.nodes,
      ["child"],
      new Matrix4().makeRotationZ(Math.PI / 4),
    ),
  ).toThrow("shear");
});

test("fly uses horizontal WASD and vertical QE at consistent diagonal speed", () => {
  const camera = new PerspectiveCamera();
  camera.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 4);
  moveFlyCamera(camera, new Set(["w"]), 0.02, 5);
  expect(camera.position.toArray()).toEqual([0, 0, -0.1]);
  camera.position.set(0, 0, 0);
  moveFlyCamera(camera, new Set(["w", "e"]), 0.02, 5);
  expect(camera.position.length()).toBeCloseTo(0.1);
  expect(camera.position.y).toBeGreaterThan(0);
  expect(camera.position.z).toBeLessThan(0);
  camera.position.set(0, 0, 0);
  moveFlyCamera(camera, new Set(["q"]), 0.02, 5);
  expect(camera.position.toArray()).toEqual([0, -0.1, 0]);
});

test("uniform multi-object scaling preserves rotation and undoes in one edit", () => {
  const workspace = scene();
  workspace.nodes.child.transform.quaternion = [
    0,
    0,
    Math.sin(Math.PI / 8),
    Math.cos(Math.PI / 8),
  ];
  const before = structuredClone(workspace.nodes);
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: transformNodes(
      workspace.nodes,
      workspace.selection,
      new Matrix4().makeScale(2, 2, 2),
    ),
  });
  expect(workspace.nodes.child.transform.scale).toEqual([2, 2, 2]);
  expect(workspace.nodes.other.transform.scale).toEqual([2, 2, 2]);
  workspace.nodes.child.transform.quaternion.forEach((value, index) =>
    expect(value).toBeCloseTo(before.child.transform.quaternion[index]),
  );
  applyCommand(workspace, { type: "history.undo" });
  expect(workspace.nodes).toEqual(before);
});

test("placing cameras accumulates selection, creates an ordered path, and survives undo and reload", () => {
  const workspace = emptyWorkspace();
  const a = structuredClone(workspace.settings.viewportCamera);
  a.extrinsics.position = [1, 2, 3];
  const b = structuredClone(a);
  b.extrinsics.position = [5, 2, 3];
  applyCommand(workspace, { type: "camera.place", camera: a });
  const first = workspace.primaryId!;
  applyCommand(workspace, { type: "camera.place", camera: b });
  const second = workspace.primaryId!;
  expect(workspace.selection).toEqual([first, second]);
  expect(sceneCamera(workspace, second)!.extrinsics.position).toEqual([
    5, 2, 3,
  ]);
  expect(workspace.nodes[second].parentId).toBeNull();
  applyCommand(workspace, { type: "history.undo" });
  expect(workspace.selection).toEqual([first]);
  expect(workspace.nodes[second]).toBeUndefined();
  applyCommand(workspace, { type: "history.redo" });
  applyCommand(workspace, {
    type: "path.fromCameras",
    nodeIds: workspace.selection,
    targetFrameCount: 8,
  });
  const path = workspace.nodes[workspace.primaryId!];
  const frames = samplePath(path, workspace.nodes, 8);
  expect(frames[0].extrinsics.position).toEqual([1, 2, 3]);
  expect(frames.at(-1)!.extrinsics.position).toEqual([5, 2, 3]);
  const restored = workspaceSchema.parse(JSON.parse(JSON.stringify(workspace)));
  applyCommand(restored, { type: "history.undo" });
  expect(restored.selection).toEqual([first, second]);
  applyCommand(restored, { type: "history.redo" });
  expect(restored.nodes[path.id]).toEqual(path);
});

test("a mixed selection cannot scale a node that disables scaling", () => {
  const workspace = scene();
  applyCommand(workspace, { type: "camera.place" });
  const cameraId = workspace.primaryId!;
  const nodes = [workspace.nodes.other, workspace.nodes[cameraId]];
  expect(transformCapabilities(nodes)).toEqual({
    translate: true,
    rotate: true,
    scale: false,
  });
  const before = structuredClone(workspace);
  expect(() =>
    applyCommand(workspace, {
      type: "nodes.put",
      nodes: transformNodes(
        workspace.nodes,
        nodes.map((node) => node.id),
        new Matrix4().makeScale(2, 2, 2),
      ),
    }),
  ).toThrow("does not support scaling");
  expect(workspace).toEqual(before);
});

test("scaling ordinary nodes remains undoable", () => {
  const workspace = scene();
  expect(transformCapabilities([workspace.nodes.other]).scale).toBe(true);
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: transformNodes(
      workspace.nodes,
      ["other"],
      new Matrix4().makeScale(2, 3, 4),
    ),
  });
  expect(workspace.nodes.other.transform.scale).toEqual([2, 3, 4]);
  applyCommand(workspace, { type: "history.undo" });
  expect(workspace.nodes.other.transform.scale).toEqual([1, 1, 1]);
});

test("camera pose has one authority through reparenting, mixed transforms, undo and export", () => {
  const workspace = scene();
  workspace.nodes.parent.transform.quaternion = [
    0,
    Math.sin(0.3),
    0,
    Math.cos(0.3),
  ];
  const input = structuredClone(workspace.settings.viewportCamera);
  input.extrinsics.position = [20, 5, -30];
  input.extrinsics.coordinateSystem = "rdf";
  applyCommand(workspace, { type: "camera.place", camera: input });
  const id = workspace.primaryId!;
  expect(workspace.nodes[id].transform.position).toEqual(
    input.extrinsics.position,
  );
  expect(workspace.nodes[id].projection).toEqual(input.intrinsics);
  expect(workspace.nodes[id]).not.toHaveProperty("camera");
  const original = cameraMatrix(input);
  applyCommand(workspace, {
    type: "nodes.reparent",
    ids: [id],
    parentId: "parent",
  });
  worldMatrix(workspace.nodes[id], workspace.nodes).elements.forEach(
    (value, index) => expect(value).toBeCloseTo(original.elements[index]),
  );
  const before = structuredClone(workspace.nodes);
  const delta = new Matrix4().makeRotationY(0.7).setPosition(2, 1, -3);
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: transformNodes(workspace.nodes, [id, "other"], delta),
  });
  const expected = delta.clone().multiply(original);
  cameraMatrix(sceneCamera(workspace, id)!).elements.forEach((value, index) =>
    expect(value).toBeCloseTo(expected.elements[index]),
  );
  const restored = workspaceSchema.parse(JSON.parse(JSON.stringify(workspace)));
  applyCommand(restored, { type: "history.undo" });
  expect(restored.nodes).toEqual(before);
  applyCommand(restored, { type: "history.redo" });
  expect(restored.nodes).toEqual(workspace.nodes);
  expect(() =>
    nodeSchema.parse({ ...workspace.nodes[id], camera: input }),
  ).toThrow();
  expect(() =>
    nodeSchema.parse({
      ...workspace.nodes[id],
      projection: { ...input.intrinsics, extrinsics: input.extrinsics },
    }),
  ).toThrow();
});

test("path FOV and target frames drive both preview and generation and are undoable properties", () => {
  const workspace = emptyWorkspace();
  applyCommand(workspace, { type: "camera.place" });
  applyCommand(workspace, { type: "camera.place" });
  applyCommand(workspace, {
    type: "path.fromCameras",
    nodeIds: workspace.selection,
    targetFrameCount: 60,
  });
  const path = workspace.nodes[workspace.primaryId!];
  applyCommand(workspace, {
    type: "path.update",
    pathId: path.id,
    fov: 80,
    targetFrameCount: 96,
  });
  const input = generationInput(workspace, { kind: "video" });
  if (input.kind !== "video") throw new Error("Expected video input");
  expect(input.pathId).toBe(path.id);
  expect(input.targetFrameCount).toBe(96);
  expect(workspace.nodes[path.id].keyframes).toEqual(path.keyframes);
  const frames = samplePath(
    workspace.nodes[path.id],
    workspace.nodes,
    input.targetFrameCount,
  );
  for (const camera of [frames[0], frames.at(-1)!])
    expect(
      (2 *
        Math.atan(camera.intrinsics.height / (2 * camera.intrinsics.fy)) *
        180) /
        Math.PI,
    ).toBeCloseTo(80);
  applyCommand(workspace, { type: "history.undo" });
  expect(workspace.nodes[path.id].fov).toEqual(path.fov);
  applyCommand(workspace, { type: "history.redo" });
  expect(workspace.nodes[path.id].fov).toBe(80);
});

test("fly mouse deltas increase yaw and pitch on both axes", () => {
  const camera = new PerspectiveCamera(50);
  lookFlyCamera(camera, 20, 10);
  const rotation = new Euler().setFromQuaternion(camera.quaternion, "YXZ");
  expect(rotation.y).toBeCloseTo(0.06);
  expect(rotation.x).toBeCloseTo(0.03);
});

test("H visibility applies one value to a mixed selection and undoes as one edit", () => {
  const workspace = scene();
  workspace.selection = ["parent", "child", "other"];
  workspace.nodes.child.visible = false;
  const before = structuredClone(workspace.nodes);
  const edits = workspace.undo.length;
  applyCommand(workspace, { type: "selection.visibility" });
  expect(workspace.selection.map((id) => workspace.nodes[id].visible)).toEqual([
    false,
    false,
    false,
  ]);
  expect(workspace.undo.length).toBe(edits + 1);
  applyCommand(workspace, { type: "selection.visibility" });
  expect(workspace.selection.map((id) => workspace.nodes[id].visible)).toEqual([
    true,
    true,
    true,
  ]);
  applyCommand(workspace, { type: "history.undo" });
  applyCommand(workspace, { type: "history.undo" });
  expect(workspace.nodes).toEqual(before);
});
