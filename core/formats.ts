import type { Workspace } from "./schema";

/** Camera grids every Atlas, splats, and posing request accepts; a session uses one. */
export const ATLAS_FORMATS = [
  { width: 1280, height: 720, aspectRatio: "16:9" },
  { width: 960, height: 720, aspectRatio: "4:3" },
  { width: 528, height: 704, aspectRatio: "3:4" },
  { width: 720, height: 1280, aspectRatio: "9:16" },
] as const;

export type Resolution = { width: number; height: number };

/** Crop position within the available travel, from 0 (left/top) to 1 (right/bottom). */
export type CropPosition = { x: number; y: number };

export function closestFormat({ width, height }: Resolution) {
  const aspect = Math.log(width / height);
  let best: (typeof ATLAS_FORMATS)[number] = ATLAS_FORMATS[0];
  for (const format of ATLAS_FORMATS)
    if (
      Math.abs(Math.log(format.width / format.height) - aspect) <
      Math.abs(Math.log(best.width / best.height) - aspect)
    )
      best = format;
  return best;
}

/** The largest region of `source` with the format's aspect, placed at `position`. */
export function importCropRect(
  source: Resolution,
  resolution: Resolution,
  position?: CropPosition,
) {
  const scale = Math.max(
    resolution.width / source.width,
    resolution.height / source.height,
  );
  const width = Math.min(source.width, resolution.width / scale);
  const height = Math.min(source.height, resolution.height / scale);
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return {
    x: (source.width - width) * clamp(position?.x ?? 0.5),
    y: (source.height - height) * clamp(position?.y ?? 0.5),
    width,
    height,
  };
}

/** The format chosen on first import, or the one the first posed capture implies; null before any. */
export function lockedFormat(
  workspace: Pick<Workspace, "nodes" | "assets"> & {
    settings: Pick<Workspace["settings"], "format">;
  },
): Resolution | null {
  if (workspace.settings.format) return workspace.settings.format;
  for (const node of Object.values(workspace.nodes)) {
    const camera =
      node.kind === "capture" && node.assetId
        ? workspace.assets[node.assetId]?.camera
        : undefined;
    if (camera) return closestFormat(camera.intrinsics);
  }
  return null;
}

export function sessionFormat(
  workspace: Parameters<typeof lockedFormat>[0],
): Resolution {
  const { width, height } = lockedFormat(workspace) ?? ATLAS_FORMATS[0];
  return { width, height };
}
