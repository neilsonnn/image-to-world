import { captureNodes } from "./captures";
import { applyCommand } from "./commands";
import type { Command, Job, SceneNode, Workspace } from "./schema";

export function resultTarget(
  workspace: Pick<Workspace, "nodes">,
  nodeId: string,
) {
  const { root, camera, image, points } = captureNodes(workspace, nodeId);
  if (!image.assetId) throw new Error(`${root.name}: image has no asset`);
  return {
    nodeId: root.id,
    assetId: image.assetId,
    cameraId: camera.id,
    imageId: image.id,
    pointsId: points.id,
  };
}

export function claimResultTargets(workspace: Workspace, job: Job) {
  for (const target of job.applyTargets ?? [])
    workspace.resultOwners[`node:${target.nodeId}`] = job.id;
  for (const root of job.applyRoots)
    workspace.resultOwners[`image:${root}`] = job.id;
}

export function resultTargets(workspace: Workspace, nodes: SceneNode[]) {
  return nodes.map((node) => {
    try {
      return resultTarget(workspace, node.id);
    } catch (error) {
      return {
        nodeId: node.id,
        assetId: node.assetId!,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

export function applyJobResult(
  workspace: Workspace,
  job: Job,
  build: (
    targets: ReturnType<typeof resultTarget>[],
    roots: string[],
  ) => Extract<Command, { type: "edit.batch" }>["commands"],
  candidates = job.applyTargets ?? [],
  complete = true,
) {
  const current = workspace.jobs[job.id];
  if (current.applied || current.status === "cancelled") return false;
  const targets = candidates.filter(
    (target) =>
      workspace.resultOwners[`node:${target.nodeId}`] ===
        (job.resultOwnerId ?? job.id) &&
      !current.appliedTargets.includes(target.nodeId),
  );
  const roots = job.applyRoots.filter(
    (root) =>
      workspace.resultOwners[`image:${root}`] === (job.resultOwnerId ?? job.id),
  );
  const valid: ReturnType<typeof resultTarget>[] = [];
  const errors = new Set(current.applicationError?.split("\n") ?? []);
  for (const target of targets) {
    try {
      if ("error" in target) throw new Error(target.error);
      const resolved = resultTarget(workspace, target.nodeId);
      if (
        resolved.nodeId !== target.nodeId ||
        resolved.cameraId !== target.cameraId ||
        resolved.imageId !== target.imageId ||
        resolved.pointsId !== target.pointsId
      )
        throw new Error(
          "Posed-image components changed while generation was running",
        );
      valid.push(target);
    } catch (error) {
      errors.add(
        `${target.nodeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  let changed = false;
  try {
    const commands = build(valid, roots);
    if (commands.length) {
      applyCommand(workspace, { type: "edit.batch", commands });
      changed = true;
    }
    // Commands replace workspace records; update the committed job, not a stale reference.
    workspace.jobs[job.id].appliedTargets.push(
      ...valid.map((target) => target.nodeId),
    );
  } catch (error) {
    errors.add(error instanceof Error ? error.message : String(error));
  }
  workspace.jobs[job.id].applicationError = errors.size
    ? [...errors].join("\n")
    : undefined;
  if (complete) workspace.jobs[job.id].applied = true;
  return changed;
}
