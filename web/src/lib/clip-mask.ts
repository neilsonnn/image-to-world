import { Vector3 } from "three";
import {
  captureFrame,
  captureRoot,
  captureNodes,
} from "../../../core/captures";
import { worldMatrix } from "../../../core/cameras";
import { clipMasks, clippedOpacity } from "../../../core/clips";
import { depthIntrinsics, type DepthGrid } from "../../../core/depth";
import { assetUrl, type Workspace } from "../../../core/schema";

export function selectedCaptureMask(
  workspace: Pick<Workspace, "nodes" | "assets" | "primaryId" | "selection">,
  imageId: string | undefined,
) {
  const id = workspace.primaryId ?? workspace.selection.at(-1);
  const root = id && captureRoot(workspace, id);
  if (!root) return null;
  if (captureNodes(workspace, root.id).image.assetId !== imageId) return null;
  const frame = captureFrame(workspace, root.id);
  if (!frame || frame.asset.id !== imageId) return null;
  return {
    imageId,
    depthUrl: assetUrl(workspace.assets[frame.asset.depthAssetId]),
    encoding: frame.asset.depthEncoding,
    camera: frame.asset.camera,
    matrix: worldMatrix(frame.points, workspace.nodes),
    clips: clipMasks(workspace, frame.points.id),
  };
}

export type CaptureMask = NonNullable<ReturnType<typeof selectedCaptureMask>>;

export function renderClipMask(depth: DepthGrid, mask: CaptureMask) {
  // Bound preview work during drags; source images and generation masks keep their resolution.
  const scale = Math.min(1, 512 / Math.max(depth.width, depth.height));
  const width = Math.max(1, Math.round(depth.width * scale));
  const height = Math.max(1, Math.round(depth.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  const c = depthIntrinsics(mask.camera, depth.width, depth.height);
  const point = new Vector3();
  for (let y = 0; y < height; y++) {
    const sy = Math.min(
      depth.height - 1,
      Math.floor(((y + 0.5) * depth.height) / height),
    );
    for (let x = 0; x < width; x++) {
      const sx = Math.min(
        depth.width - 1,
        Math.floor(((x + 0.5) * depth.width) / width),
      );
      const z = depth.data[(sy * depth.width + sx) * depth.stride];
      if (!Number.isFinite(z) || z <= 0) continue;
      point
        .set(
          ((sx + 0.5 - c.cx) / c.fx) * z,
          (-(sy + 0.5 - c.cy) / c.fy) * z,
          -z,
        )
        .applyMatrix4(mask.matrix);
      data[(y * width + x) * 4 + 3] = Math.round(
        255 * (1 - clippedOpacity(point, mask.clips)),
      );
    }
  }
  return { data, width, height };
}
