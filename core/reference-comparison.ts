import { cameraNode, captureRoot } from "./captures";
import { orderedChildren } from "./scene";
import { isNodeInSubtree } from "./clips";
import type { SceneNode, Workspace } from "./schema";

/** Resolve only the photograph and geometry that belong to this camera's Frame. */
export function referenceComparison(
  workspace: Pick<Workspace, "nodes" | "assets">,
  id: string | null,
) {
  if (!id) return;
  const frame = captureRoot(workspace, id);
  const camera = cameraNode(workspace, id);
  if (!frame || !camera?.projection || camera.parentId !== frame.id) return;
  const images = orderedChildren(workspace.nodes, camera.id).filter(
    (n) => n.kind === "image",
  );
  if (images.length !== 1) return;
  const image = images[0];
  const asset = image.assetId && workspace.assets[image.assetId];
  if (!asset || asset.kind !== "image" || asset.missing) return;
  const points = orderedChildren(workspace.nodes, frame.id).filter(
    (n) => n.kind === "points",
  );
  return {
    frameId: frame.id,
    asset,
    projection: camera.projection,
    imageId: image.id,
    pointsId: points.length === 1 ? points[0].id : undefined,
  };
}

/** Geometry and pixels that belong to the reference views in a playable scene. */
export function frameSourceIds(workspace: Pick<Workspace, "nodes" | "assets">) {
  const ids = new Set<string>();
  for (const node of Object.values(workspace.nodes)) {
    if (node.kind !== "camera") continue;
    const reference = referenceComparison(workspace, node.id);
    if (!reference) continue;
    ids.add(reference.imageId);
    if (reference.pointsId) ids.add(reference.pointsId);
  }
  return [...ids];
}

/** Build an isolated scene snapshot. Keep transforms on enclosing ancestors and
 * source components so authored grandchildren remain correctly placed. */
export function setRenderNodes(
  workspace: Pick<Workspace, "nodes" | "assets">,
  viewId: string,
  targets?: string[],
) {
  const reference = referenceComparison(workspace, viewId);
  if (!reference)
    throw new Error(
      "Set rendering requires a reference Frame with an available camera image",
    );
  const inside = (id: string) =>
    isNodeInSubtree(workspace, reference.frameId, id);
  if (targets?.some((id) => !inside(id)))
    throw new Error("Set render targets must belong to the viewed Frame");
  const nodes: Record<string, SceneNode> = {};
  for (const node of Object.values(workspace.nodes)) {
    const inSet = inside(node.id);
    if (!inSet && !isNodeInSubtree(workspace, node.id, reference.frameId))
      continue;
    if (
      inSet &&
      node.id !== reference.imageId &&
      node.id !== reference.pointsId
    ) {
      nodes[node.id] = node;
    } else {
      const { id, name, parentId, transform, visible, order } = node;
      nodes[id] = {
        id,
        name,
        parentId,
        transform,
        visible,
        order,
        kind: "group",
      };
    }
  }
  return nodes;
}
