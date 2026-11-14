import { z } from "zod";
import { Box3, Vector3 } from "three";
import { cameraFromWorld, worldMatrix } from "./cameras";
import { atlasContextNodes, captureFrameStatus, isVisible } from "./captures";
import { transformCapabilities } from "./node-capabilities";
import { cameraSchema, vec3, type Workspace } from "./schema";
import { isNodeInSubtree } from "./clips";

const boundsSchema = z.object({ min: vec3, max: vec3 });
export const inspectionSchema = z.object({
  revision: z.number().int(),
  source: z.enum(["viewport", "headless"]),
  bounds: boundsSchema.nullable(),
  boundsNote: z.string(),
  counts: z.record(z.number().int()),
  context: z.object({
    usable: z.array(z.string()),
    broken: z.array(z.object({ id: z.string(), reason: z.string() })),
  }),
  nodes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.string(),
      parentId: z.string().nullable(),
      visible: z.boolean(),
      worldPosition: vec3,
      worldMatrix: z.array(z.number()).length(16),
      bounds: boundsSchema.nullable(),
      transforms: z.object({
        translate: z.boolean(),
        rotate: z.boolean(),
        scale: z.boolean(),
      }),
      camera: cameraSchema.optional(),
      frame: z
        .object({
          usable: z.boolean(),
          included: z.boolean(),
          reason: z.string().optional(),
        })
        .optional(),
      issues: z.array(z.string()),
    }),
  ),
});
export type SceneInspection = z.infer<typeof inspectionSchema>;
export type InspectionWorkspace = Pick<
  Workspace,
  "revision" | "nodes" | "assets"
> & { settings: Pick<Workspace["settings"], "atlas"> };
const serializeBounds = (bounds: Box3 | undefined) =>
  bounds && !bounds.isEmpty()
    ? { min: bounds.min.toArray(), max: bounds.max.toArray() }
    : null;

/** Structural inspection is headless; bounds come only from the renderer's shared NodeSpatial contract. */
export function inspectScene(
  workspace: InspectionWorkspace,
  nodeIds?: string[],
  bounds?: (ids: string[]) => Box3 | undefined,
): SceneInspection {
  for (const id of nodeIds ?? [])
    if (!workspace.nodes[id]) throw new Error(`Node does not exist: ${id}`);
  const nodes = Object.values(workspace.nodes).filter(
    (node) =>
      !nodeIds || nodeIds.some((id) => isNodeInSubtree(workspace, id, node.id)),
  );
  const included = new Set(atlasContextNodes(workspace).map((node) => node.id));
  const usable: string[] = [],
    broken: { id: string; reason: string }[] = [];
  const counts: Record<string, number> = {};
  const entries = nodes.map((node) => {
    counts[node.kind] = (counts[node.kind] ?? 0) + 1;
    const matrix = worldMatrix(node, workspace.nodes);
    const issues: string[] = [];
    for (const id of new Set(
      [node.assetId, node.geometryAssetId].filter((id): id is string => !!id),
    )) {
      const asset = workspace.assets[id];
      if (!asset || asset.missing || asset.trashedAt)
        issues.push(`Asset unavailable: ${id}`);
    }
    let frame: SceneInspection["nodes"][number]["frame"];
    if (node.kind === "capture") {
      const status = captureFrameStatus(workspace, node.id);
      frame = {
        usable: !!status.frame,
        included: included.has(node.id),
        reason: status.error,
      };
      if (status.frame && included.has(node.id)) usable.push(node.id);
      if (status.error) {
        broken.push({ id: node.id, reason: status.error });
        issues.push(status.error);
      }
    }
    return {
      id: node.id,
      name: node.name,
      kind: node.kind,
      parentId: node.parentId,
      visible: isVisible(workspace, node),
      worldPosition: new Vector3().setFromMatrixPosition(matrix).toArray(),
      worldMatrix: matrix.toArray(),
      bounds: serializeBounds(bounds?.([node.id])),
      transforms: transformCapabilities([node]),
      ...(node.projection
        ? { camera: cameraFromWorld(node.projection, matrix) }
        : {}),
      frame,
      issues,
    };
  });
  return {
    revision: workspace.revision,
    source: bounds ? "viewport" : "headless",
    bounds: serializeBounds(
      bounds?.(
        nodeIds ??
          nodes.filter((node) => !node.parentId).map((node) => node.id),
      ),
    ),
    boundsNote: bounds
      ? "World-axis bounds from NodeSpatial, matching editor framing; includes hidden content, excludes picking/gizmo helpers, and does not measure coverage or clip geometry."
      : "Bounds unavailable without an open viewport. Use scene inspect for renderer bounds.",
    counts,
    context: { usable, broken },
    nodes: entries,
  };
}
