import { expect, test } from "bun:test";
import { applyCommand } from "./commands";
import { samplePath } from "./cameras";
import { generationInput } from "./generation";
import { emptyWorkspace, identity, workspaceSchema } from "./schema";

function cameraAt(x: number) {
  const camera = emptyWorkspace().settings.viewportCamera;
  camera.extrinsics.position = [x, 0, 0];
  return camera;
}

test("ordered keyframe edits preserve target count, with FPS affecting only playback", () => {
  const workspace = emptyWorkspace();
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: [
      {
        id: "path",
        name: "Path",
        kind: "path",
        parentId: null,
        visible: true,
        transform: identity(),
        targetFrameCount: 5,
        keyframes: [
          { id: "a", camera: cameraAt(0) },
          { id: "b", camera: cameraAt(10) },
          { id: "c", camera: cameraAt(20) },
        ],
      },
    ],
  });
  const positions = () =>
    samplePath(
      workspace.nodes.path,
      workspace.nodes,
      workspace.nodes.path.targetFrameCount!,
    ).map((camera) => camera.extrinsics.position[0]);
  expect(positions()).toEqual([0, 5, 10, 15, 20]);
  applyCommand(workspace, {
    type: "path.keyframe",
    pathId: "path",
    id: "c",
    index: 0,
  });
  expect(positions()).toEqual([20, 10, 0, 5, 10]);
  applyCommand(workspace, {
    type: "path.keyframe",
    pathId: "path",
    id: "c",
    remove: true,
  });
  expect(positions()).toEqual([0, 2.5, 5, 7.5, 10]);
  applyCommand(workspace, {
    type: "path.keyframe",
    pathId: "path",
    camera: cameraAt(30),
  });
  expect(positions()).toEqual([0, 5, 10, 20, 30]);
  const first = generationInput(workspace, {
    kind: "video",
    pathId: "path",
    fps: 12,
  });
  const second = generationInput(workspace, {
    kind: "video",
    pathId: "path",
    fps: 24,
  });
  expect(first).toMatchObject({ targetFrameCount: 5, fps: 12 });
  expect(second).toMatchObject({ targetFrameCount: 5, fps: 24 });
  const restored = workspaceSchema.parse(JSON.parse(JSON.stringify(workspace)));
  applyCommand(restored, { type: "history.undo" });
  expect(restored.nodes.path.keyframes).toHaveLength(2);
  expect(restored.nodes.path.targetFrameCount).toBe(5);
  applyCommand(restored, { type: "history.redo" });
  expect(
    restored.nodes.path.keyframes!.at(-1)!.camera.extrinsics.position[0],
  ).toBe(30);
});
