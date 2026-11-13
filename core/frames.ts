import { imageIndex } from "./images";
import type { Job, Workspace } from "./schema";

export function frameAssets(
  workspace: Pick<Workspace, "assets" | "nodes" | "imageVersions">,
  job: Job,
) {
  const index = imageIndex(workspace);
  return (job.frameAssetIds ?? job.outputAssetIds).flatMap((id) => {
    const active = workspace.imageVersions[index.roots.get(id)!] ?? id;
    const asset = workspace.assets[active];
    return asset?.kind === "image" ? [asset] : [];
  });
}

export function keyframeIndices(count: number, requested: number) {
  if (count < 2) throw new Error("A sequence needs at least two frames");
  const size = Math.min(count, requested);
  return Array.from({ length: size }, (_, i) =>
    Math.round((i * (count - 1)) / (size - 1)),
  );
}

export function frameAt(
  workspace: Pick<Workspace, "assets" | "nodes" | "imageVersions">,
  job: Job,
  index: number,
) {
  return frameAssets(workspace, job).find(
    (asset, position) =>
      (asset.frameIndex ?? job.frameIndices?.[position] ?? position) === index,
  );
}
