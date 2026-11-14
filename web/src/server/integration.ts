import { imageIndex } from "../../../core/images";
import type { SceneNode, Camera } from "../../../core/schema";
import { applyCommand } from "../../../core/commands";
import { createCapture } from "../../../core/captures";
import type { WorkspaceStore } from "./store";

export async function integrateAssets(
  store: WorkspaceStore,
  assetIds: string[],
  signal?: AbortSignal,
  placement?: {
    camera: Camera;
    parentId?: string | null;
    beforeId?: string | null;
  },
) {
  const snapshot = store.snapshot();
  const captures: SceneNode[][] = [];
  const existing = imageIndex(snapshot).capturesByAsset;
  const origin = placement
    ? snapshot.assets[assetIds[0]]?.camera?.extrinsics.position
    : undefined;
  for (const assetId of [...new Set(assetIds)]) {
    signal?.throwIfAborted();
    if (existing.has(assetId)) continue;
    const asset = snapshot.assets[assetId];
    if (!asset?.camera || asset.missing)
      throw new Error("Reconstruct these frames before integrating them");
    const id = `node_${asset.id}`;
    if (snapshot.nodes[id]) continue;
    const capture = createCapture(
      asset,
      id,
      placement?.camera,
      undefined,
      origin,
    );
    captures.push(capture);
  }
  signal?.throwIfAborted();
  if (captures.length)
    await store.update((state) => {
      signal?.throwIfAborted();
      const current = imageIndex(state).capturesByAsset;
      const added = captures.flatMap((capture) =>
        state.nodes[capture[0].id] || current.has(capture[0].assetId!)
          ? []
          : capture,
      );
      if (added.length) {
        applyCommand(state, {
          type: "edit.batch",
          commands: [
            { type: "nodes.put", nodes: added },
            ...(placement?.parentId !== undefined ||
            placement?.beforeId !== undefined
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
      }
    });
}
