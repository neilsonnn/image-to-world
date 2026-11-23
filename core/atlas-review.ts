import type { Workspace } from "./schema";

export function atlasReview(
  workspace: Pick<Workspace, "atlasRound" | "assets" | "jobs">,
) {
  const round = workspace.atlasRound;
  if (!round) return null;
  const candidates = round.jobIds.map((id) => {
    const job = workspace.jobs[id];
    const assetId = job?.frameAssetIds?.[0];
    const asset = assetId ? workspace.assets[assetId] : undefined;
    const depth = asset?.depthAssetId
      ? workspace.assets[asset.depthAssetId]
      : undefined;
    const posed =
      asset?.camera &&
      !asset.missing &&
      !asset.trashedAt &&
      depth &&
      !depth.missing &&
      !depth.trashedAt;
    return {
      id,
      status: job?.status ?? "failed",
      message: job?.message,
      error:
        job?.error ??
        (!job
          ? "Atlas job unavailable"
          : job.status === "succeeded" && !posed
            ? "Posed image or depth unavailable"
            : undefined),
      assetId: job?.status === "succeeded" && posed ? assetId : undefined,
    };
  });
  const phase =
    round.decision?.kind ??
    (candidates.every((candidate) => candidate.assetId)
      ? "review"
      : candidates.some(
            (candidate) =>
              candidate.status === "queued" || candidate.status === "running",
          )
        ? "generating"
        : "failed");
  return { ...round, candidates, phase };
}
