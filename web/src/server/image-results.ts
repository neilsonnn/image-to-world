import { applyJobResult } from "../../../core/result-targets";
import { imageIndex, imageReplacementCommands } from "../../../core/images";
import type { Asset, Job, Workspace } from "../../../core/schema";
import type { WorkspaceStore } from "./store";

export function nanoGeometry(workspace: Workspace, job: Job) {
  if (job.input.kind !== "nano") return {};
  const source = workspace.assets[job.input.sourceAssetId];
  const first = job.applyTargets?.find((target) => "pointsId" in target);
  const points = first && workspace.nodes[first.pointsId];
  const geometryId = points
    ? (points.geometryAssetId ?? points.assetId)
    : source.depthAssetId
      ? source.id
      : source.geometrySourceAssetId;
  const geometry = geometryId ? workspace.assets[geometryId] : undefined;
  const provenance = {
    frameIndex: source.frameIndex,
    frameTime: source.frameTime,
    sourceVideoId: source.sourceVideoId,
  };
  return geometry?.depthAssetId
    ? {
        ...provenance,
        geometrySourceAssetId: geometry.id,
        camera: geometry.camera,
      }
    : provenance;
}

export async function applyNanoResult(
  store: WorkspaceStore,
  job: Job,
  asset: Asset,
  signal: AbortSignal,
) {
  if (job.input.kind !== "nano" || !job.input.applyToScene) return;
  await store.update((state) => {
    signal.throwIfAborted();
    applyJobResult(state, job, (targets, roots) => {
      const root = imageIndex(state).roots.get(asset.id)!;
      return imageReplacementCommands(
        state,
        asset.id,
        targets.map((target) => target.nodeId),
        roots.includes(root),
      );
    });
  });
  const state = store.snapshot();
  const owner = job.resultOwnerId ?? job.id;
  return (
    job.input.reconstruct &&
    !!asset.geometrySourceAssetId &&
    state.jobs[job.id].applied &&
    ((job.applyTargets ?? []).some(
      (target) => state.resultOwners[`node:${target.nodeId}`] === owner,
    ) ||
      job.applyRoots.some(
        (root) => state.resultOwners[`image:${root}`] === owner,
      ))
  );
}
