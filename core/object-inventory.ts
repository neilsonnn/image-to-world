import { captureRoot } from "./captures";
import type { Workspace } from "./schema";

/** A coordinator's view of live scene ownership and reusable provider output. */
export function objectInventory(
  state: Pick<Workspace, "assets" | "jobs" | "nodes">,
) {
  const nodes = Object.values(state.nodes);
  return {
    frames: nodes
      .filter((n) => n.kind === "capture")
      .map(({ id, name }) => ({ id, name })),
    instances: nodes
      .filter(
        (n) =>
          ["mesh", "procedural", "splat"].includes(n.kind) ||
          n.observationAssetIds?.length,
      )
      .map((n) => ({
        id: n.id,
        name: n.name,
        kind: n.kind,
        frameId: captureRoot(state, n.id)?.id ?? null,
        parentId: n.parentId,
        assetId: n.assetId ?? n.procedural?.bundleAssetId,
        observationAssetIds: n.observationAssetIds ?? [],
      })),
    builds: Object.values(state.jobs).flatMap((job) =>
      job.input.kind === "fal"
        ? [
            {
              key: job.input.buildKey ?? null,
              jobId: job.id,
              model: job.input.model,
              status: job.status,
              outputs: job.outputAssetIds.map((id) => ({
                id,
                name: state.assets[id]?.name,
                kind: state.assets[id]?.kind,
                paths: state.assets[id]?.providerOutputPaths ?? [],
              })),
            },
          ]
        : [],
    ),
  };
}
