import { captureNodes, captureFrameStatus, orderedCaptures } from "./captures";
import { frameAssets } from "./frames";
import type { JobInput, Workspace } from "./schema";
export type PreviewItem = {
  assetId: string;
  label: string;
  nodeId?: string;
  jobId?: string;
  status?: string;
};
export function previewItems(
  workspace: Workspace,
  input: Extract<JobInput, { kind: "contactSheet" }>,
): PreviewItem[] {
  if ([input.nodeIds, input.jobIds, input.assetIds].filter(Boolean).length > 1)
    throw new Error(
      "Choose nodes, jobs, or assets for a preview, not multiple selectors",
    );
  let items: PreviewItem[];
  if (input.assetIds)
    items = input.assetIds.map((assetId) => ({
      assetId,
      label: workspace.assets[assetId]?.name ?? assetId,
    }));
  else if (input.jobIds)
    items = input.jobIds.flatMap((id) => {
      const job = workspace.jobs[id];
      if (!job || job.status !== "succeeded")
        throw new Error(`Choose completed jobs: ${id}`);
      return frameAssets(workspace, job).map((asset) => ({
        assetId: asset.id,
        label: asset.name,
        jobId: id,
      }));
    });
  else
    items = (
      input.nodeIds ?? orderedCaptures(workspace).map((node) => node.id)
    ).map((id) => {
      const node = workspace.nodes[id];
      if (!node) throw new Error(`Node does not exist: ${id}`);
      const image =
        node.kind === "image" ? node : captureNodes(workspace, id).image;
      if (!image.assetId) throw new Error(`${node.name}: image has no asset`);
      const status = captureFrameStatus(workspace, id);
      return {
        assetId: image.assetId,
        label: node.name,
        nodeId: id,
        status: status.frame ? "Posed RGBD" : status.error,
      };
    });
  if (!items.length || items.length > 128)
    throw new Error("Choose between 1 and 128 images for a contact sheet");
  const columns = Math.min(input.columns, items.length);
  if (
    columns *
      input.width *
      Math.ceil(items.length / columns) *
      (Math.round((input.width * 9) / 16) + 44) >
    32_000_000
  )
    throw new Error(
      "Contact sheet exceeds 32 megapixels; reduce --width or select fewer images",
    );
  for (const item of items) {
    const asset = workspace.assets[item.assetId];
    if (!asset || asset.kind !== "image" || asset.missing || asset.trashedAt)
      throw new Error(`Preview image unavailable: ${item.assetId}`);
  }
  return items;
}
