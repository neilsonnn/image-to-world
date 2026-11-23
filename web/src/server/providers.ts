import { worldLabsKeyUrl } from "../../../core/environment";
import { applyJobResult } from "../../../core/result-targets";
import { prepareContext } from "./depth";
import { applyCommand } from "../../../core/commands";
import {
  captureFrame,
  createCapture,
  completeCapture,
} from "../../../core/captures";
import { loadImage } from "@napi-rs/canvas";
import { createFalClient } from "@fal-ai/client";
import {
  assetRef,
  createClient,
  type AtlasGenerateRequest,
  type Images2PosedRGBDPerImageResult,
  type Images2PosedRGBDRequest,
  type PosedImages2SplatsRequest,
  type PosedRGBAsset,
  type PosedRGBDAsset,
  type TaskAsset,
} from "@worldlabsai/client";
import { atlasCamera } from "../../../core/cameras";
import { closestFormat, sessionFormat } from "../../../core/formats";
import {
  cameraSchema,
  type Asset,
  type Job,
  type Workspace,
} from "../../../core/schema";
import type { WorkspaceStore } from "./store";
import { environmentValue } from "./environment";

export function worldLabs() {
  const apiKey = environmentValue("WLT_API_KEY")?.trim();
  if (!apiKey)
    throw new Error(
      `Atlas needs a World Labs API key. Create one at ${worldLabsKeyUrl} and add WLT_API_KEY in Workspace settings → Environment variables.`,
    );
  return createClient({
    apiKey,
    baseUrl: environmentValue("WLT_API_BASE_URL") || undefined,
  });
}

export const falClient = () =>
  createFalClient({ credentials: required("FAL_KEY") });
function required(name: string) {
  const value = environmentValue(name);
  if (!value)
    throw new Error(`Add ${name} in Settings → Environment variables`);
  return value;
}

export async function buildWorldLabsRequest(
  store: WorkspaceStore,
  job: Job,
  snapshot: Workspace,
  signal: AbortSignal,
): Promise<
  Images2PosedRGBDRequest | AtlasGenerateRequest | PosedImages2SplatsRequest
> {
  const client = worldLabs();
  const uploaded = new Map<string, TaskAsset>();
  const upload = async (id: string): Promise<TaskAsset> => {
    const key = id;
    if (uploaded.has(key)) return uploaded.get(key)!;
    const { asset, file } = await store.assetFile(id);
    const expected = snapshot.assets[id];
    if (
      expected &&
      (expected.modifiedAt !== asset.modifiedAt || expected.size !== asset.size)
    )
      throw new Error(
        `Asset ${asset.name} changed after generation was queued`,
      );
    const blob: Blob = Bun.file(file);
    const ref = assetRef(
      await client.assets.upload(blob, {
        displayName: asset.name,
        mimeType: asset.mimeType,
        signal,
      }),
    );
    uploaded.set(key, ref);
    return ref;
  };
  if (job.input.kind === "pose" || job.input.kind === "reconstruct") {
    const frames = [];
    for (const id of job.input.assetIds) {
      if (snapshot.assets[id]?.kind !== "image")
        throw new Error(`Posing needs image assets: ${id}`);
      frames.push({ imageAsset: await upload(id) });
    }
    const { file } = await store.assetFile(job.input.assetIds[0]);
    const image = await loadImage(file);
    const format = closestFormat(image);
    const targetResolution: [number, number] = [format.width, format.height];
    return {
      frames,
      canonicalizeToFirstFrame:
        job.input.kind === "pose" ? job.input.canonicalize : false,
      targetResolution,
    };
  }
  if (
    job.input.kind !== "atlas" &&
    job.input.kind !== "video" &&
    job.input.kind !== "splats"
  )
    throw new Error("Not a World Labs job");
  const contextFrames: PosedRGBDAsset[] = [];
  for (const id of job.input.nodeIds) {
    const frame = captureFrame(snapshot, id);
    for (const assetId of [
      frame.asset.id,
      frame.asset.depthAssetId,
      frame.asset.maskAssetId,
      frame.asset.confidenceAssetId,
    ].filter((id): id is string => !!id)) {
      const expected = snapshot.assets[assetId],
        actual = (await store.assetFile(assetId)).asset;
      if (
        !expected ||
        !actual ||
        actual.missing ||
        expected.modifiedAt !== actual.modifiedAt ||
        expected.size !== actual.size
      )
        throw new Error("A context asset changed after generation was queued");
    }
    const prepared = await prepareContext(store, snapshot, id, signal);
    const uploadPrepared = async (blob: Blob, suffix: string) =>
      assetRef(
        await client.assets.upload(blob, {
          displayName: `${frame.node.name} ${suffix}`,
          mimeType: blob.type,
          signal,
        }),
      );
    contextFrames.push({
      imageAsset: await uploadPrepared(prepared.image, "image"),
      camera: prepared.camera,
      depth: { depthAsset: await uploadPrepared(prepared.depth, "depth") },
    });
  }
  const enhance =
    job.input.kind === "video"
      ? snapshot.settings.enhancePrompt
      : job.input.enhancePrompt;
  const cached = snapshot.settings.enhancedCaption;
  const reuse = enhance && cached?.prompt === job.input.prompt;
  const prompt = reuse ? cached.text : job.input.prompt || null;
  const enhancePrompt = enhance && !reuse;
  if (job.input.kind === "splats")
    return {
      posedFrames: contextFrames,
      prompt,
      enhancePrompt,
      refine: job.input.refine,
    };
  const cameras =
    job.input.kind === "atlas"
      ? job.input.cameras
      : (job.frameIndices ?? []).map((index) => job.cameras![index]);
  return {
    contextFrames,
    targetCameras: cameras.map((camera) =>
      atlasCamera(camera, sessionFormat(snapshot)),
    ),
    prompt,
    enhancePrompt,
    returnDepth: job.input.returnDepth,
    modelParameters: { seed: job.input.seed },
  };
}

export async function downloadTaskAsset(
  ref: TaskAsset,
  signal: AbortSignal,
): Promise<Blob> {
  let url = ref.url;
  if (ref.assetId)
    url = (await worldLabs().assets.createReadUrl(ref.assetId, { signal }))
      .readUrl;
  if (!url) {
    if (ref.base64)
      return new Blob([
        Buffer.from(ref.base64.replace(/^data:[^,]*,/, ""), "base64"),
      ]);
    throw new Error("API returned an asset without a URL or asset ID");
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:")
    throw new Error("API asset URLs must use HTTPS");
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(`Asset download failed (${response.status})`);
  return response.blob();
}

export async function saveFrame(
  store: WorkspaceStore,
  job: Job,
  frame: PosedRGBAsset | Images2PosedRGBDPerImageResult,
  index: number,
  signal: AbortSignal,
  options: { depthBlob?: Blob; integrate?: boolean } = {},
) {
  const current = store.current;
  const existing = Object.values(current.assets).find(
    (a) =>
      a.jobId === job.id && a.path.endsWith(`${job.id}-frame-${index}.png`),
  );
  if (existing) {
    if (job.input.kind === "pose" && options.integrate !== false)
      await integrateFrame(store, job, existing, index);
    return existing;
  }
  const depth = frame.depth;
  let depthAsset: Asset | undefined,
    confidence: Asset | undefined,
    mask: Asset | undefined;
  if (depth) {
    const linear = "depthAsset" in depth;
    depthAsset = await store.importFile(
      options.depthBlob ??
        (await downloadTaskAsset(
          linear ? depth.depthAsset : depth.logDepthAsset,
          signal,
        )),
      `${job.id}-depth-${index}.${linear ? "exr" : "png"}`,
      { kind: "depth", jobId: job.id },
    );
    if (linear && depth.confidenceAsset)
      confidence = await store.importFile(
        await downloadTaskAsset(depth.confidenceAsset, signal),
        `${job.id}-confidence-${index}.png`,
        { kind: "depth", jobId: job.id },
      );
  }
  if (frame.maskAsset)
    mask = await store.importFile(
      await downloadTaskAsset(frame.maskAsset, signal),
      `${job.id}-mask-${index}.png`,
      { kind: "depth", jobId: job.id },
    );
  const source =
    job.input.kind === "reconstruct"
      ? store.current.assets[job.input.assetIds[index]]
      : undefined;
  const blob = await downloadTaskAsset(frame.imageAsset, signal);
  const asset = await store.importFile(blob, `${job.id}-frame-${index}.png`, {
    camera: cameraSchema.parse(frame.camera),
    ...("centroidWorld" in frame ? { centroidWorld: frame.centroidWorld } : {}),
    jobId: job.id,
    name: `${job.input.kind === "pose" ? "Posed image" : job.input.kind === "reconstruct" ? "Reconstructed frame" : "Atlas view"} ${index + 1}`,
    frameIndex: source?.frameIndex ?? job.frameIndices?.[index] ?? index,
    ...(source
      ? { frameTime: source.frameTime, sourceVideoId: source.sourceVideoId }
      : {}),
    ...(job.input.kind === "video"
      ? {
          frameTime: (job.frameIndices?.[index] ?? index) / job.input.fps,
        }
      : {}),
    ...(job.input.kind === "pose" || job.input.kind === "reconstruct"
      ? { parentAssetId: job.input.assetIds[index] }
      : {}),
    ...(depthAsset
      ? {
          depthAssetId: depthAsset.id,
          depthEncoding:
            depth && "logDepthAsset" in depth
              ? { type: "log", zMin: depth.zMin, zMax: depth.zMax }
              : { type: "linear" },
        }
      : {}),
    ...(confidence ? { confidenceAssetId: confidence.id } : {}),
    ...(mask ? { maskAssetId: mask.id } : {}),
  });
  if (job.input.kind === "pose" && options.integrate !== false)
    await integrateFrame(store, job, asset, index);
  return asset;
}

async function integrateFrame(
  store: WorkspaceStore,
  job: Job,
  asset: Asset,
  index: number,
) {
  if (job.input.kind !== "pose") return;
  const input = job.input;
  const targets = (job.applyTargets ?? []).filter(
    (target) => target.nodeId === input.nodeIds?.[index],
  );
  const changes = (
    state: Workspace,
    owned: NonNullable<Job["applyTargets"]>,
  ) => {
    const next = { ...state, nodes: { ...state.nodes } };
    for (const target of owned) {
      completeCapture(
        next,
        target.nodeId,
        asset,
        input.placement,
        job.poseOrigin,
      );
    }
    return Object.values(next.nodes).filter(
      (node) => JSON.stringify(node) !== JSON.stringify(state.nodes[node.id]),
    );
  };
  await store.updateSceneAndJob(job.id, (state) => {
    applyJobResult(
      state,
      job,
      (owned) => {
        const nodes = changes(state, owned);
        return nodes.length ? [{ type: "nodes.put", nodes }] : [];
      },
      targets,
      false,
    );
  });
}

export async function resolveFalInput(
  store: WorkspaceStore,
  value: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted();
  if (Array.isArray(value)) {
    const result = [];
    for (const item of value)
      result.push(await resolveFalInput(store, item, signal));
    return result;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object.$asset === "string") {
      const { file, asset } = await store.assetFile(object.$asset);
      return falClient().storage.upload(
        new File([Bun.file(file)], asset.name, { type: asset.mimeType }),
      );
    }
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(object))
      result[key] = await resolveFalInput(store, child, signal);
    return result;
  }
  return value;
}

export function falOutputs(value: unknown) {
  const files = new Map<string, string[]>();
  function walk(item: unknown, path: string[]) {
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (
        key === "url" &&
        typeof child === "string" &&
        child.startsWith("https://")
      ) {
        const names = files.get(child) ?? [];
        names.push(path.join("."));
        files.set(child, names);
      } else walk(child, [...path, key]);
    }
  }
  walk(value, []);
  return Array.from(files, ([url, paths]) => ({ url, paths }));
}
