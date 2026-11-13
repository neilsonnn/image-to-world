import { Vector3 } from "three";
import { worldMatrix } from "./cameras";
import { isVisible } from "./captures";
import type { SceneNode, Workspace } from "./schema";

export function isNodeInSubtree(
  workspace: Pick<Workspace, "nodes">,
  ancestorId: string,
  id: string,
) {
  let node: SceneNode | undefined = workspace.nodes[id];
  while (node) {
    if (node.id === ancestorId) return true;
    node = node.parentId ? workspace.nodes[node.parentId] : undefined;
  }
  return false;
}

export function clipAppliesToNode(
  workspace: Pick<Workspace, "nodes">,
  clipId: string,
  id: string,
) {
  const clip = workspace.nodes[clipId];
  if (!clip?.clip) return false;
  if (clip.clip.scope === "global") return true;
  return clip.parentId ? isNodeInSubtree(workspace, clip.parentId, id) : false;
}

export function clipsForNode(workspace: Pick<Workspace, "nodes">, id: string) {
  return Object.values(workspace.nodes).filter(
    (node) =>
      node.clip &&
      isVisible(workspace, node) &&
      clipAppliesToNode(workspace, node.id, id),
  );
}

export function clipMasks(workspace: Pick<Workspace, "nodes">, id: string) {
  return clipsForNode(workspace, id).map((node) => ({
    node,
    inverse: worldMatrix(node, workspace.nodes).invert(),
  }));
}

export function clippedOpacity(
  point: Vector3,
  masks: ReturnType<typeof clipMasks>,
) {
  let opacity = 1;
  const local = new Vector3();
  for (const { node, inverse } of masks) {
    local.copy(point).applyMatrix4(inverse);
    const dx = Math.abs(local.x) - 1,
      dy = Math.abs(local.y) - 1,
      dz = Math.abs(local.z) - 1;
    let distance =
      Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) +
      Math.min(Math.max(dx, dy, dz), 0);
    if (node.clip!.invert) distance = -distance;
    const softness = node.clip!.softness;
    const amount = softness
      ? Math.max(0, Math.min(1, -distance / softness + 0.5))
      : distance < 0
        ? 1
        : 0;
    opacity *= 1 - amount;
  }
  return opacity;
}

export function captureClip(
  id: string,
  min: number[],
  max: number[],
): SceneNode {
  return {
    id: `${id}_clip`,
    name: "Clip box",
    kind: "clip",
    parentId: id,
    visible: true,
    transform: {
      position: min.map((value, axis) => (value + max[axis]) / 2) as [
        number,
        number,
        number,
      ],
      quaternion: [0, 0, 0, 1],
      scale: min.map((value, axis) =>
        Math.max(0.001, (max[axis] - value) / 2),
      ) as [number, number, number],
    },
    clip: { scope: "local", invert: true, softness: 0 },
  };
}
