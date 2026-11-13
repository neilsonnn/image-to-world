import { expect, test } from "bun:test";
import { applyCommand } from "./commands";
import { createCapture, captureFrame, sceneCamera } from "./captures";
import { imageIndex } from "./images";
import { generationInput } from "./generation";
import { emptyWorkspace, assetSchema, workspaceSchema } from "./schema";
import { cameraMatrix, transformCamera } from "./cameras";
import { registerCameras } from "./registration";
import { Matrix4, Quaternion, Vector3 } from "three";

function fixture() {
  const w = emptyWorkspace();
  const photo = assetSchema.parse({
    id: "photo",
    name: "Photo",
    path: "photo.png",
    kind: "image",
    mimeType: "image/png",
    size: 1,
    modifiedAt: 0,
    camera: w.settings.viewportCamera,
    depthAssetId: "depth",
  });
  const edit = {
    ...photo,
    id: "edit",
    path: "edit.png",
    parentAssetId: photo.id,
    camera: undefined,
    depthAssetId: undefined,
  };
  w.assets = {
    photo,
    edit,
    depth: { ...photo, id: "depth", kind: "depth", depthAssetId: undefined },
  };
  applyCommand(w, {
    type: "nodes.put",
    nodes: [...createCapture(photo, "a"), ...createCapture(photo, "b")],
  });
  return w;
}

test("activating a history version recolors every linked capture while preserving geometry and placement through undo and reload", () => {
  const w = fixture();
  const before = sceneCamera(w, "a");
  applyCommand(w, { type: "image.activate", assetId: "edit" });
  expect(imageIndex(w).capturesByAsset.get("edit")).toEqual(["a", "b"]);
  expect(w.nodes.a_image.assetId).toBe("edit");
  expect(w.nodes.a_points.assetId).toBe("edit");
  expect(captureFrame(w, "a")?.asset.depthAssetId).toBe("depth");
  expect(sceneCamera(w, "a")).toEqual(before);
  const restored = workspaceSchema.parse(JSON.parse(JSON.stringify(w)));
  expect(imageIndex(restored).capturesByRoot.get("photo")).toEqual(["a", "b"]);
  applyCommand(restored, { type: "history.undo" });
  expect(restored.nodes.a.assetId).toBe("photo");
  expect(restored.nodes.b.assetId).toBe("photo");
  applyCommand(restored, { type: "history.redo" });
  expect(restored.nodes.a.assetId).toBe("edit");
});

test("activation can target one capture and rejects unrelated histories without partial changes", () => {
  const w = fixture();
  applyCommand(w, {
    type: "image.activate",
    assetId: "edit",
    nodeIds: ["a_image"],
  });
  expect(w.nodes.a.assetId).toBe("edit");
  expect(w.nodes.b.assetId).toBe("photo");
  w.assets.other = { ...w.assets.edit, id: "other", parentAssetId: undefined };
  const before = JSON.stringify(w);
  expect(() =>
    applyCommand(w, {
      type: "image.activate",
      assetId: "other",
      nodeIds: ["a"],
    }),
  ).toThrow("different image history");
  expect(JSON.stringify(w)).toBe(before);
});

test("scene geometry is reused as Atlas context after a color edit", () => {
  const w = fixture();
  applyCommand(w, { type: "image.activate", assetId: "edit" });
  const input = generationInput(w, { kind: "view" });
  expect(input.kind === "atlas" && input.nodeIds).toEqual(["a", "b"]);
  expect(captureFrame(w, "a")?.asset.id).toBe("edit");
});

test("registration recovers a shared scale, rotation, and translation from saved cameras", () => {
  const camera = emptyWorkspace().settings.viewportCamera;
  const solved = [0, 1, 2].map((x) => ({
    ...camera,
    extrinsics: {
      ...camera.extrinsics,
      position: [x, 1, 0] as [number, number, number],
    },
  }));
  const matrix = new Matrix4().compose(
    new Vector3(5, 2, 3),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7),
    new Vector3(3, 3, 3),
  );
  const targets = solved.map((camera) => transformCamera(camera, matrix));
  const registered = registerCameras(solved, targets);
  expect(registered.scale).toBeCloseTo(3);
  registered.matrix.elements.forEach((n, i) =>
    expect(n).toBeCloseTo(matrix.elements[i]),
  );
});

test("single-frame registration requires a depth anchor rather than inventing a scene scale", () => {
  const camera = emptyWorkspace().settings.viewportCamera;
  expect(() => registerCameras([camera], [camera])).toThrow("scale");
  expect(registerCameras([camera], [camera], 2).scale).toBe(2);
});

test("keyframes record viewport poses in a transformed path local frame and undo atomically", () => {
  const w = fixture();
  applyCommand(w, {
    type: "path.fromCameras",
    nodeIds: ["a", "b"],
    targetFrameCount: 36,
  });
  const id = w.primaryId!;
  w.nodes[id].transform.position = [4, 0, 1];
  const camera = w.settings.viewportCamera;
  applyCommand(w, { type: "path.keyframe", pathId: id, camera });
  const keyframe = w.nodes[id].keyframes!.at(-1)!;
  const expected = cameraMatrix(camera).elements[12] - 4;
  expect(keyframe.camera.extrinsics.position[0]).toBeCloseTo(expected);
  applyCommand(w, { type: "history.undo" });
  expect(w.nodes[id].keyframes).toHaveLength(2);
});

test("history activation can undo back through capture creation and redo", () => {
  const w = fixture();
  applyCommand(w, { type: "image.activate", assetId: "edit" });
  applyCommand(w, { type: "history.undo" });
  expect(w.nodes.a.assetId).toBe("photo");
  applyCommand(w, { type: "history.undo" });
  expect(Object.keys(w.nodes)).toHaveLength(0);
  applyCommand(w, { type: "history.redo" });
  applyCommand(w, { type: "history.redo" });
  expect(w.nodes.a.assetId).toBe("edit");
  expect(w.imageVersions.photo).toBe("edit");
});
