import { Vector3 } from "three";
import { worldMatrix } from "../../../core/cameras";
import type { Edit, SceneNode } from "../../../core/schema";
import type { Activity } from "../../../core/activity";
import { selectedRoots } from "../../../core/scene";

type Nodes = Record<string, SceneNode>;
type SceneChange = NonNullable<Activity["sceneChange"]>;

// Preserve a world-space anchor even when a commit deletes its last target.
export function sceneChange(
  ids: string[],
  after: Nodes,
  before: Nodes = after,
  major = true,
): SceneChange | undefined {
  const surviving = selectedRoots(
    after,
    ids.filter((id) => after[id]),
  );
  const nodes = surviving.length ? after : before;
  const targets = surviving.length
    ? surviving
    : selectedRoots(
        before,
        ids.filter((id) => before[id]),
      );
  if (!targets.length) return;
  const center = new Vector3();
  const point = new Vector3();
  for (const id of targets)
    center.add(point.setFromMatrixPosition(worldMatrix(nodes[id], nodes)));
  return {
    nodeIds: surviving,
    position: center.divideScalar(targets.length).toArray(),
    major,
  };
}

const visualFields = new Set([
  "parentId",
  "transform",
  "visible",
  "kind",
  "assetId",
  "geometryAssetId",
  "procedural",
  "projection",
  "fov",
  "clip",
  "keyframes",
]);
export function editSceneChange(
  edit: Edit | undefined,
  after: Nodes,
  before: Nodes,
) {
  const major = new Set<string>(),
    minor = new Set<string>();
  for (const {
    path: [collection, id, field],
  } of edit?.changes ?? []) {
    if (collection !== "nodes" || !id) continue;
    if (!field || visualFields.has(field)) major.add(id);
    else if (field === "name" || field === "physics" || field === "locked")
      minor.add(id);
  }
  return sceneChange(
    [...(major.size ? major : minor)],
    after,
    before,
    !!major.size,
  );
}
