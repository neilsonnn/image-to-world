import { frameAssets, frameAt } from "./frames";
import {
  atlasContext,
  atlasContextNodes,
  captureFrame,
  sceneCamera,
  selectedPath,
  spatialContextFrames,
} from "./captures";
import {
  generationSchema,
  type Generation,
  type JobInput,
  type Workspace,
} from "./schema";

export function currentCamera(
  workspace: Pick<Workspace, "nodes"> & {
    settings: Pick<Workspace["settings"], "viewingCameraId" | "viewportCamera">;
  },
) {
  return (
    (workspace.settings.viewingCameraId &&
      sceneCamera(workspace, workspace.settings.viewingCameraId)) ||
    workspace.settings.viewportCamera
  );
}

type GenerationWorkspace = Pick<
  Workspace,
  | "nodes"
  | "assets"
  | "selection"
  | "primaryId"
  | "jobs"
  | "imageDrafts"
  | "imageVersions"
> & {
  settings: Pick<
    Workspace["settings"],
    | "viewingCameraId"
    | "viewportCamera"
    | "editor2d"
    | "atlas"
    | "atlasPanel"
    | "prompt"
    | "atlasReturnDepth"
    | "fps"
    | "targetFrameCount"
    | "seed"
    | "enhancePrompt"
  >;
};

/** Capture IDs for Atlas context; `preferSelection` uses selected captures when any qualify. */
function contextCaptureIds(
  workspace: GenerationWorkspace,
  nodeIds: string[] | undefined,
  pathId: string | null | undefined,
  preferSelection: boolean,
) {
  const selectedOnly = workspace.settings.atlasPanel.selectedOnly;
  let nodes = atlasContextNodes(
    workspace,
    nodeIds ?? (selectedOnly ? workspace.selection : undefined),
    pathId,
  );
  if (preferSelection && nodeIds === undefined && !selectedOnly) {
    const selected = atlasContextNodes(workspace, workspace.selection, pathId);
    if (selected.length) nodes = selected;
  }
  const participating = new Set(nodes.map((node) => node.id));
  return spatialContextFrames(workspace)
    .filter((node) => participating.has(node.id))
    .map((node) => captureFrame(workspace, node.id).node.id);
}

export function generationInput(
  workspace: GenerationWorkspace,
  request: Generation,
): JobInput {
  const r = generationSchema.parse(request);
  const s = workspace.settings;
  switch (r.kind) {
    case "image.create":
      return {
        kind: "image",
        prompt: r.prompt,
        model: r.model,
        seed: r.seed,
        placement: r.placement ?? currentCamera(workspace),
      };
    case "image.edit": {
      const sourceAssetId = r.sourceAssetId ?? s.editor2d.activeAssetId;
      if (!sourceAssetId) throw new Error("Choose an image to edit");
      return {
        kind: "nano",
        sourceAssetId,
        prompt: r.prompt ?? s.editor2d.prompt,
        referenceAssetIds: r.referenceAssetIds ?? s.editor2d.referenceAssetIds,
        settings: r.settings ?? s.editor2d.settings,
        draft: r.draft ?? workspace.imageDrafts[sourceAssetId],
        applyToScene: r.applyToScene,
        reconstruct: r.reconstruct,
      };
    }
    case "pose": {
      const assetIds =
        r.assetIds ??
        workspace.selection.filter(
          (id) => workspace.assets[id]?.kind === "image",
        );
      return {
        kind: "pose",
        assetIds,
        canonicalize: false,
        placement: r.placement ?? currentCamera(workspace),
      };
    }
    case "reconstruct": {
      const job = r.jobId ? workspace.jobs[r.jobId] : undefined;
      if (r.jobId && !job) throw new Error("Generation does not exist");
      if (r.indices && (!job || r.assetIds))
        throw new Error(
          "Frame indices require a job and cannot be combined with asset IDs",
        );
      if (job && job.status !== "succeeded")
        throw new Error("Choose a completed generation");
      const frames = job
        ? r.indices
          ? r.indices.map((index) => frameAt(workspace, job, index))
          : frameAssets(workspace, job)
        : [];
      if (frames.some((frame) => !frame))
        throw new Error("Choose valid frame indices");
      const assetIds = r.assetIds ?? frames.map((asset) => asset!.id);
      if (!assetIds.length && !r.videoAssetId)
        throw new Error("Choose frames or a video to reconstruct");
      return {
        kind: "reconstruct",
        assetIds,
        videoAssetId: r.videoAssetId,
        fps: r.fps,
        maxFrames: r.maxFrames,
        integrate: r.integrate,
      };
    }
    case "view": {
      const pathId =
        r.contextPathId === undefined
          ? selectedPath(workspace)?.id
          : r.contextPathId;
      return {
        kind: "atlas",
        nodeIds: contextCaptureIds(
          workspace,
          r.nodeIds,
          pathId,
          r.context === "selection",
        ),
        contextPathId: pathId ?? undefined,
        cameras: [r.camera ?? currentCamera(workspace)],
        prompt: r.prompt ?? s.prompt,
        enhancePrompt: s.enhancePrompt,
        returnDepth: r.returnDepth ?? s.atlasReturnDepth,
        seed: r.seed ?? s.seed,
      };
    }
    case "splats": {
      const pathId =
        r.contextPathId === undefined
          ? selectedPath(workspace)?.id
          : r.contextPathId;
      return {
        kind: "splats",
        nodeIds: contextCaptureIds(workspace, r.nodeIds, pathId, false),
        prompt: r.prompt ?? s.prompt,
        enhancePrompt: s.enhancePrompt,
        refine: r.refine,
      };
    }
    case "video": {
      const source = r.sourceJobId ? workspace.jobs[r.sourceJobId] : undefined;
      if (
        r.sourceJobId &&
        (source?.input.kind !== "video" ||
          source.input.mode !== "keyframes" ||
          source.status !== "succeeded")
      )
        throw new Error("Choose a completed keyframe generation");
      const pathId =
        r.pathId ??
        (source?.input.kind === "video"
          ? source.input.pathId
          : selectedPath(workspace)?.id);
      if (!pathId) throw new Error("Choose a camera path");
      const context = atlasContext(
        workspace,
        r.nodeIds ??
          (s.atlasPanel.selectedOnly ? workspace.selection : undefined),
        pathId,
      );
      return {
        kind: "video",
        pathId,
        nodeIds:
          source?.input.kind === "video"
            ? source.input.nodeIds
            : context.map((f) => f.node.id),
        sourceJobId: r.sourceJobId,
        fps:
          r.fps ?? (source?.input.kind === "video" ? source.input.fps : s.fps),
        targetFrameCount:
          r.targetFrameCount ??
          (source?.input.kind === "video"
            ? source.input.targetFrameCount
            : (workspace.nodes[pathId]?.targetFrameCount ??
              s.targetFrameCount)),
        prompt:
          r.prompt ??
          (source?.input.kind === "video" ? source.input.prompt : s.prompt),
        seed:
          r.seed ?? (source?.input.kind === "video" ? source.input.seed : 42),
        returnDepth: r.returnDepth ?? s.atlasReturnDepth,
        mode: r.mode,
        keyframeCount: r.keyframeCount,
      };
    }
  }
}
