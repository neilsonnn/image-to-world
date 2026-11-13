import type { Images2PosedRGBDPerImageResult } from "@worldlabsai/client";
import { linearDepth } from "../../../core/depth";
import { median, registerCameras } from "../../../core/registration";
import { transformCamera, spansBaseline } from "../../../core/cameras";
import { applyJobResult } from "../../../core/result-targets";
import { imageIndex, imageReplacementCommands } from "../../../core/images";
import {
  cameraSchema,
  type Asset,
  type Job,
  type Command,
} from "../../../core/schema";
import { downloadTaskAsset, saveFrame } from "./providers";
import { encodeDepth, readDepth } from "./depth";
import { integrateAssets } from "./integration";
import type { WorkspaceStore } from "./store";

export async function reconstructFrames(
  store: WorkspaceStore,
  job: Job,
  frames: Images2PosedRGBDPerImageResult[],
  signal: AbortSignal,
) {
  if (job.input.kind !== "reconstruct")
    throw new Error("Expected a reconstruction job");
  const snapshot = job.contextSnapshot ?? store.snapshot();
  const sources = job.input.assetIds.map(
    (id) => snapshot.assets[id] ?? store.snapshot().assets[id],
  );
  const placement = job.input.placement;
  const targets = sources.map((asset) =>
    placement ? undefined : asset?.camera,
  );
  let depthScale: number | undefined;
  if (
    targets.some(Boolean) &&
    !spansBaseline(targets.filter((camera) => !!camera))
  ) {
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const anchor = source.depthAssetId
        ? source
        : source.geometrySourceAssetId
          ? snapshot.assets[source.geometrySourceAssetId]
          : undefined;
      if (!anchor?.depthAssetId) continue;
      const old = await readDepth(store, anchor);
      const next = linearDepth(
        await (
          await downloadTaskAsset(frames[i].depth.depthAsset, signal)
        ).arrayBuffer(),
      );
      const ratios: number[] = [];
      const stride = Math.max(
        1,
        Math.floor(Math.sqrt((next.width * next.height) / 4096)),
      );
      for (let y = 0; y < next.height; y += stride)
        for (let x = 0; x < next.width; x += stride) {
          const before =
            old.data[
              (Math.min(
                old.height - 1,
                Math.floor(((y + 0.5) * old.height) / next.height),
              ) *
                old.width +
                Math.min(
                  old.width - 1,
                  Math.floor(((x + 0.5) * old.width) / next.width),
                )) *
                old.stride
            ];
          const after = next.data[(y * next.width + x) * next.stride];
          if (
            before > 0 &&
            after > 0 &&
            Number.isFinite(before) &&
            Number.isFinite(after)
          )
            ratios.push(before / after);
        }
      if (ratios.length < 16)
        throw new Error("Too few valid depth samples to align this edit");
      depthScale = median(ratios);
      break;
    }
  }
  const registration = registerCameras(
    frames.map((f) => cameraSchema.parse(f.camera)),
    targets,
    depthScale,
  );
  const assets: Asset[] = [];
  for (let i = 0; i < frames.length; i++) {
    signal.throwIfAborted();
    const frame = frames[i];
    const depth = linearDepth(
      await (
        await downloadTaskAsset(frame.depth.depthAsset, signal)
      ).arrayBuffer(),
    );
    const camera = targets[i]
      ? { ...frame.camera, extrinsics: targets[i]!.extrinsics }
      : transformCamera(cameraSchema.parse(frame.camera), registration.matrix);
    assets.push(
      await saveFrame(store, job, { ...frame, camera }, i, signal, {
        depthBlob: await encodeDepth(depth, registration.scale),
        integrate: false,
      }),
    );
  }
  signal.throwIfAborted();
  const sourceIndex = imageIndex({ ...store.snapshot(), ...snapshot });
  const expectedByRoot = new Map<string, NonNullable<Job["applyTargets"]>>();
  for (const target of job.applyTargets ?? []) {
    const root = sourceIndex.roots.get(target.assetId)!;
    expectedByRoot.set(root, [...(expectedByRoot.get(root) ?? []), target]);
  }
  const newFrames = assets
    .filter(
      (_, i) => !expectedByRoot.has(sourceIndex.roots.get(sources[i].id)!),
    )
    .map((asset) => asset.id);
  await store.update((state) => {
    signal.throwIfAborted();
    applyJobResult(state, job, (ownedTargets, roots) => {
      const commands: Extract<Command, { type: "edit.batch" }>["commands"] = [];
      for (let i = 0; i < assets.length; i++) {
        const root = sourceIndex.roots.get(sources[i].id)!;
        const targets = ownedTargets.filter(
          (target) => sourceIndex.roots.get(target.assetId) === root,
        );
        commands.push(
          ...imageReplacementCommands(
            state,
            assets[i].id,
            targets.map((target) => target.nodeId),
            roots.includes(root),
          ),
        );
      }
      return commands;
    });
    state.jobs[job.id].frameAssetIds = assets.map((a) => a.id);
    state.jobs[job.id].reconstructionScale = registration.scale;
  });
  // A restart can re-run integration; deterministic capture IDs make it idempotent.
  if (job.input.integrate)
    await integrateAssets(
      store,
      newFrames,
      signal,
      placement
        ? {
            camera: placement,
            parentId: job.input.parentId,
            beforeId: job.input.beforeId,
          }
        : undefined,
    );
  return assets;
}
