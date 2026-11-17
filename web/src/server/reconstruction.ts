import { createCanvas, loadImage } from "@napi-rs/canvas";
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
  let unchanged:
    { data: Uint8ClampedArray; width: number; height: number } | undefined;
  if (job.input.unchangedMaskAssetId) {
    const { file } = await store.assetFile(job.input.unchangedMaskAssetId);
    const image = await loadImage(file),
      canvas = createCanvas(image.width, image.height),
      ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    unchanged = {
      data: ctx.getImageData(0, 0, image.width, image.height).data,
      width: image.width,
      height: image.height,
    };
  }
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
          if (
            unchanged &&
            unchanged.data[
              (Math.min(
                unchanged.height - 1,
                Math.floor(((y + 0.5) * unchanged.height) / next.height),
              ) *
                unchanged.width +
                Math.min(
                  unchanged.width - 1,
                  Math.floor(((x + 0.5) * unchanged.width) / next.width),
                )) *
                4
            ] < 128
          )
            continue;
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
      if (
        unchanged &&
        ratios.map((v) => Math.abs(v - depthScale!)).sort((a, b) => a - b)[
          Math.floor(ratios.length / 2)
        ] /
          depthScale >
          0.35
      )
        throw new Error(
          "Unchanged-region depth alignment is inconsistent; retained the previous scene. Review the candidate and mask.",
        );
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
      ? {
          ...targets[i]!,
          intrinsics: {
            ...targets[i]!.intrinsics,
            width: frame.camera.intrinsics.width,
            height: frame.camera.intrinsics.height,
            fx:
              (targets[i]!.intrinsics.fx * frame.camera.intrinsics.width) /
              targets[i]!.intrinsics.width,
            fy:
              (targets[i]!.intrinsics.fy * frame.camera.intrinsics.height) /
              targets[i]!.intrinsics.height,
            cx:
              (targets[i]!.intrinsics.cx * frame.camera.intrinsics.width) /
              targets[i]!.intrinsics.width,
            cy:
              (targets[i]!.intrinsics.cy * frame.camera.intrinsics.height) /
              targets[i]!.intrinsics.height,
          },
        }
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
    if (!target.assetId) continue;
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
          (target) =>
            target.assetId && sourceIndex.roots.get(target.assetId) === root,
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
