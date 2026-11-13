import type { Workspace } from "./schema";
export function imageHistory(
  workspace: Pick<Workspace, "assets" | "jobs" | "imageVersions">,
  assetId: string,
) {
  const asset = workspace.assets[assetId];
  if (!asset) throw new Error(`Unknown asset ${assetId}`);
  const seen = new Set<string>();
  let root = asset;
  while (
    root.parentAssetId &&
    workspace.assets[root.parentAssetId] &&
    !seen.has(root.parentAssetId)
  ) {
    seen.add(root.id);
    root = workspace.assets[root.parentAssetId];
  }
  const family = new Set([root.id]);
  let previous = 0;
  while (previous !== family.size) {
    previous = family.size;
    for (const candidate of Object.values(workspace.assets))
      if (candidate.parentAssetId && family.has(candidate.parentAssetId))
        family.add(candidate.id);
  }
  return {
    rootId: root.id,
    activeAssetId: workspace.imageVersions[root.id] ?? null,
    assets: Object.values(workspace.assets)
      .filter((a) => family.has(a.id))
      .sort((a, b) => a.modifiedAt - b.modifiedAt),
    jobs: Object.values(workspace.jobs)
      .filter(
        (j) => j.input.kind === "nano" && family.has(j.input.sourceAssetId),
      )
      .sort((a, b) => a.createdAt - b.createdAt),
  };
}
