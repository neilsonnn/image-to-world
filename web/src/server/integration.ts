import { imageIndex } from "../../../core/images";
import type { Camera, Workspace } from "../../../core/schema";
import { applyCommand } from "../../../core/commands";
import { createCapture } from "../../../core/captures";
import type { WorkspaceStore } from "./store";

type Placement = {
  camera: Camera;
  parentId?: string | null;
  beforeId?: string | null;
};

export function integrateFrames(
  state: Workspace,
  assetIds: string[],
  placement?: Placement,
  jobId?: string,
  name?: string,
) {
  if (jobId && state.resultApplications[jobId]?.includes("frames")) return [];
  const existing = imageIndex(state).capturesByAsset;
  const origin = placement
    ? state.assets[assetIds[0]]?.camera?.extrinsics.position
    : undefined;
  const added = [...new Set(assetIds)].flatMap((assetId) => {
    if (existing.has(assetId)) return [];
    const asset = state.assets[assetId];
    if (!asset?.camera || asset.missing || asset.trashedAt)
      throw new Error("Reconstruct these frames before integrating them");
    const id = `node_${asset.id}`;
    if (state.nodes[id]) return [];
    const capture = createCapture(
      asset,
      id,
      placement?.camera,
      undefined,
      origin,
    );
    if (name) capture[0].name = name;
    return capture;
  });
  if (!added.length) return [];
  applyCommand(state, {
    type: "edit.batch",
    commands: [
      { type: "nodes.put", nodes: added },
      ...(placement?.parentId !== undefined || placement?.beforeId !== undefined
        ? [
            {
              type: "nodes.move" as const,
              ids: added
                .filter((node) => node.parentId === null)
                .map((node) => node.id),
              parentId: placement.parentId ?? null,
              beforeId: placement.beforeId,
            },
          ]
        : []),
    ],
  });
  if (jobId) (state.resultApplications[jobId] ??= []).push("frames");
  return added.map((node) => node.id);
}

export function integrateAssets(
  store: WorkspaceStore,
  assetIds: string[],
  signal?: AbortSignal,
  placement?: Placement,
  jobId?: string,
) {
  return store.updateScene((state) => {
    signal?.throwIfAborted();
    return integrateFrames(state, assetIds, placement, jobId);
  });
}
