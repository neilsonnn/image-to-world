import { applyCommand } from "../../../core/commands";
import { expect, test } from "bun:test";
import { createCapture } from "../../../core/captures";
import { emptyWorkspace, identity, type Asset } from "../../../core/schema";
import { renderClipMask, selectedCaptureMask } from "./clip-mask";

function fixture() {
  const workspace = emptyWorkspace();
  const image: Asset = {
    id: "image",
    name: "Image",
    path: "image.png",
    kind: "image",
    mimeType: "image/png",
    size: 1,
    modifiedAt: 0,
    missing: false,
    depthAssetId: "depth",
    depthEncoding: { type: "linear" },
    camera: {
      extrinsics: {
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        coordinateSystem: "rub",
      },
      intrinsics: { width: 4, height: 1, fx: 2, fy: 2, cx: 2, cy: 0.5 },
    },
  };
  workspace.assets.image = image;
  workspace.assets.depth = {
    ...image,
    id: "depth",
    path: "depth.exr",
    kind: "depth",
    mimeType: "image/x-exr",
  };
  for (const node of createCapture(image, "capture"))
    workspace.nodes[node.id] = node;
  workspace.nodes.clip = {
    id: "clip",
    kind: "clip",
    name: "Clip",
    parentId: "capture",
    visible: true,
    transform: { ...identity(), position: [-1, 0, -2] },
    clip: { scope: "local", invert: false, softness: 0 },
  };
  workspace.primaryId = "clip";
  workspace.selection = ["clip"];
  const depth = {
    data: new Float32Array([2, 2, 2, 2]),
    width: 4,
    height: 1,
    stride: 1,
  };
  const alpha = () => {
    const mask = selectedCaptureMask(workspace, "image")!;
    return [...renderClipMask(depth, mask).data].filter((_, i) => i % 4 === 3);
  };
  return { workspace, depth, alpha };
}

test("clip previews follow parent transforms, inversion, and visibility", () => {
  const { workspace, alpha } = fixture();
  expect(alpha()).toEqual([255, 255, 0, 0]);
  workspace.nodes.capture.transform.position = [10, 3, -4];
  workspace.nodes.capture.transform.scale = [2, 2, 2];
  expect(alpha()).toEqual([255, 255, 0, 0]);
  workspace.nodes.clip.clip!.invert = true;
  expect(alpha()).toEqual([0, 0, 255, 255]);
  workspace.nodes.clip.visible = false;
  expect(alpha()).toEqual([0, 0, 0, 0]);
});

test("global boxes compose with local boxes, while unrelated local boxes do not", () => {
  const { workspace, alpha } = fixture();
  workspace.nodes.other = {
    ...workspace.nodes.clip,
    id: "other",
    parentId: null,
    transform: { ...identity(), position: [1, 0, -2] },
  };
  expect(alpha()).toEqual([255, 255, 0, 0]);
  workspace.nodes.other.clip = { scope: "global", invert: false, softness: 0 };
  expect(alpha()).toEqual([255, 255, 255, 255]);
});

test("soft edges retain partial opacity and invalid depth is not classified as clipped", () => {
  const { workspace, depth, alpha } = fixture();
  workspace.nodes.clip.clip!.softness = 2;
  depth.data[0] = NaN;
  expect(alpha()).toEqual([0, 191, 64, 0]);
});

test("preview resolves capture children and active edited geometry, never unrelated history or asset selection", () => {
  const { workspace } = fixture();
  expect(selectedCaptureMask(workspace, "image")).not.toBeNull();
  expect(selectedCaptureMask(workspace, "other-history-image")).toBeNull();
  workspace.assets.edited = {
    ...workspace.assets.image,
    id: "edited",
    parentAssetId: "image",
    depthAssetId: undefined,
  };
  applyCommand(workspace, { type: "image.activate", assetId: "edited" });
  expect(selectedCaptureMask(workspace, "edited")?.depthUrl).toContain("depth");
  expect(selectedCaptureMask(workspace, "image")).toBeNull();
  workspace.primaryId = "image";
  expect(selectedCaptureMask(workspace, "image")).toBeNull();
});
