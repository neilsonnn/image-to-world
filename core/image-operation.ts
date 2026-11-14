import { captureNodes, captureRoot } from "./captures";
import { imageIndex } from "./images";
import type { Workspace } from "./schema";

type ImageWorkspace = Pick<
  Workspace,
  "nodes" | "assets" | "jobs" | "resultOwners" | "selection" | "primaryId"
>;

/** Resolve the selected image subject and its current result owner, independent of provider/job kind. */
export function selectedImageOperation(workspace: ImageWorkspace) {
  const id = workspace.primaryId ?? workspace.selection.at(-1);
  if (!id) return null;
  const frame = captureRoot(workspace, id);
  let assetId: string | undefined;
  let error: string | undefined;
  if (frame) {
    try {
      assetId = captureNodes(workspace, frame.id).image.assetId;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  } else {
    const candidate =
      workspace.assets[id]?.kind === "image"
        ? id
        : workspace.nodes[id]?.assetId;
    if (candidate && workspace.assets[candidate]?.kind === "image")
      assetId = candidate;
  }
  if (!frame && !assetId) return null;
  const rootId = assetId ? imageIndex(workspace).roots.get(assetId) : undefined;
  const ownerId = frame
    ? workspace.resultOwners[`node:${frame.id}`]
    : rootId
      ? workspace.resultOwners[`image:${rootId}`]
      : undefined;
  let job = ownerId ? workspace.jobs[ownerId] : undefined;
  const visited = new Set<string>();
  while (job?.childJobId && !visited.has(job.id)) {
    visited.add(job.id);
    const child = workspace.jobs[job.childJobId];
    if (!child || (child.resultOwnerId ?? child.id) !== ownerId) break;
    job = child;
  }
  return {
    id: frame?.id ?? id,
    name: frame?.name ?? workspace.assets[assetId!]?.name ?? "Image",
    assetId: assetId ?? null,
    pending: !!job && (job.status === "queued" || job.status === "running"),
    message: job?.message,
    error:
      error ??
      job?.applicationError ??
      (job?.status === "failed" ? job.error : undefined),
    jobId: job?.id,
  };
}
