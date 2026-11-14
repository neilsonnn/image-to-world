import { expect, test } from "bun:test";
import { Box3, Quaternion, Vector3 } from "three";
import { aimCamera, cameraMatrix, worldMatrix } from "./cameras";
import { inspectScene } from "./inspection";
import { applyCommand } from "./commands";
import { createCapture, sceneCamera } from "./captures";
import { assetSchema, emptyWorkspace, nodeSchema } from "./schema";
import { previewItems } from "./previews";

function fixture() {
  const workspace = emptyWorkspace();
  workspace.nodes.parent = nodeSchema.parse({
    id: "parent",
    name: "Room",
    kind: "group",
    transform: {
      position: [7, 3, -4],
      quaternion: new Quaternion()
        .setFromAxisAngle(new Vector3(0, 1, 0), 0.8)
        .toArray(),
      scale: [2, 3, 4],
    },
  });
  return workspace;
}

test("look-at transforms position, target, and up from a rotated, translated, nonuniformly scaled frame", () => {
  const workspace = fixture();
  const aim = {
    position: [1, 2, 3] as [number, number, number],
    target: [-3, 0, -5] as [number, number, number],
    frameId: "parent",
    fov: 70,
  };
  const before = JSON.stringify(workspace);
  const camera = aimCamera(
    workspace,
    aim,
    workspace.settings.viewportCamera.intrinsics,
  );
  const matrix = worldMatrix(workspace.nodes.parent, workspace.nodes);
  const position = new Vector3(...aim.position).applyMatrix4(matrix);
  const target = new Vector3(...aim.target).applyMatrix4(matrix);
  expect(
    new Vector3(...camera.extrinsics.position).distanceTo(position),
  ).toBeLessThan(1e-8);
  const forward = new Vector3(0, 0, -1).transformDirection(
    cameraMatrix(camera),
  );
  expect(forward.dot(target.sub(position).normalize())).toBeCloseTo(1, 8);
  expect(camera.intrinsics.fy).toBeCloseTo(
    720 / (2 * Math.tan((35 * Math.PI) / 180)),
  );
  expect(JSON.stringify(workspace)).toBe(before);
  applyCommand(workspace, {
    type: "camera.aim",
    aim,
    name: "Window-side view",
  });
  const id = workspace.primaryId!;
  expect(workspace.nodes[id].name).toBe("Window-side view");
  expect(sceneCamera(workspace, id)!.extrinsics.position).toEqual(
    camera.extrinsics.position,
  );
  applyCommand(workspace, { type: "history.undo" });
  expect(workspace.nodes[id]).toBeUndefined();
  applyCommand(workspace, { type: "history.redo" });
  expect(sceneCamera(workspace, id)!.extrinsics.position).toEqual(
    camera.extrinsics.position,
  );
});

test("look-at rejects ambiguous up, coincident targets, and nonexistent coordinate frames", () => {
  const workspace = fixture(),
    projection = workspace.settings.viewportCamera.intrinsics;
  expect(() =>
    aimCamera(
      workspace,
      { position: [0, 0, 0], target: [0, 0, 0] },
      projection,
    ),
  ).toThrow("must differ");
  expect(() =>
    aimCamera(
      workspace,
      { position: [0, 0, 0], target: [0, 1, 0] },
      projection,
    ),
  ).toThrow("not parallel");
  expect(() =>
    aimCamera(
      workspace,
      { position: [0, 0, 0], target: [0, 0, -1], up: [0, 0, 0] },
      projection,
    ),
  ).toThrow("nonzero");
  expect(() =>
    aimCamera(
      workspace,
      { position: [0, 0, 0], target: [0, 0, -1], frameId: "missing" },
      projection,
    ),
  ).toThrow("does not exist");
});

test("inspection reports world poses, broken frames and unavailable geometry explicitly without mutations", () => {
  const workspace = fixture();
  const image = assetSchema.parse({
    id: "image",
    name: "Image",
    path: "image.png",
    kind: "image",
    mimeType: "image/png",
    size: 1,
    modifiedAt: 1,
  });
  workspace.assets.image = image;
  for (const node of createCapture(image, "frame"))
    workspace.nodes[node.id] = node;
  workspace.nodes.frame.parentId = "parent";
  const before = JSON.stringify(workspace);
  const headless = inspectScene(workspace);
  expect(headless.source).toBe("headless");
  expect(headless.bounds).toBeNull();
  expect(headless.context.usable).toEqual([]);
  expect(headless.context.broken[0].reason).toContain("depth");
  expect(
    headless.nodes.find((n) => n.id === "frame_camera")!.camera!.extrinsics
      .position,
  ).toEqual(sceneCamera(workspace, "frame")!.extrinsics.position);
  const bounds = new Box3(new Vector3(-1, -2, -3), new Vector3(4, 5, 6));
  const rendered = inspectScene(workspace, ["frame"], () => bounds);
  expect(rendered.source).toBe("viewport");
  expect(rendered.bounds).toEqual({ min: [-1, -2, -3], max: [4, 5, 6] });
  expect(rendered.nodes.map((n) => n.id)).not.toContain("parent");
  expect(
    rendered.nodes.find((n) => n.id === "frame_camera")!.transforms.scale,
  ).toBe(false);
  expect(() => inspectScene(workspace, ["missing"])).toThrow("does not exist");
  expect(JSON.stringify(workspace)).toBe(before);
});

test("preview selectors use participating image bindings and reject mixed or invalid inputs", () => {
  const workspace = fixture();
  for (const id of ["original", "edited"])
    workspace.assets[id] = assetSchema.parse({
      id,
      name: id,
      path: `${id}.png`,
      kind: "image",
      mimeType: "image/png",
      size: 1,
      modifiedAt: 1,
    });
  for (const node of createCapture(workspace.assets.original, "frame"))
    workspace.nodes[node.id] = node;
  workspace.nodes.frame_image.assetId = "edited";
  const input = { kind: "contactSheet" as const, columns: 3, width: 384 };
  expect(previewItems(workspace, input)[0].assetId).toBe("edited");
  expect(() =>
    previewItems(workspace, {
      ...input,
      nodeIds: ["frame"],
      assetIds: ["original"],
    }),
  ).toThrow("not multiple");
  expect(() =>
    previewItems(workspace, { ...input, assetIds: ["missing"] }),
  ).toThrow("unavailable");
});
