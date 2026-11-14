import { Box3, Matrix4, Quaternion, Vector3 } from "three";
import { worldMatrix } from "./cameras";
import type { Workspace } from "./schema";

export type PivotPlacement = "center" | "origin";
export type GizmoSpace = "world" | "object";

/** Bounds are supplied by NodeSpatial; object axes come from the primary selected root. */
export function selectionPivot(
  nodes: Workspace["nodes"],
  ids: string[],
  primaryId: string | null,
  placement: PivotPlacement,
  space: GizmoSpace,
  bounds?: Box3,
) {
  const position = new Vector3();
  const quaternion = new Quaternion();
  if (!ids.length) return { position, quaternion };
  if (placement === "center" && bounds && !bounds.isEmpty())
    bounds.getCenter(position);
  else {
    for (const id of ids)
      position.add(
        new Vector3().setFromMatrixPosition(worldMatrix(nodes[id], nodes)),
      );
    position.multiplyScalar(1 / ids.length);
  }
  if (space === "object") {
    let primary = primaryId ? nodes[primaryId] : undefined;
    while (primary && !ids.includes(primary.id))
      primary = primary.parentId ? nodes[primary.parentId] : undefined;
    const matrix: Matrix4 = worldMatrix(primary ?? nodes[ids.at(-1)!], nodes);
    matrix.decompose(new Vector3(), quaternion, new Vector3());
    quaternion.normalize();
  }
  return { position, quaternion };
}
