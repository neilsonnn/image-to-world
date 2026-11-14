import { previewItems } from "../../../core/previews";
import { renderContactSheet } from "./previews";
import { imageModels } from "../../../core/models";
import {
  applyJobResult,
  claimResultTargets,
  resultTargets,
} from "../../../core/result-targets";
import { imageIndex } from "../../../core/images";
import { keyframeIndices } from "../../../core/frames";
import { captureFrame } from "../../../core/captures";
import { applyNanoResult, nanoGeometry } from "./image-results";
import { reconstructFrames } from "./reconstruction";
import { integrateAssets } from "./integration";
import { extractVideoFrames } from "./video";
import type { z } from "zod";
import { applyCommand } from "../../../core/commands";
import {
  atlasContext,
  createCapture,
  spatialContextFrames,
} from "../../../core/captures";
import { identity, type Camera } from "../../../core/schema";
import type {
  AtlasGenerateRequest,
  AtlasGenerateResponse,
  Images2PosedRGBDRequest,
  Images2PosedRGBDPerImageResult,
  Images2PosedRGBDResponse,
  PosedImages2SplatsRequest,
  PosedImages2SplatsResponse,
} from "@worldlabsai/client";
import { randomUUID } from "node:crypto";
import { samplePath, spansBaseline } from "../../../core/cameras";
import {
  jobInputSchema,
  type Asset,
  type Job,
  type JobInput,
} from "../../../core/schema";
import { renderImageDraft } from "./image-edit";
import {
  buildWorldLabsRequest,
  downloadTaskAsset,
  falClient,
  falOutputUrls,
  resolveFalInput,
  saveFrame,
  worldLabs,
} from "./providers";
import type { WorkspaceStore } from "./store";
import { encodeVideo, ffmpegPath } from "./video";

export class JobRunner {
  private active = new Map<string, AbortController>();
  private stopped = false;
  private running = new Set<Promise<void>>();
  constructor(private store: WorkspaceStore) {}
  async init() {
    await this.store.update((state) => {
      for (const job of Object.values(state.jobs)) {
        if (job.status !== "running") continue;
        if (
          ["fal", "nano", "image"].includes(job.input.kind) &&
          !job.remoteId &&
          job.submittedAt
        ) {
          job.status = "failed";
          job.error =
            "FAL submission was interrupted before its request ID was saved. Check your FAL history before retrying.";
        } else {
          job.status = "queued";
          job.message = "Resuming after restart";
        }
      }
    });
    this.pump();
  }
  async submit(
    input: z.input<typeof jobInputSchema>,
    id = `job_${randomUUID()}`,
    parentJob?: Job,
  ) {
    if (this.store.snapshot().jobs[id]) return id;
    const parsed = jobInputSchema.parse(input);
    if (parsed.kind === "image") {
      falClient();
      worldLabs();
    }
    let snapshot = this.store.snapshot();
    const sheetItems =
      parsed.kind === "contactSheet"
        ? previewItems(snapshot, parsed)
        : undefined;
    if (parsed.kind === "inspect")
      for (const id of parsed.nodeIds ?? []) {
        if (!snapshot.nodes[id]) throw new Error(`Node does not exist: ${id}`);
      }
    let cameras: Camera[] | undefined,
      frameIndices: number[] | undefined,
      sourceFrameAssetIds: string[] | undefined;
    const source =
      parsed.kind === "video" && parsed.sourceJobId
        ? snapshot.jobs[parsed.sourceJobId]
        : undefined;
    if (parsed.kind === "video" && parsed.sourceJobId && !source)
      throw new Error("Keyframe generation does not exist");
    if (source) {
      if (
        source.status !== "succeeded" ||
        source.input.kind !== "video" ||
        source.input.mode !== "keyframes" ||
        !source.cameras ||
        !source.contextSnapshot
      )
        throw new Error("Choose a completed keyframe generation");
      if (
        parsed.kind === "video" &&
        (parsed.fps !== source.input.fps ||
          parsed.targetFrameCount !== source.input.targetFrameCount)
      )
        throw new Error(
          "Dense generation must use the keyframes saved target frame count and FPS",
        );
      snapshot = { ...snapshot, ...structuredClone(source.contextSnapshot) };
    }
    if (
      (parsed.kind === "pose" || parsed.kind === "reconstruct") &&
      parsed.assetIds.some(
        (id) =>
          snapshot.assets[id]?.kind !== "image" || snapshot.assets[id].missing,
      )
    )
      throw new Error("Choose available image assets to pose");
    if (parsed.kind === "atlas" || parsed.kind === "video") {
      const context = source
        ? parsed.nodeIds.flatMap((id) => {
            const frame = captureFrame(snapshot, id);
            return frame ? [frame] : [];
          })
        : atlasContext(
            snapshot,
            parsed.nodeIds,
            parsed.kind === "video" ? parsed.pathId : parsed.contextPathId,
          );
      if (source) {
        const current = this.store.snapshot();
        const versions = imageIndex(current);
        sourceFrameAssetIds = (source.frameAssetIds ?? []).map(
          (id) => current.imageVersions[versions.roots.get(id)!] ?? id,
        );
        for (const assetId of sourceFrameAssetIds) {
          const asset = current.assets[assetId];
          if (!asset?.depthAssetId || !asset.camera || asset.missing)
            throw new Error(
              "Keyframes need reconstructed depth before dense generation",
            );
          for (const id of [
            asset.id,
            asset.depthAssetId,
            asset.confidenceAssetId,
            asset.maskAssetId,
          ].filter((id): id is string => !!id))
            snapshot.assets[id] = current.assets[id];
          const id = `keyframe_${asset.id}`;
          for (const node of createCapture(asset, id))
            snapshot.nodes[node.id] = node;
          context.push(captureFrame(snapshot, id)!);
        }
      }
      if (!context.length)
        throw new Error(
          "Atlas context needs visible posed captures with aligned cameras and depth",
        );
      const participating = new Set(context.map((frame) => frame.node.id));
      parsed.nodeIds = spatialContextFrames(snapshot)
        .filter((node) => participating.has(node.id))
        .map((node) => node.id);
      if (
        parsed.kind === "atlas" &&
        parsed.returnDepth &&
        !spansBaseline([
          ...context.map((frame) => frame.camera),
          ...parsed.cameras,
        ])
      )
        throw new Error(
          "Atlas depth needs translation between cameras. Move away from the context camera with WASD; a pure rotation has no depth scale.",
        );
    }
    if (parsed.kind === "splats") {
      const context = atlasContext(snapshot, parsed.nodeIds);
      const limit = parsed.refine ? 512 : 32;
      if (context.length < 2 || context.length > limit)
        throw new Error(
          `${parsed.refine ? "Refined" : "Draft"} splats need 2 to ${limit} visible posed captures with aligned cameras and depth; found ${context.length}`,
        );
      const participating = new Set(context.map((frame) => frame.node.id));
      parsed.nodeIds = spatialContextFrames(snapshot)
        .filter((node) => participating.has(node.id))
        .map((node) => node.id);
    }
    if (parsed.kind === "video") {
      if (!ffmpegPath())
        throw new Error("Install FFmpeg before rendering video");
      const node = snapshot.nodes[parsed.pathId];
      if (!node) throw new Error("Camera path does not exist");
      cameras =
        source?.cameras ??
        samplePath(node, snapshot.nodes, parsed.targetFrameCount);
      frameIndices =
        parsed.mode === "keyframes"
          ? keyframeIndices(cameras.length, parsed.keyframeCount)
          : cameras
              .map((_, index) => index)
              .filter((index) => !source?.frameIndices?.includes(index));
      if (!frameIndices.length)
        throw new Error(
          "Every frame is already a keyframe; use the saved keyframe outputs",
        );
      if (
        parsed.returnDepth &&
        !spansBaseline([
          ...parsed.nodeIds.map((id) => captureFrame(snapshot, id)!.camera),
          ...frameIndices.map((index) => cameras![index]),
        ])
      )
        throw new Error("Video depth reconstruction needs translated cameras");
    }
    if (
      (parsed.kind === "atlas" || parsed.kind === "video") &&
      parsed.nodeIds.length +
        (parsed.kind === "atlas"
          ? parsed.cameras.length
          : frameIndices!.length) >
        128
    )
      throw new Error(
        "Atlas accepts at most 128 context and target views per request. Reduce the target frame count or context size.",
      );
    if (parsed.kind === "nano") {
      if (
        snapshot.assets[parsed.sourceAssetId]?.kind !== "image" ||
        snapshot.assets[parsed.sourceAssetId].missing
      )
        throw new Error("Choose an available source image");
      parsed.draft ??= snapshot.imageDrafts[parsed.sourceAssetId] ?? {
        strokes: [],
        layers: [],
      };
      for (const id of [
        ...parsed.referenceAssetIds,
        ...parsed.draft.layers.map((layer) => layer.assetId),
      ])
        if (
          snapshot.assets[id]?.kind !== "image" ||
          snapshot.assets[id].missing
        )
          throw new Error("References and layers must be available images");
    }
    if (
      parsed.kind === "reconstruct" &&
      !parsed.assetIds.length &&
      !parsed.videoAssetId
    )
      throw new Error("Choose images or video to reconstruct");
    const index = imageIndex(snapshot);
    const sourceIds =
      parsed.kind === "nano" && parsed.applyToScene
        ? [parsed.sourceAssetId]
        : parsed.kind === "reconstruct" && !parsed.placement
          ? parsed.assetIds
          : [];
    const targetIds = [
      ...new Set(
        sourceIds.flatMap(
          (assetId) =>
            index.capturesByRoot.get(index.roots.get(assetId)!) ?? [],
        ),
      ),
    ];
    await this.store.update((state) => {
      if (parentJob && state.jobs[parentJob.id]?.status === "cancelled")
        throw new Error("Parent generation was cancelled");
      if (parsed.kind === "pose" || parsed.kind === "image") {
        parsed.placement ??= snapshot.settings.viewportCamera;
        if (parentJob) {
          parsed.nodeIds = (parentJob.applyTargets ?? []).map(
            (target) => target.nodeId,
          );
        } else {
          const sources =
            parsed.kind === "pose"
              ? parsed.assetIds.map((assetId) => state.assets[assetId])
              : [{ name: parsed.prompt.slice(0, 80) }];
          parsed.nodeIds = sources.map(() => `node_${randomUUID()}`);
          applyCommand(state, {
            type: "nodes.put",
            nodes: sources.flatMap((asset, index) =>
              createCapture(
                asset,
                parsed.nodeIds![index],
                parsed.placement,
                id,
              ),
            ),
          });
          applyCommand(state, { type: "selection.set", ids: parsed.nodeIds });
        }
      }
      if (["atlas", "video", "reconstruct"].includes(parsed.kind))
        state.settings.atlasPanel.jobId = id;
      state.jobs[id] = {
        id,
        input: parsed,
        previewItems: sheetItems,
        cameras,
        frameIndices,
        applyTargets:
          parentJob?.applyTargets ??
          (parsed.kind === "nano" && !parsed.applyToScene
            ? []
            : resultTargets(
                state,
                parsed.kind === "pose" || parsed.kind === "image"
                  ? parsed.nodeIds!.map((id) => state.nodes[id])
                  : targetIds.map((id) => snapshot.nodes[id]),
              )),
        applyRoots:
          parsed.kind === "pose"
            ? []
            : sourceIds.map((assetId) => index.roots.get(assetId)!),
        appliedTargets: [],
        resultOwnerId: parentJob?.resultOwnerId ?? parentJob?.id ?? id,
        sourceFrameAssetIds,
        ...(parsed.kind === "atlas" ||
        parsed.kind === "video" ||
        parsed.kind === "splats" ||
        parsed.kind === "reconstruct" ||
        parsed.kind === "nano" ||
        parsed.kind === "contactSheet"
          ? {
              contextSnapshot: {
                nodes: snapshot.nodes,
                assets: snapshot.assets,
                settings: snapshot.settings,
              },
            }
          : {}),
        status: "queued",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        message: ["capture", "inspect"].includes(parsed.kind)
          ? "Waiting for an open viewport"
          : "Queued",
        outputAssetIds: [],
      };
      if (!parentJob) claimResultTargets(state, state.jobs[id]);
    });
    this.pump();
    return id;
  }
  async place(
    assetIds: string[],
    camera?: Camera,
    destination?: { parentId?: string | null; beforeId?: string | null },
    mode: "individual" | "reconstruct" = "individual",
  ) {
    const snapshot = this.store.snapshot();
    if (destination?.parentId && !snapshot.nodes[destination.parentId])
      throw new Error("Placement parent does not exist");
    const placed: string[] = [];
    const assets = [...new Set(assetIds)].map((id) => snapshot.assets[id]);
    if (
      assets.some(
        (asset) =>
          !asset ||
          asset.missing ||
          !["image", "splat", "video"].includes(asset.kind),
      )
    )
      throw new Error("Choose available images, splats, or videos");
    const placement = camera ?? snapshot.settings.viewportCamera;
    const jobIds: string[] = [];
    const reconstruct = mode === "reconstruct";
    const images = assets.filter((asset) => asset.kind === "image");
    if (reconstruct) {
      if (images.length < 2)
        throw new Error("Choose at least two images to reconstruct together");
      jobIds.push(
        await this.submit({
          kind: "reconstruct",
          assetIds: images.map((asset) => asset.id),
          integrate: true,
          placement,
          ...destination,
        }),
      );
    }
    for (const asset of assets) {
      if (reconstruct && asset.kind === "image") continue;
      if (asset.kind === "image" && !(asset.camera && asset.depthAssetId)) {
        const jobId = await this.submit({
          kind: "pose",
          assetIds: [asset.id],
          canonicalize: false,
          placement,
        });
        jobIds.push(jobId);
        const input = this.store.snapshot().jobs[jobId].input;
        if (input.kind === "pose") placed.push(...input.nodeIds!);
      } else {
        const id = `node_${randomUUID()}`;
        placed.push(id);
        const nodes =
          asset.kind === "image"
            ? createCapture(asset, id, placement)
            : [
                {
                  id,
                  name: asset.name,
                  kind: asset.kind as "splat" | "video",
                  assetId: asset.id,
                  parentId: null,
                  visible: true,
                  transform: identity(),
                },
              ];
        await this.store.update((state) => {
          applyCommand(state, { type: "nodes.put", nodes });
          applyCommand(state, { type: "selection.set", ids: [id] });
        });
      }
    }
    if (
      placed.length &&
      (destination?.parentId !== undefined ||
        destination?.beforeId !== undefined)
    )
      await this.store.update((state) =>
        applyCommand(state, {
          type: "nodes.move",
          ids: placed,
          parentId: destination.parentId ?? null,
          beforeId: destination.beforeId,
        }),
      );
    return jobIds;
  }
  private pump() {
    if (this.stopped) return;
    for (const job of Object.values(this.store.snapshot().jobs)) {
      if (this.active.size >= 3) break;
      if (
        job.status !== "queued" ||
        ["capture", "inspect"].includes(job.input.kind) ||
        this.active.has(job.id)
      )
        continue;
      const controller = new AbortController();
      this.active.set(job.id, controller);
      const task = this.run(job.id, controller.signal)
        .catch((error) =>
          console.error("worldbash job could not save its status:", error),
        )
        .finally(() => {
          this.active.delete(job.id);
          this.running.delete(task);
          this.pump();
        });
      this.running.add(task);
    }
  }
  private async patch(id: string, patch: Partial<Job>) {
    await this.store.update((state) => {
      const job = state.jobs[id];
      if (job.status === "cancelled") return;
      Object.assign(job, patch, { updatedAt: Date.now() });
    });
  }
  private async run(id: string, signal: AbortSignal) {
    try {
      await this.patch(id, { status: "running", message: "Preparing inputs" });
      let job = this.store.snapshot().jobs[id];
      signal.throwIfAborted();
      const assets: Asset[] = [];
      if (job.input.kind === "contactSheet")
        assets.push(...(await renderContactSheet(this.store, job, signal)));
      if (
        job.input.kind === "reconstruct" &&
        job.input.videoAssetId &&
        !job.input.assetIds.length
      ) {
        const frames = await extractVideoFrames(
          this.store,
          job.input.videoAssetId,
          job.input.fps,
          job.input.maxFrames,
          id,
          signal,
        );
        job.input.assetIds = frames.map((asset) => asset.id);
        if (job.contextSnapshot)
          for (const asset of frames)
            job.contextSnapshot.assets[asset.id] = asset;
        await this.patch(id, {
          input: job.input,
          contextSnapshot: job.contextSnapshot,
        });
      }
      if (
        job.input.kind === "fal" ||
        job.input.kind === "nano" ||
        job.input.kind === "image"
      ) {
        const model =
          job.input.kind === "nano"
            ? job.input.settings.model
            : job.input.model;
        const fal = falClient();
        if (!job.remoteId) {
          let input: Record<string, unknown>;
          if (job.input.kind === "nano") {
            const edit = job.input;
            const draft = edit.draft ?? { strokes: [], layers: [] };
            const composite = await renderImageDraft(
              this.store,
              edit.sourceAssetId,
              draft,
              signal,
            );
            const url = await fal.storage.upload(
              new File([composite], "edit.png", { type: "image/png" }),
            );
            const references = (await resolveFalInput(
              this.store,
              edit.referenceAssetIds.map((id) => ({ $asset: id })),
              signal,
            )) as string[];
            const prompt =
              edit.prompt +
              (draft.strokes.some((stroke) => !stroke.erase)
                ? "\nDrawn marks are edit instructions. Remove the annotation marks from the final image."
                : "");
            input = {
              prompt,
              image_urls: [url, ...references],
              resolution: edit.settings.resolution,
              aspect_ratio: edit.settings.aspectRatio,
              num_images: edit.settings.numImages,
              output_format: "png",
              ...(edit.settings.seed !== undefined
                ? { seed: edit.settings.seed }
                : {}),
            };
          } else if (job.input.kind === "image") {
            input = {
              ...imageModels[job.input.model].defaults,
              prompt: job.input.prompt,
              image_size: { width: 1280, height: 720 },
              ...(job.input.seed !== undefined ? { seed: job.input.seed } : {}),
            };
          } else
            input = (await resolveFalInput(
              this.store,
              job.input.input,
              signal,
            )) as Record<string, unknown>;
          await this.patch(id, {
            request: input,
            submittedAt: Date.now(),
            message: "Submitting to FAL",
          });
          const request = await fal.queue.submit(model, {
            input,
            abortSignal: signal,
          });
          await this.patch(id, { remoteId: request.request_id });
          job = this.store.snapshot().jobs[id];
        }
        if (
          job.input.kind !== "fal" &&
          job.input.kind !== "nano" &&
          job.input.kind !== "image"
        )
          throw new Error("FAL job input changed");
        for (;;) {
          signal.throwIfAborted();
          const status = await fal.queue.status(model, {
            requestId: job.remoteId!,
            logs: true,
            abortSignal: signal,
          });
          if (status.status === "COMPLETED") break;
          await this.patch(id, {
            message:
              status.status === "IN_QUEUE"
                ? `FAL queue position ${status.queue_position}`
                : "FAL is generating",
          });
          await new Promise<void>((resolve, reject) => {
            const abort = () => {
              clearTimeout(timer);
              reject(signal.reason);
            };
            const timer = setTimeout(() => {
              signal.removeEventListener("abort", abort);
              resolve();
            }, 2000);
            signal.addEventListener("abort", abort, { once: true });
          });
        }
        const result = await fal.queue.result(model, {
          requestId: job.remoteId!,
          abortSignal: signal,
        });
        const urls = falOutputUrls(result.data);
        for (let i = 0; i < urls.length; i++) {
          signal.throwIfAborted();
          const url = urls[i];
          const name = new URL(url).pathname.split("/").pop() || `output-${i}`;
          const existing = Object.values(this.store.snapshot().assets).find(
            (a) => a.jobId === id && a.path.endsWith(`${id}-${i}-${name}`),
          );
          assets.push(
            existing ??
              (await this.store.importFile(
                await downloadTaskAsset({ url }, signal),
                `${id}-${i}-${name}`,
                {
                  jobId: id,
                  ...(job.input.kind === "nano"
                    ? {
                        name: `Nano Banana ${i + 1}`,
                        parentAssetId: job.input.sourceAssetId,
                        referenceAssetIds: job.input.referenceAssetIds,
                        ...nanoGeometry(
                          { ...this.store.snapshot(), ...job.contextSnapshot },
                          job,
                        ),
                      }
                    : {}),
                },
              )),
          );
        }
        if (job.input.kind === "image") {
          const asset = assets.find((asset) => asset.kind === "image");
          if (!asset) throw new Error("Image generation returned no image");
          signal.throwIfAborted();
          await this.store.update((state) => {
            signal.throwIfAborted();
            applyJobResult(state, job, (targets) => {
              const nodes = targets.flatMap((target) =>
                [target.nodeId, target.imageId, target.pointsId].map((id) => ({
                  ...state.nodes[id],
                  assetId: asset.id,
                })),
              );
              return nodes.length ? [{ type: "nodes.put", nodes }] : [];
            });
          });
          const current = this.store.snapshot().jobs[id];
          if (current.appliedTargets.length) {
            const childJobId = await this.submit(
              {
                kind: "pose",
                assetIds: [asset.id],
                canonicalize: false,
                placement: job.input.placement,
              },
              `${id}-pose`,
              job,
            );
            await this.patch(id, { childJobId });
          }
        }
        if (job.input.kind === "nano" && assets[0]) {
          const reconstruct = await applyNanoResult(
            this.store,
            job,
            assets[0],
            signal,
          );
          if (reconstruct) {
            const childJobId = await this.submit(
              {
                kind: "reconstruct",
                assetIds: [assets[0].id],
                integrate: false,
              },
              `${id}-reconstruct`,
              job,
            );
            await this.patch(id, { childJobId });
          }
        }
        const manifest = await this.store.importFile(
          new Blob([JSON.stringify(result.data, null, 2)], {
            type: "application/json",
          }),
          `${id}-result.json`,
          { jobId: id },
        );
        assets.push(manifest);
      } else if (
        job.input.kind === "pose" ||
        job.input.kind === "atlas" ||
        job.input.kind === "video" ||
        job.input.kind === "reconstruct" ||
        job.input.kind === "splats"
      ) {
        const client = worldLabs();
        let operation;
        if (job.remoteId)
          operation = await client.operations.get(job.remoteId, { signal });
        else {
          const request =
            job.request ??
            (await buildWorldLabsRequest(
              this.store,
              job,
              job.contextSnapshot
                ? { ...this.store.snapshot(), ...job.contextSnapshot }
                : this.store.snapshot(),
              signal,
            ));
          await this.patch(id, {
            request,
            message: "Submitting to World Labs",
          });
          const options = { idempotencyKey: id, signal };
          operation =
            job.input.kind === "pose" || job.input.kind === "reconstruct"
              ? await client.tasks.images2PosedRGBD(
                  request as Images2PosedRGBDRequest,
                  options,
                )
              : job.input.kind === "splats"
                ? await client.tasks.posedImages2Splats(
                    request as PosedImages2SplatsRequest,
                    options,
                  )
                : await client.tasks.atlasGenerate(
                    request as AtlasGenerateRequest,
                    options,
                  );
          await this.patch(id, { remoteId: operation.id });
        }
        await this.patch(id, {
          message:
            job.input.kind === "splats"
              ? `World Labs is reconstructing splats (${job.input.refine ? "15 to 25 minutes" : "a few minutes"})`
              : "World Labs is generating",
        });
        const completed = await client.operations.wait(operation, {
          signal,
          pollIntervalMs: job.input.kind === "splats" ? 10000 : 2000,
          retryNetworkErrors: true,
        });
        if (completed.error)
          throw new Error(completed.error.message ?? "World Labs task failed");
        if (!completed.response)
          throw new Error("World Labs returned no result");
        if (job.input.kind === "atlas" || job.input.kind === "video") {
          const response = completed.response as AtlasGenerateResponse;
          const request = this.store.snapshot().jobs[id].request as
            AtlasGenerateRequest | undefined;
          const prompt = job.input.prompt;
          if (request?.enhancePrompt && response.promptUsed?.trim()) {
            const text = response.promptUsed;
            await this.store.update((state) => {
              if (state.jobs[id].status === "cancelled") return;
              if (
                state.settings.prompt !== prompt ||
                (state.settings.captionEpoch ?? 0) !==
                  (job.contextSnapshot?.settings.captionEpoch ?? 0)
              )
                return;
              // Keep the first caption for this description until it is explicitly cleared.
              state.settings.enhancedCaption ??= { prompt, text };
            });
          }
        }
        if (job.input.kind === "splats")
          assets.push(
            await this.saveSplats(
              job,
              completed.response as PosedImages2SplatsResponse,
              signal,
            ),
          );
        else {
          const frames =
            job.input.kind === "pose" || job.input.kind === "reconstruct"
              ? (completed.response as Images2PosedRGBDResponse).frames
              : (completed.response as AtlasGenerateResponse).frames;
          if (!frames?.length) throw new Error("World Labs returned no frames");
          const expected =
            job.input.kind === "pose" || job.input.kind === "reconstruct"
              ? job.input.assetIds.length
              : (this.store.snapshot().jobs[id].request as AtlasGenerateRequest)
                  .targetCameras.length;
          if (frames.length !== expected)
            throw new Error(
              `World Labs returned ${frames.length} of ${expected} frames`,
            );
          if (job.input.kind === "pose" && frames.length > 1) {
            job.poseOrigin = frames[0].camera.extrinsics.position;
            await this.patch(id, { poseOrigin: job.poseOrigin });
          }
          if (job.input.kind === "reconstruct")
            assets.push(
              ...(await reconstructFrames(
                this.store,
                job,
                frames as Images2PosedRGBDPerImageResult[],
                signal,
              )),
            );
          else
            for (let i = 0; i < frames.length; i++) {
              signal.throwIfAborted();
              await this.patch(id, {
                message: `Saving frame ${i + 1} of ${frames.length}`,
              });
              assets.push(
                await saveFrame(this.store, job, frames[i], i, signal),
              );
            }
          if (job.input.kind === "atlas")
            await integrateAssets(
              this.store,
              assets.map((asset) => asset.id),
              signal,
            );
          if (job.input.kind === "video") {
            if (job.input.sourceJobId) {
              const byIndex = new Map(
                assets.map((asset) => [asset.frameIndex!, asset]),
              );
              for (const id of job.sourceFrameAssetIds ?? []) {
                const asset = job.contextSnapshot!.assets[id];
                byIndex.set(asset.frameIndex!, asset);
              }
              assets.splice(
                0,
                assets.length,
                ...[...byIndex.entries()]
                  .sort((a, b) => a[0] - b[0])
                  .map(([, asset]) => asset),
              );
            }
            await this.patch(id, {
              frameAssetIds: assets.map((asset) => asset.id),
            });
            await this.patch(id, { message: "Encoding video" });
            assets.push(
              await encodeVideo(
                this.store,
                assets,
                job.input.mode === "keyframes"
                  ? (assets.length * job.input.fps) / job.input.targetFrameCount
                  : job.input.fps,
                id,
                signal,
              ),
            );
          }
        }
      }
      signal.throwIfAborted();
      await this.patch(id, {
        status: "succeeded",
        outputAssetIds: assets.map((a) => a.id),
        frameAssetIds: assets
          .filter((a) => a.kind === "image")
          .map((a) => a.id),
        message: this.store.snapshot().jobs[id].applicationError
          ? `Saved ${assets.length} outputs; scene application failed: ${this.store.snapshot().jobs[id].applicationError}`
          : `Saved ${assets.length} outputs`,
        error: undefined,
      });
    } catch (error) {
      if (
        !this.stopped &&
        this.store.snapshot().jobs[id]?.status !== "cancelled"
      )
        await this.patch(id, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          message: "Generation failed",
        });
    }
  }
  /** Import the reconstructed SPZ once and add it at the root; its splats share the context cameras' world frame. */
  private async saveSplats(
    job: Job,
    response: PosedImages2SplatsResponse,
    signal: AbortSignal,
  ) {
    const name = `${job.id}-splats.spz`;
    const existing = Object.values(this.store.snapshot().assets).find(
      (asset) => asset.jobId === job.id && asset.path.endsWith(name),
    );
    if (existing) return existing;
    const levels = Object.entries(response.refinedSplats ?? {}).sort(
      (a, b) => Number(b[0]) - Number(a[0]),
    );
    const splat = levels[0]?.[1] ?? response.draftSplat;
    if (!splat) throw new Error("World Labs returned no splats");
    await this.patch(job.id, { message: "Downloading splats" });
    const asset = await this.store.importFile(
      await downloadTaskAsset(splat, signal),
      name,
      {
        jobId: job.id,
        name: `${job.input.kind === "splats" && job.input.refine ? "Refined" : "Draft"} splats`,
      },
    );
    const nodeId = `node_${randomUUID()}`;
    await this.store.update((state) => {
      applyCommand(state, {
        type: "nodes.put",
        nodes: [
          {
            id: nodeId,
            name: asset.name,
            kind: "splat",
            assetId: asset.id,
            jobId: job.id,
            parentId: null,
            visible: true,
            transform: identity(),
          },
        ],
      });
      applyCommand(state, { type: "selection.set", ids: [nodeId] });
    });
    return asset;
  }
  async cancel(id: string) {
    const job = this.store.snapshot().jobs[id];
    if (!job || !["queued", "running"].includes(job.status))
      throw new Error("Job is not active");
    await this.store.update((state) => {
      Object.assign(state.jobs[id], {
        status: "cancelled",
        updatedAt: Date.now(),
        message:
          "Stopped locally; the provider may still finish and bill this request",
      });
    });
    this.active.get(id)?.abort(new Error("Cancelled"));
    const childId =
      job.childJobId ??
      `${id}-${job.input.kind === "image" ? "pose" : "reconstruct"}`;
    const child = this.store.snapshot().jobs[childId];
    if (child && ["queued", "running"].includes(child.status))
      await this.cancel(childId);
    if (
      (job.input.kind === "fal" ||
        job.input.kind === "nano" ||
        job.input.kind === "image") &&
      job.remoteId
    )
      await falClient().queue.cancel(
        job.input.kind === "nano" ? job.input.settings.model : job.input.model,
        { requestId: job.remoteId },
      );
  }
  async retry(id: string) {
    const job = this.store.snapshot().jobs[id];
    if (!job || !["failed", "cancelled"].includes(job.status))
      throw new Error("Only failed or cancelled jobs can be retried");
    if (
      (job.input.kind === "fal" ||
        job.input.kind === "nano" ||
        job.input.kind === "image") &&
      job.submittedAt &&
      !job.remoteId
    )
      throw new Error(
        "FAL may have accepted the earlier submission. Check FAL history, then explicitly submit a new job if needed.",
      );
    // Retain the request and operation ID; recovery must not submit a second paid job.
    await this.store.update((state) => {
      Object.assign(state.jobs[id], {
        status: "queued",
        error: undefined,
        updatedAt: Date.now(),
        message: "Resuming request",
      });
    });
    this.pump();
    return id;
  }
  async close() {
    this.stopped = true;
    for (const controller of this.active.values())
      controller.abort(new Error("Server is stopping"));
    await Promise.allSettled([...this.running]);
  }
}
