import { selectedImageOperation } from "../../../core/image-operation";
import { applyCommand } from "../../../core/commands";
import { createCapture } from "../../../core/captures";
import { claimResultTargets, resultTarget } from "../../../core/result-targets";
import { DataTexture, FloatType, RGBAFormat } from "three";
import { EXRExporter } from "three/examples/jsm/exporters/EXRExporter.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  jobSchema as fullJobSchema,
  emptyWorkspace,
  type Workspace,
} from "../../../core/schema";
import { createService } from "./http";
import { renderImageDraft } from "./image-edit";
import { JobRunner } from "./jobs";
import { WorkspaceStore } from "./store";

const cleanups: (() => Promise<unknown>)[] = [];
beforeEach(async () => {
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = await directory();
  cleanups.push(async () => {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
  });
});
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean();
});
async function directory() {
  const root = await mkdtemp(path.join(tmpdir(), "image-to-world-flow-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}
function png(color = "white") {
  const canvas = createCanvas(20, 20);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 20, 20);
  return new Blob([new Uint8Array(canvas.toBuffer("image/png"))], {
    type: "image/png",
  });
}
async function depthExr() {
  const values = new Float32Array(20 * 20 * 4).fill(2);
  const texture = new DataTexture(values, 20, 20, RGBAFormat, FloatType);
  try {
    return new Blob(
      [
        new Uint8Array(
          await new EXRExporter().parse(texture, { type: FloatType }),
        ),
      ],
      { type: "image/x-exr" },
    );
  } finally {
    texture.dispose();
  }
}
async function done(store: WorkspaceStore, id: string) {
  for (let i = 0; i < 200; i++) {
    const job = store.snapshot().jobs[id];
    if (job && ["succeeded", "failed"].includes(job.status))
      return store.loadJob(id);
    await Bun.sleep(10);
  }
  throw new Error("Job did not settle");
}
const commandRequest = (command: unknown, origin?: string, header = true) =>
  new Request("http://127.0.0.1:4310/api/commands", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(header ? { "X-Image-To-World-Client": "test" } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(command),
  });

test("HTTP commands reject cross-origin edits and leave browser and CLI on the same state", async () => {
  const service = await createService(await directory());
  cleanups.push(() => service.close());
  const command = { type: "workspace.update", name: "Shared studio" };
  expect(
    (await service.handle(commandRequest(command, "https://other.example")))
      .status,
  ).toBe(403);
  expect(
    (await service.handle(commandRequest(command, undefined, false))).status,
  ).toBe(403);
  expect((await service.handle(commandRequest(command))).status).toBe(200);
  const state = (await (
    await service.handle(new Request("http://127.0.0.1:4310/api/workspace"))
  ).json()) as Workspace;
  expect(state.name).toBe("Shared studio");
});
test("annotation erasing preserves the original image and server layers composite", async () => {
  const store = await new WorkspaceStore(await directory()).init();
  cleanups.push(() => store.close());
  const source = await store.importFile(png(), "source.png");
  const layer = await store.importFile(png("blue"), "layer.png");
  const blob = await renderImageDraft(
    store,
    source.id,
    {
      layers: [
        {
          id: "layer",
          assetId: layer.id,
          x: 0,
          y: 0,
          width: 0.5,
          height: 1,
          opacity: 1,
          visible: true,
        },
      ],
      strokes: [
        {
          id: "red",
          points: [[0.75, 0.5]],
          color: "#ff0000",
          size: 0.2,
          erase: false,
        },
        {
          id: "erase",
          points: [[0.75, 0.5]],
          color: "#000000",
          size: 0.2,
          erase: true,
        },
      ],
    },
    new AbortController().signal,
  );
  const image = await loadImage(Buffer.from(await blob.arrayBuffer()));
  const canvas = createCanvas(20, 20);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  expect([...ctx.getImageData(2, 10, 1, 1).data]).toEqual([0, 0, 255, 255]);
  expect([...ctx.getImageData(15, 10, 1, 1).data]).toEqual([
    255, 255, 255, 255,
  ]);
});
test("Nano Banana uses FAL binary uploads and creates a persistent branch with its original settings", async () => {
  const old = process.env.FAL_KEY;
  process.env.FAL_KEY = "test-key";
  cleanups.push(async () => {
    if (old === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = old;
  });
  const store = await new WorkspaceStore(await directory()).init();
  cleanups.push(() => store.close());
  const source = await store.importFile(png(), "source.png");
  const reference = await store.importFile(png("blue"), "reference.png");
  let submitted: Record<string, unknown> | undefined;
  let submits = 0;
  let puts = 0;
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const url = request.url;
        if (url.includes("/storage/upload/initiate"))
          return Response.json({
            upload_url: "https://fixture.example/upload",
            file_url: "https://fixture.example/input.png",
          });
        if (url === "https://fixture.example/upload") {
          puts++;
          expect(request.method).toBe("PUT");
          return new Response("");
        }
        if (url.includes("queue.fal.run") && request.method === "POST") {
          submitted = (await request.json()) as Record<string, unknown>;
          submits++;
          return Response.json({ request_id: "fal-request" });
        }
        if (url.endsWith("/status?logs=1") || url.includes("/status?"))
          return Response.json({ status: "COMPLETED" });
        if (url.includes("/requests/fal-request"))
          return Response.json({
            images: [{ url: "https://fixture.example/result.png" }],
            description: "Edited",
          });
        if (url === "https://fixture.example/result.png")
          return new Response(png("green"));
        throw new Error(`Unexpected provider request ${request.method} ${url}`);
      },
      { preconnect: () => {} },
    ),
  );
  cleanups.push(async () => {
    network.mockRestore();
  });
  const runner = new JobRunner(store);
  cleanups.push(() => runner.close());
  const id = await runner.submit({
    kind: "nano",
    sourceAssetId: source.id,
    referenceAssetIds: [reference.id],
    prompt: "Add a tree",
    settings: {
      model: "fal-ai/nano-banana-2/edit",
      resolution: "1K",
      aspectRatio: "auto",
      numImages: 1,
      seed: 7,
    },
  });
  const job = await done(store, id);
  expect(job.error).toBeUndefined();
  expect(job.status).toBe("succeeded");
  expect(submits).toBe(1);
  expect(puts).toBe(2);
  expect(submitted?.prompt).toBe("Add a tree");
  expect(submitted?.image_urls).toEqual([
    "https://fixture.example/input.png",
    "https://fixture.example/input.png",
  ]);
  const output = store.snapshot().assets[job.outputAssetIds[0]];
  expect(output.parentAssetId).toBe(source.id);
  expect(output.referenceAssetIds).toEqual([reference.id]);
  expect(JSON.stringify(store.snapshot())).not.toContain("test-key");
  expect(JSON.stringify(store.snapshot())).not.toContain("base64");
});
test("restart resumes a saved World Labs operation without submitting another task", async () => {
  const old = process.env.WLT_API_KEY;
  process.env.WLT_API_KEY = "test-key";
  cleanups.push(async () => {
    if (old === undefined) delete process.env.WLT_API_KEY;
    else process.env.WLT_API_KEY = old;
  });
  const store = await new WorkspaceStore(await directory()).init();
  cleanups.push(() => store.close());
  const source = await store.importFile(png(), "source.png");
  const camera = emptyWorkspace().settings.viewportCamera;
  await store.update((state) => {
    applyCommand(state, {
      type: "nodes.put",
      nodes: createCapture(source, "resume-capture"),
    });
    state.jobs.resume = fullJobSchema.parse({
      id: "resume",
      applyRoots: [],
      appliedTargets: [],
      input: {
        kind: "pose",
        assetIds: [source.id],
        nodeIds: ["resume-capture"],
        canonicalize: true,
      },
      status: "running",
      createdAt: 0,
      updatedAt: 0,
      message: "Generating",
      outputAssetIds: [],
      remoteId: "op-saved",
      applyTargets: [resultTarget(state, "resume-capture")],
    });
  });
  await store.update((state) => claimResultTargets(state, state.jobs.resume));
  let submissions = 0;
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        if (request.method === "POST") {
          submissions++;
          throw new Error("Unexpected submission");
        }
        if (request.url.includes("/operations/"))
          return Response.json({
            id: "op-saved",
            ownerId: "owner",
            done: true,
            response: {
              frames: [
                {
                  imageAsset: { url: "https://fixture.example/frame.png" },
                  camera,
                  depth: {
                    depthAsset: { url: "https://fixture.example/depth.exr" },
                  },
                  centroidWorld: [0, 0, 0],
                },
              ],
            },
          });
        return new Response(
          request.url.endsWith(".exr") ? await depthExr() : png(),
        );
      },
      { preconnect: () => {} },
    ),
  );
  cleanups.push(async () => {
    network.mockRestore();
  });
  const runner = new JobRunner(store);
  cleanups.push(() => runner.close());
  await runner.init();
  const job = await done(store, "resume");
  expect(job.error).toBeUndefined();
  expect(job.status).toBe("succeeded");
  expect(submissions).toBe(0);
  expect(job.outputAssetIds).toHaveLength(1);
  expect(Object.values(store.snapshot().nodes)[0].assetId).toBe(
    job.outputAssetIds[0],
  );
});

test("camera-path frames encode into a saved playable MP4", async () => {
  const { encodeVideo, ffmpegPath } = await import("./video");
  if (!ffmpegPath()) throw new Error("This verification requires FFmpeg");
  const store = await new WorkspaceStore(await directory()).init();
  cleanups.push(() => store.close());
  const frames = [
    await store.importFile(png("red"), "frame-0.png"),
    await store.importFile(png("blue"), "frame-1.png"),
  ];
  const asset = await encodeVideo(
    store,
    frames,
    2,
    "video-test",
    new AbortController().signal,
  );
  const { file } = await store.assetFile(asset.id);
  const data = await Bun.file(file).arrayBuffer();
  expect(asset.kind).toBe("video");
  expect(new TextDecoder().decode(data.slice(4, 8))).toBe("ftyp");
});

test("placing images poses in the background, preserves edits, and feeds moved captures into Atlas", async () => {
  const { applyCommand } = await import("../../../core/commands");
  const { atlasContext, sceneCamera } = await import("../../../core/captures");
  const old = process.env.WLT_API_KEY;
  process.env.WLT_API_KEY = "test-key";
  cleanups.push(async () => {
    if (old === undefined) delete process.env.WLT_API_KEY;
    else process.env.WLT_API_KEY = old;
  });
  const store = await new WorkspaceStore(await directory()).init();
  cleanups.push(() => store.close());
  const source = await store.importFile(png(), "source.png");
  const solved = emptyWorkspace().settings.viewportCamera;
  solved.extrinsics = {
    position: [0, 1.8, 0],
    quaternion: [0, 0, 0, 1],
    coordinateSystem: "rub",
  };
  solved.intrinsics = { fx: 20, fy: 20, cx: 10, cy: 10, width: 20, height: 20 };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  cleanups.push(async () => release());
  let started!: () => void;
  const submitted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let poseRequest: any,
    atlasRequest: any,
    uploads = 0;
  const frame = {
    imageAsset: { url: "https://fixture.example/frame.png" },
    camera: solved,
    depth: { depthAsset: { url: "https://fixture.example/depth.exr" } },
    centroidWorld: [0, 0, 0],
  };
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const url = request.url;
        if (url.endsWith("/assets") && request.method === "POST")
          return Response.json({ id: `asset-${++uploads}` });
        if (url.includes(":createUploadUrl"))
          return Response.json({
            uploadUrl: "https://fixture.example/upload",
            method: "PUT",
          });
        if (url.includes(":completeUpload"))
          return Response.json({ id: `asset-${uploads}` });
        if (url.endsWith("/upload")) return new Response("");
        if (url.includes("images2PosedRGBD")) {
          poseRequest = await request.json();
          started();
          await gate;
          return Response.json({
            id: "pose-operation",
            done: true,
            response: { frames: [frame] },
          });
        }
        if (url.includes("atlasGenerate")) {
          atlasRequest = await request.json();
          return Response.json({
            id: "atlas-operation",
            done: true,
            response: {
              frames: [{ ...frame, camera: atlasRequest.targetCameras[0] }],
            },
          });
        }
        if (url.endsWith(".exr")) return new Response(await depthExr());
        if (url.endsWith(".png")) return new Response(png());
        throw new Error(`Unexpected fixture request: ${url}`);
      },
      { preconnect: () => {} },
    ),
  );
  cleanups.push(async () => network.mockRestore());
  const runner = new JobRunner(store);
  cleanups.push(() => runner.close());
  const camera = emptyWorkspace().settings.viewportCamera;
  camera.extrinsics = {
    position: [7, 4, -3],
    quaternion: [0, 0, 0, 1],
    coordinateSystem: "rub",
  };
  const {
    jobIds: [jobId],
  } = await runner.place([source.id], camera);
  await submitted;
  const pose = store.snapshot().jobs[jobId].input;
  if (pose.kind !== "pose") throw new Error("Expected pose");
  const rootId = pose.nodeIds![0];
  expect(
    Object.values(store.snapshot().nodes)
      .filter((node) => node.parentId === rootId)
      .map((node) => node.kind)
      .sort(),
  ).toEqual(["camera", "points"]);
  await store.update((state) =>
    applyCommand(state, {
      type: "nodes.put",
      nodes: [
        {
          ...state.nodes[rootId],
          transform: {
            ...state.nodes[rootId].transform,
            position: [10, 0, -6],
          },
        },
      ],
    }),
  );
  release();
  const completed = await done(store, jobId);
  expect(completed.error).toBeUndefined();
  expect(poseRequest.canonicalizeToFirstFrame).toBe(false);
  expect(poseRequest.targetResolution).toEqual([960, 720]);
  const workspace = store.snapshot();
  expect(workspace.nodes[rootId].transform.position).toEqual([10, 0, -6]);
  expect(
    Object.values(workspace.nodes).some((node) => node.kind === "clip"),
  ).toBe(false);
  expect(sceneCamera(workspace, rootId)!.extrinsics.position).toEqual([
    10, 1.8, -6,
  ]);
  expect(atlasContext(workspace).map((frame) => frame.node.id)).toEqual([
    rootId,
  ]);
  await expect(
    runner.submit({
      kind: "atlas",
      nodeIds: [rootId],
      cameras: [sceneCamera(workspace, rootId)!],
      prompt: "",
      returnDepth: true,
      seed: 42,
    }),
  ).rejects.toThrow("translation");
  const target = structuredClone(solved);
  target.extrinsics.position = [12, 1.8, -6];
  const atlasId = await runner.submit({
    kind: "atlas",
    nodeIds: [`${rootId}_camera`],
    cameras: [target],
    prompt: "Continue the room",
    returnDepth: true,
    seed: 42,
  });
  await store.update((state) =>
    applyCommand(state, {
      type: "nodes.put",
      nodes: [{ ...state.nodes[rootId], visible: false }],
    }),
  );
  const atlas = await done(store, atlasId);
  expect(atlas.error).toBeUndefined();
  expect(atlasRequest.contextFrames[0].camera.extrinsics.position).toEqual([
    10, 1.8, -6,
  ]);
  expect(atlasRequest.contextFrames[0].maskAsset).toBeUndefined();
  expect(atlasRequest.returnDepth).toBe(true);
  // Square source images imply the 4:3 session grid.
  expect(atlasRequest.targetCameras[0].intrinsics).toEqual({
    width: 960,
    height: 720,
    fx: 960,
    fy: 960,
    cx: 480,
    cy: 360,
  });
  expect(atlasRequest.contextFrames[0].camera.intrinsics).toEqual(
    atlasRequest.targetCameras[0].intrinsics,
  );
  const outputId = `node_${atlas.outputAssetIds[0]}`;
  expect(sceneCamera(store.snapshot(), outputId)!.extrinsics.position).toEqual([
    12, 1.8, -6,
  ]);
  expect(atlasContext(store.snapshot()).map((frame) => frame.node.id)).toEqual([
    outputId,
  ]);
});

test("splats send posed context frames and place the returned SPZ once at the root", async () => {
  const old = process.env.WLT_API_KEY;
  process.env.WLT_API_KEY = "test-key";
  cleanups.push(async () => {
    if (old === undefined) delete process.env.WLT_API_KEY;
    else process.env.WLT_API_KEY = old;
  });
  const store = await new WorkspaceStore(await directory()).init();
  cleanups.push(() => store.close());
  for (const [index, x] of [0, 1].entries()) {
    const camera = emptyWorkspace().settings.viewportCamera;
    camera.extrinsics = {
      position: [x, 1.5, 0],
      quaternion: [0, 0, 0, 1],
      coordinateSystem: "rub",
    };
    camera.intrinsics = {
      fx: 20,
      fy: 20,
      cx: 10,
      cy: 10,
      width: 20,
      height: 20,
    };
    const depth = await store.importFile(await depthExr(), `d${index}.exr`, {
      kind: "depth",
    });
    const image = await store.importFile(png(), `i${index}.png`, {
      camera,
      depthAssetId: depth.id,
      depthEncoding: { type: "linear" },
    });
    await store.update((state) =>
      applyCommand(state, {
        type: "nodes.put",
        nodes: createCapture(image, `capture-${index}`),
      }),
    );
  }
  let splatRequest: any,
    uploads = 0;
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const url = request.url;
        if (url.endsWith("/assets") && request.method === "POST")
          return Response.json({ id: `asset-${++uploads}` });
        if (url.includes(":createUploadUrl"))
          return Response.json({
            uploadUrl: "https://fixture.example/upload",
            method: "PUT",
          });
        if (url.includes(":completeUpload"))
          return Response.json({ id: `asset-${uploads}` });
        if (url.endsWith("/upload")) return new Response("");
        if (url.includes("posedImages2Splats")) {
          splatRequest = await request.json();
          return Response.json({
            id: "splat-operation",
            done: true,
            response: {
              draftSplat: { url: "https://fixture.example/scene.spz" },
            },
          });
        }
        if (url.endsWith(".spz")) return new Response("spz-bytes");
        throw new Error(`Unexpected fixture request: ${url}`);
      },
      { preconnect: () => {} },
    ),
  );
  cleanups.push(async () => network.mockRestore());
  const runner = new JobRunner(store);
  cleanups.push(() => runner.close());
  await expect(
    runner.submit({ kind: "splats", nodeIds: ["capture-0"] }),
  ).rejects.toThrow("2 to 32");
  const id = await runner.submit({
    kind: "splats",
    nodeIds: ["capture-0", "capture-1"],
  });
  const job = await done(store, id);
  expect(job.error).toBeUndefined();
  expect(splatRequest.refine).toBe(false);
  expect(splatRequest.posedFrames).toHaveLength(2);
  expect(splatRequest.posedFrames[1].camera.extrinsics.position).toEqual([
    1, 1.5, 0,
  ]);
  expect(splatRequest.posedFrames[0].camera.intrinsics.width).toBe(960);
  expect(splatRequest.posedFrames[0].depth.depthAsset).toBeDefined();
  expect(splatRequest.posedFrames[0].maskAsset).toBeUndefined();
  const workspace = store.snapshot();
  const [asset] = job.outputAssetIds.map(
    (assetId) => workspace.assets[assetId],
  );
  expect(asset.kind).toBe("splat");
  const nodes = Object.values(workspace.nodes).filter(
    (node) => node.kind === "splat",
  );
  expect(nodes.map((node) => [node.assetId, node.parentId])).toEqual([
    [asset.id, null],
  ]);
  expect(workspace.selection).toEqual([]);
});

test("the newest image edit replaces intervening history choices and remains undoable", async () => {
  const { applyCommand } = await import("../../../core/commands");
  const { createCapture } = await import("../../../core/captures");
  const { applyNanoResult } = await import("./image-results");
  const { jobSchema } = await import("../../../core/schema");
  const store = await new WorkspaceStore(await directory()).init();
  cleanups.push(() => store.close());
  const source = await store.importFile(png(), "source.png");
  const output = await store.importFile(png("green"), "edit.png", {
    parentAssetId: source.id,
  });
  const job = jobSchema.parse({
    id: "edit-job",
    input: { kind: "nano", sourceAssetId: source.id, prompt: "Green" },
    status: "running",
    createdAt: 0,
    updatedAt: 0,
    message: "",
    outputAssetIds: [],
    applyTargets: [
      {
        nodeId: "capture",
        assetId: source.id,
        cameraId: "capture_camera",
        imageId: "capture_image",
        pointsId: "capture_points",
      },
    ],
    applyRoots: [source.id],
  });
  await store.update((state) => {
    applyCommand(state, {
      type: "nodes.put",
      nodes: createCapture(source, "capture"),
    });
    state.jobs[job.id] = job;
    claimResultTargets(state, job);
  });
  await store.update((state) =>
    applyCommand(state, { type: "image.activate", assetId: source.id }),
  );
  await applyNanoResult(store, job, output, new AbortController().signal);
  expect(store.snapshot().nodes.capture.assetId).toBe(output.id);
  await store.update((state) => applyCommand(state, { type: "history.undo" }));
  expect(store.snapshot().nodes.capture.assetId).toBe(source.id);
});

test("a pose result is saved without recreating a deleted destination child", async () => {
  const { jobSchema } = await import("../../../core/schema");
  const { saveFrame } = await import("./providers");
  const store = await new WorkspaceStore(await directory()).init();
  cleanups.push(() => store.close());
  const source = await store.importFile(png(), "source.png");
  await store.update((state) => {
    applyCommand(state, {
      type: "nodes.put",
      nodes: createCapture(source, "view"),
    });
    const job = jobSchema.parse({
      id: "pose-deleted",
      input: { kind: "pose", assetIds: [source.id], nodeIds: ["view"] },
      status: "running",
      createdAt: 0,
      updatedAt: 0,
      message: "",
      outputAssetIds: [],
      applyTargets: [resultTarget(state, "view")],
    });
    state.jobs[job.id] = job;
    claimResultTargets(state, job);
    applyCommand(state, { type: "nodes.remove", ids: ["view_points"] });
  });
  const state = store.snapshot();
  const asset = await saveFrame(
    store,
    await store.loadJob("pose-deleted"),
    {
      imageAsset: {
        base64: Buffer.from(await png().arrayBuffer()).toString("base64"),
      },
      camera: state.settings.viewportCamera,
    },
    0,
    new AbortController().signal,
  );
  expect(store.snapshot().assets[asset.id]).toBeDefined();
  expect(store.snapshot().jobs["pose-deleted"].applicationError).toContain(
    "missing points child",
  );
  expect(store.snapshot().nodes).toEqual(state.nodes);
});

test("video extraction samples a saved binary into ordered frame assets with provenance", async () => {
  const { encodeVideo, extractVideoFrames } = await import("./video");
  const store = await new WorkspaceStore(await directory()).init();
  cleanups.push(() => store.close());
  const images = [
    await store.importFile(png("red"), "r.png"),
    await store.importFile(png("blue"), "b.png"),
  ];
  const signal = new AbortController().signal;
  const video = await encodeVideo(store, images, 2, "source-video", signal);
  const frames = await extractVideoFrames(
    store,
    video.id,
    2,
    10,
    "extract",
    signal,
  );
  expect(frames.map((frame) => frame.frameIndex)).toEqual([0, 1]);
  expect(frames.map((frame) => frame.sourceVideoId)).toEqual([
    video.id,
    video.id,
  ]);
  expect(frames[1].frameTime).toBe(0.5);
});

async function generatedSceneFixture(
  includeDepth = true,
  hooks: {
    beforeFal?: () => Promise<void>;
    beforeAtlas?: () => Promise<void>;
    atlasCaption?: (seed: number) => string;
    beforePose?: () => Promise<void>;
  } = {},
) {
  const { createCapture } = await import("../../../core/captures");
  const { applyCommand } = await import("../../../core/commands");
  const previous = { wlt: process.env.WLT_API_KEY, fal: process.env.FAL_KEY };
  process.env.WLT_API_KEY = process.env.FAL_KEY = "test-key";
  cleanups.push(async () => {
    if (previous.wlt === undefined) delete process.env.WLT_API_KEY;
    else process.env.WLT_API_KEY = previous.wlt;
    if (previous.fal === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = previous.fal;
  });
  const store = await new WorkspaceStore(await directory()).init();
  cleanups.push(() => store.close());
  const camera = emptyWorkspace().settings.viewportCamera;
  camera.extrinsics = {
    position: [0, 1.5, 0],
    quaternion: [0, 0, 0, 1],
    coordinateSystem: "rub",
  };
  camera.intrinsics = { fx: 20, fy: 20, cx: 10, cy: 10, width: 20, height: 20 };
  const depth = await store.importFile(await depthExr(), "source-depth.exr", {
    kind: "depth",
  });
  const image = await store.importFile(png(), "source.png", {
    camera,
    depthAssetId: depth.id,
    depthEncoding: { type: "linear" },
  });
  await store.update((state) =>
    applyCommand(state, {
      type: "nodes.put",
      nodes: createCapture(image, "source-capture"),
    }),
  );
  const requests: any[] = [];
  const falRequests: any[] = [];
  let uploads = 0,
    poses = 0;
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
            input instanceof Request ? input : new Request(input, init),
          url = request.url;
        if (url.endsWith("/assets") && request.method === "POST")
          return Response.json({ id: `upload-${++uploads}` });
        if (url.includes(":createUploadUrl"))
          return Response.json({
            uploadUrl: "https://fixture.example/upload",
            method: "PUT",
          });
        if (url.includes(":completeUpload"))
          return Response.json({ id: `upload-${uploads}` });
        if (url.endsWith("/upload")) return new Response("");
        if (url.includes("atlasGenerate")) {
          const body = (await request.json()) as any;
          requests.push(body);
          await hooks.beforeAtlas?.();
          return Response.json({
            id: `atlas-${requests.length}`,
            done: true,
            response: {
              promptUsed:
                hooks.atlasCaption?.(body.modelParameters.seed) ??
                "Enhanced scene description",
              frames: body.targetCameras.map((camera: any) => ({
                camera,
                imageAsset: { url: "https://fixture.example/frame.png" },
                ...(body.returnDepth && includeDepth
                  ? {
                      depth: {
                        depthAsset: {
                          url: "https://fixture.example/depth.exr",
                        },
                      },
                    }
                  : {}),
              })),
            },
          });
        }
        if (url.includes("images2PosedRGBD")) {
          const body = (await request.json()) as any;
          poses++;
          await hooks.beforePose?.();
          return Response.json({
            id: `pose-${poses}`,
            done: true,
            response: {
              frames: body.frames.map((_: any, i: number) => ({
                camera: {
                  ...camera,
                  extrinsics: { ...camera.extrinsics, position: [i, 1.5, 0] },
                },
                imageAsset: { url: "https://fixture.example/frame.png" },
                depth: {
                  depthAsset: { url: "https://fixture.example/depth.exr" },
                },
                centroidWorld: [0, 0, 0],
              })),
            },
          });
        }
        if (url.includes("/storage/upload/initiate"))
          return Response.json({
            upload_url: "https://fixture.example/upload",
            file_url: "https://fixture.example/input.png",
          });
        if (url.includes("queue.fal.run") && request.method === "POST") {
          falRequests.push({ model: url, input: await request.json() });
          await hooks.beforeFal?.();
          return Response.json({ request_id: "fal-saved" });
        }
        if (url.includes("/status?"))
          return Response.json({ status: "COMPLETED" });
        if (url.includes("/requests/fal-saved"))
          return Response.json({
            images: [{ url: "https://fixture.example/edited.png" }],
          });
        if (url.endsWith(".exr")) return new Response(await depthExr());
        if (url.endsWith(".png")) return new Response(png("green"));
        throw new Error(`Unexpected fixture request ${url}`);
      },
      { preconnect: () => {} },
    ),
  );
  cleanups.push(async () => network.mockRestore());
  const runner = new JobRunner(store);
  cleanups.push(() => runner.close());
  const { CommandService } = await import("./commands");
  return {
    store,
    runner,
    commands: new CommandService(store, runner),
    image,
    camera,
    requests,
    poseCount: () => poses,
    falRequests,
  };
}

test("a resumed Nano edit activates linked captures and reconstructs depth once without moving them", async () => {
  const { store, runner, image, poseCount } = await generatedSceneFixture();
  const { jobSchema } = await import("../../../core/schema");
  const { sceneCamera } = await import("../../../core/captures");
  const before = sceneCamera(store.snapshot(), "source-capture");
  await store.update((state) => {
    state.jobs.nano = jobSchema.parse({
      id: "nano",
      input: { kind: "nano", sourceAssetId: image.id, prompt: "Green" },
      status: "running",
      remoteId: "fal-saved",
      createdAt: 0,
      updatedAt: 0,
      message: "",
      outputAssetIds: [],
      applyTargets: [resultTarget(state, "source-capture")],
      applyRoots: [image.id],
      contextSnapshot: {
        assets: state.assets,
        nodes: state.nodes,
        settings: state.settings,
      },
    });
  });
  await store.update((state) => claimResultTargets(state, state.jobs.nano));
  await runner.init();
  const edited = await done(store, "nano");
  expect(edited.error).toBeUndefined();
  expect(edited.childJobId).toBe("nano-reconstruct");
  const reconstructed = await done(store, edited.childJobId!);
  expect(reconstructed.error).toBeUndefined();
  const state = store.snapshot();
  const active = state.assets[state.nodes["source-capture"].assetId!];
  expect(active.parentAssetId).toBe(edited.frameAssetIds![0]);
  expect(active.depthAssetId).toBeTruthy();
  expect(sceneCamera(state, "source-capture")).toEqual(before);
  expect(
    Object.values(state.nodes).filter((node) => node.kind === "capture"),
  ).toHaveLength(1);
  await runner.init();
  expect(poseCount()).toBe(1);
});

test("keyframe-to-dense video retains keyframes and frozen cameras, integrates sparse indices idempotently, and reconstructs frames", async () => {
  const { store, commands, camera, requests } = await generatedSceneFixture();
  const { applyCommand } = await import("../../../core/commands");
  const { identity } = await import("../../../core/schema");
  const end = {
    ...camera,
    extrinsics: {
      ...camera.extrinsics,
      position: [3, 1.5, 0] as [number, number, number],
    },
  };
  await store.update((state) =>
    applyCommand(state, {
      type: "nodes.put",
      nodes: [
        {
          id: "path",
          name: "Path",
          kind: "path",
          parentId: null,
          visible: true,
          transform: identity(),
          keyframes: [
            { id: "start", camera },
            { id: "end", camera: end },
          ],
        },
      ],
    }),
  );
  const first = await commands.execute({
    type: "generation.submit",
    request: {
      kind: "video",
      pathId: "path",
      fps: 2,
      targetFrameCount: 4,
      mode: "keyframes",
      keyframeCount: 2,
      seed: 73,
    },
  });
  const keyframes = await done(store, first.jobId!);
  expect(keyframes.error).toBeUndefined();
  expect(keyframes.frameIndices).toEqual([0, 3]);
  expect(requests[0].returnDepth).toBe(true);
  await commands.execute({
    type: "frames.view",
    jobId: keyframes.id,
    index: 3,
  });
  expect(store.snapshot().settings.viewportCamera.extrinsics.position).toEqual([
    3, 1.5, 0,
  ]);
  await commands.execute({
    type: "frames.integrate",
    jobId: keyframes.id,
    indices: [3],
  });
  const count = Object.keys(store.snapshot().nodes).length;
  await commands.execute({
    type: "frames.integrate",
    jobId: keyframes.id,
    indices: [3],
  });
  expect(Object.keys(store.snapshot().nodes)).toHaveLength(count);
  await commands.execute({
    type: "path.keyframe",
    pathId: "path",

    id: "end",
    camera: {
      ...end,
      extrinsics: { ...end.extrinsics, position: [50, 1.5, 0] },
    },
  });
  const original = store.snapshot().assets[keyframes.frameAssetIds![0]];
  const edited = await store.importFile(png("red"), "edited-keyframe.png", {
    ...original,
    id: undefined,
    path: undefined,
    parentAssetId: original.id,
    frameIndex: 0,
  });
  await commands.execute({ type: "image.activate", assetId: edited.id });
  const second = await commands.execute({
    type: "generation.submit",
    request: { kind: "video", sourceJobId: keyframes.id },
  });
  const dense = await done(store, second.jobId!);
  expect(dense.error).toBeUndefined();
  expect(dense.frameAssetIds).toHaveLength(4);
  expect(dense.frameAssetIds![0]).toBe(edited.id);
  expect(dense.frameAssetIds![3]).toBe(keyframes.frameAssetIds![1]);
  expect(
    requests[1].targetCameras.map((c: any) => c.extrinsics.position[0]),
  ).toEqual([1, 2]);
  expect(requests[1].contextFrames).toHaveLength(3);
  expect(requests[1].modelParameters.seed).toBe(73);
  await expect(
    commands.execute({
      type: "generation.submit",
      request: { kind: "reconstruct", jobId: dense.id, indices: [99] },
    }),
  ).rejects.toThrow("valid frame indices");
  const reconstruction = await commands.execute({
    type: "generation.submit",
    request: { kind: "reconstruct", jobId: dense.id },
  });
  const rebuilt = await done(store, reconstruction.jobId!);
  expect(rebuilt.error).toBeUndefined();
  expect(rebuilt.frameAssetIds).toHaveLength(4);
  expect(rebuilt.reconstructionScale).toBeCloseTo(1);
});

test("placing an unposed image requires a World Labs key before reserving a Frame", async () => {
  const oldKey = process.env.WLT_API_KEY;
  const oldConfig = process.env.XDG_CONFIG_HOME;
  process.env.WLT_API_KEY = "";
  process.env.XDG_CONFIG_HOME = await directory();
  cleanups.push(async () => {
    if (oldKey === undefined) delete process.env.WLT_API_KEY;
    else process.env.WLT_API_KEY = oldKey;
    if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = oldConfig;
  });
  const service = await createService(await directory());
  cleanups.push(() => service.close());
  const asset = await service.store.importFile(png(), "Illustration.png");
  const response = await service.handle(
    commandRequest({ type: "assets.place", assetIds: [asset.id] }),
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain(
    "https://atlas.worldlabs.ai/api-keys",
  );
  expect(service.store.current.nodes).toEqual({});
  expect(service.store.current.jobs).toEqual({});
  expect(service.store.current.assets[asset.id]).toBeDefined();
});

for (const mode of ["individual", "reconstruct"] as const) {
  test(`multi-image placement ${mode} batches requests correctly and preserves drop placement`, async () => {
    const { applyCommand } = await import("../../../core/commands");
    const { sceneCamera, createCapture } =
      await import("../../../core/captures");
    const oldKey = process.env.WLT_API_KEY;
    process.env.WLT_API_KEY = "test-key";
    cleanups.push(async () => {
      if (oldKey === undefined) delete process.env.WLT_API_KEY;
      else process.env.WLT_API_KEY = oldKey;
    });
    const service = await createService(await directory());
    cleanups.push(async () => {
      await service.jobs.close();
      await service.store.close();
    });
    const store = service.store;
    const solved = structuredClone(emptyWorkspace().settings.viewportCamera);
    solved.extrinsics.position = [2, 1.8, 4];
    solved.intrinsics = {
      fx: 20,
      fy: 20,
      cx: 10,
      cy: 10,
      width: 20,
      height: 20,
    };
    const images = await Promise.all(
      ["one.png", "two.png"].map((name) =>
        store.importFile(png(), name, { camera: solved }),
      ),
    );
    await store.update((state) =>
      applyCommand(state, {
        type: "nodes.put",
        nodes: [
          ...createCapture(images[0], "existing"),
          {
            id: "parent",
            name: "Parent",
            kind: "group",
            parentId: null,
            visible: true,
            transform: {
              position: [20, 0, 0],
              quaternion: [0, 0, 0, 1],
              scale: [1, 1, 1],
            },
          },
        ],
      }),
    );
    const requests: number[] = [];
    let uploads = 0;
    const network = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const request =
            input instanceof Request ? input : new Request(input, init);
          const url = request.url;
          if (url.endsWith("/assets") && request.method === "POST")
            return Response.json({ id: `upload-${++uploads}` });
          if (url.includes(":createUploadUrl"))
            return Response.json({
              uploadUrl: "https://fixture.example/upload",
              method: "PUT",
            });
          if (url.includes(":completeUpload"))
            return Response.json({ id: `upload-${uploads}` });
          if (url.endsWith("/upload")) return new Response("");
          if (url.includes("images2PosedRGBD")) {
            const body = await request.json();
            requests.push(body.frames.length);
            return Response.json({
              id: `operation-${requests.length}`,
              done: true,
              response: {
                frames: body.frames.map((_: unknown, i: number) => ({
                  imageAsset: { url: "https://fixture.example/frame.png" },
                  camera: {
                    ...solved,
                    extrinsics: {
                      ...solved.extrinsics,
                      position: [2 + i * 3, 1.8, 4],
                    },
                  },
                  depth: {
                    depthAsset: { url: "https://fixture.example/depth.exr" },
                  },
                  centroidWorld: [0, 0, 0],
                })),
              },
            });
          }
          if (url.endsWith(".png")) return new Response(png());
          if (url.endsWith(".exr")) return new Response(await depthExr());
          throw new Error(`Unexpected fixture request: ${url}`);
        },
        { preconnect: () => {} },
      ),
    );
    cleanups.push(async () => network.mockRestore());
    const camera = structuredClone(solved);
    camera.extrinsics = {
      position: [10, 9, -6],
      quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
      coordinateSystem: "rub",
    };
    const response = await service.handle(
      commandRequest({
        type: "assets.place",
        assetIds: images.map((asset) => asset.id),
        camera,
        mode,
        parentId: "parent",
      }),
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.jobIds).toHaveLength(mode === "reconstruct" ? 1 : 2);
    for (const id of result.jobIds)
      expect((await done(store, id)).error).toBeUndefined();
    expect(requests).toEqual(mode === "reconstruct" ? [2] : [1, 1]);
    const state = store.snapshot();
    const captures = Object.values(state.nodes).filter(
      (node) => node.kind === "capture" && node.id !== "existing",
    );
    expect(captures).toHaveLength(2);
    expect(state.nodes.existing.assetId).toBe(images[0].id);
    for (const node of captures) {
      expect(node.parentId).toBe("parent");
      const position = sceneCamera(state, node.id)!.extrinsics.position;
      expect(position[0]).toBeCloseTo(10);
      expect(position[1]).toBeCloseTo(1.8);
    }
    const z = captures
      .map((node) => sceneCamera(state, node.id)!.extrinsics.position[2])
      .sort((a, b) => a - b);
    expect(z[0]).toBeCloseTo(mode === "reconstruct" ? -9 : -6);
    expect(z[1]).toBeCloseTo(-6);
  });
}

for (const includeDepth of [true, false]) {
  test(`current-view command integrates ${includeDepth ? "RGBD" : "camera-only"} output once and selects its output history`, async () => {
    const { store, commands, camera } =
      await generatedSceneFixture(includeDepth);
    const target = structuredClone(camera);
    target.extrinsics.position = [2, 1.5, 0];
    const result = await commands.execute(
      {
        type: "generation.submit",
        request: { kind: "view", camera: target },
      },
      { interactive: true },
    );
    expect(store.snapshot().settings.atlasPanel.jobId).toBe(result.jobId!);
    const job = await done(store, result.jobId!);
    expect(job.error).toBeUndefined();
    const output = store.snapshot().assets[job.outputAssetIds[0]];
    expect(Boolean(output.depthAssetId)).toBe(includeDepth);
    const nodes = () =>
      Object.values(store.snapshot().nodes).filter(
        (node) => node.kind === "capture" && node.assetId === output.id,
      );
    expect(nodes()).toHaveLength(1);
    const { sceneCamera } = await import("../../../core/captures");
    expect(
      sceneCamera(store.snapshot(), nodes()[0].id)!.extrinsics.position,
    ).toEqual([2, 1.5, 0]);
    await commands.execute({ type: "frames.integrate", jobId: job.id });
    expect(nodes()).toHaveLength(1);
    await commands.execute({ type: "history.undo" });
    expect(nodes()).toHaveLength(0);
    await commands.execute({ type: "history.redo" });
    expect(nodes()).toHaveLength(1);
  });
}

for (const kind of ["nano", "reconstruct"] as const)
  for (const healthySibling of [false, true])
    test(`${kind} saves outputs with a broken destination before submission${healthySibling ? " and updates its healthy sibling" : " without recreating it"}`, async () => {
      const { store, runner, image } = await generatedSceneFixture();
      await store.update((state) => {
        if (healthySibling)
          applyCommand(state, {
            type: "nodes.put",
            nodes: createCapture(image, "sibling"),
          });
        applyCommand(state, {
          type: "nodes.remove",
          ids: ["source-capture_points"],
        });
      });
      const id = await runner.submit(
        kind === "nano"
          ? {
              kind,
              sourceAssetId: image.id,
              prompt: "Green",
              applyToScene: true,
              reconstruct: true,
            }
          : { kind, assetIds: [image.id], integrate: true },
      );
      const job = await done(store, id);
      expect(job.status).toBe("succeeded");
      expect(job.outputAssetIds.length).toBeGreaterThan(0);
      if (kind === "nano") expect(job.appliedTargets).toEqual([]);
      const final = kind === "nano" ? await done(store, job.childJobId!) : job;
      expect(final.appliedTargets).toEqual(healthySibling ? ["sibling"] : []);
      expect(final.status).toBe("succeeded");
      expect(final.applicationError).toContain("missing points child");
      const state = store.snapshot();
      const output = final.frameAssetIds![0];
      expect(state.assets[output].depthAssetId).toBeTruthy();
      expect(state.imageVersions[image.id]).toBe(output);
      expect(state.nodes["source-capture_points"]).toBeUndefined();
      expect(state.nodes["source-capture_image"].assetId).toBe(image.id);
      expect(
        Object.values(state.nodes).filter((node) => node.kind === "capture"),
      ).toHaveLength(healthySibling ? 2 : 1);
      if (healthySibling)
        expect(state.nodes.sibling_points.assetId).toBe(output);
    });

test("create image reserves a Frame immediately and reuses posing with yaw, grounding, and edited parents", async () => {
  const gate = Promise.withResolvers<void>();
  const { store, commands, camera, falRequests, poseCount } =
    await generatedSceneFixture(true, { beforeFal: () => gate.promise });
  cleanups.push(async () => gate.resolve());
  const placement = structuredClone(camera);
  placement.extrinsics.position = [6, 9, -4];
  placement.extrinsics.quaternion = [0, Math.sin(0.45), 0, Math.cos(0.45)];
  const { jobId } = await commands.execute(
    {
      type: "generation.submit",
      request: {
        kind: "image.create",
        prompt: "An abandoned lab",
        placement,
        seed: 17,
      },
    },
    { interactive: true },
  );
  let state = store.snapshot();
  const input = state.jobs[jobId!].input;
  if (input.kind !== "image") throw new Error("Expected image job");
  const rootId = input.nodeIds![0];
  expect(state.nodes[rootId].transform.position).toEqual([6, 0, -4]);
  expect(state.nodes[rootId].transform.quaternion[1]).toBeCloseTo(
    Math.sin(0.45),
  );
  expect(state.nodes[`${rootId}_camera`].projection).toBeDefined();
  expect(state.nodes[`${rootId}_image`].assetId).toBeUndefined();
  expect(state.selection).toEqual([rootId]);
  expect(selectedImageOperation(state)).toMatchObject({
    pending: true,
    assetId: null,
    id: rootId,
  });
  await commands.execute({
    type: "nodes.put",
    nodes: [
      {
        id: "container",
        name: "Container",
        kind: "group",
        parentId: null,
        visible: true,
        transform: {
          position: [3, 2, 1],
          quaternion: [0, Math.sin(0.2), 0, Math.cos(0.2)],
          scale: [2, 2, 2],
        },
      },
    ],
  });
  await commands.execute({
    type: "nodes.move",
    ids: [rootId],
    parentId: "container",
  });
  const moved = store.snapshot().nodes[rootId].transform;
  gate.resolve();
  const imageJob = await done(store, jobId!);
  expect(imageJob.status).toBe("succeeded");
  expect(imageJob.childJobId).toBeDefined();
  const posed = await done(store, imageJob.childJobId!);
  expect(posed.status).toBe("succeeded");
  expect(posed.applicationError).toBeUndefined();
  state = store.snapshot();
  expect(selectedImageOperation(state)).toMatchObject({
    pending: false,
    assetId: state.nodes[`${rootId}_image`].assetId,
  });
  expect(state.nodes[rootId].parentId).toBe("container");
  expect(state.nodes[rootId].transform).toEqual(moved);
  expect(state.nodes[`${rootId}_camera`].transform.position[1]).toBe(1.5);
  expect(state.nodes[`${rootId}_points`].assetId).toBe(
    state.nodes[`${rootId}_image`].assetId,
  );
  const { captureFrame } = await import("../../../core/captures");
  expect(captureFrame(state, rootId).camera.extrinsics.position[0]).toBeCloseTo(
    6,
  );
  expect(captureFrame(state, rootId).camera.extrinsics.position[1]).toBeCloseTo(
    1.5,
  );
  expect(falRequests).toHaveLength(1);
  expect(falRequests[0].model).toContain("fal-ai/flux/schnell");
  expect(falRequests[0].input.prompt).toBe("An abandoned lab");
  expect(falRequests[0].input.seed).toBe(17);
  expect(poseCount()).toBe(1);
  expect(
    Object.values(state.nodes).filter((n) => n.kind === "capture"),
  ).toHaveLength(2);
});

for (const action of ["delete", "undo", "replace"] as const) {
  test(`image creation respects placeholder ${action}`, async () => {
    const gate = Promise.withResolvers<void>();
    const { store, commands, poseCount } = await generatedSceneFixture(true, {
      beforeFal: () => gate.promise,
    });
    cleanups.push(async () => gate.resolve());
    const { jobId } = await commands.execute({
      type: "generation.submit",
      request: { kind: "image.create", prompt: "Room" },
    });
    const state = store.snapshot(),
      input = state.jobs[jobId!].input;
    if (input.kind !== "image") throw new Error("Expected image job");
    const id = input.nodeIds![0];
    if (action === "undo") await commands.execute({ type: "history.undo" });
    else if (action === "delete")
      await commands.execute({ type: "nodes.remove", ids: [id] });
    else {
      await commands.execute({ type: "nodes.remove", ids: [`${id}_camera`] });
      await commands.execute({
        type: "nodes.put",
        nodes: [
          { ...state.nodes[`${id}_camera`], id: "replacement-camera" },
          {
            ...state.nodes[`${id}_image`],
            id: "replacement-image",
            parentId: "replacement-camera",
          },
        ],
      });
    }
    gate.resolve();
    const job = await done(store, jobId!);
    expect(job.status).toBe("succeeded");
    expect(job.applicationError).toBeDefined();
    expect(job.childJobId).toBeUndefined();
    expect(job.outputAssetIds.length).toBeGreaterThan(0);
    expect(poseCount()).toBe(0);
    expect(store.snapshot().nodes[`${id}_camera`]).toBeUndefined();
  });
}

test("Atlas queues two variants of one frozen shot and keeps only the editor's choice", async () => {
  const gate = Promise.withResolvers<void>();
  const { store, runner, commands, camera, requests } =
    await generatedSceneFixture(true, {
      beforeAtlas: () => gate.promise,
      atlasCaption: (seed) => `Enhanced description for ${seed}`,
    });
  cleanups.push(async () => gate.resolve());
  const { atlasReview } = await import("../../../core/atlas-review");
  const { atlasContext } = await import("../../../core/captures");
  const before = Object.keys(store.current.nodes);
  camera.extrinsics.position = [2, 1.5, 0];
  const caption = "Look into the flooded pump room";
  const request = {
    type: "generation.submit",
    request: { kind: "view.pair", camera, prompt: caption, seed: 270 },
  } as const;
  const first = await commands.execute(request, { requestId: "pair" });
  const ids = first.jobIds!;
  expect(ids).toHaveLength(2);
  expect(
    (await commands.execute(request, { requestId: "pair" })).jobIds,
  ).toEqual(ids);
  expect(atlasReview(store.current)?.phase).toBe("generating");
  await expect(commands.execute(request)).rejects.toThrow(
    "open Atlas comparison",
  );
  await expect(
    commands.execute(
      {
        type: "atlas.review",
        id: ids[0],
        decision: { kind: "keep", jobId: ids[1] },
      },
      { interactive: true },
    ),
  ).rejects.toThrow("Wait for two");
  gate.resolve();
  const jobs = await Promise.all(ids.map((id) => done(store, id)));
  expect(jobs.map((job) => job.status)).toEqual(["succeeded", "succeeded"]);
  expect(requests).toHaveLength(2);
  expect(requests.map((r) => r.modelParameters.seed).sort()).toEqual([
    270, 271,
  ]);
  expect(requests.map((r) => r.prompt)).toEqual([caption, caption]);
  expect(requests.map((r) => r.enhancePrompt)).toEqual([true, true]);
  expect(store.current.settings.enhancedCaption).toBeUndefined();
  expect(requests[0].targetCameras).toEqual(requests[1].targetCameras);
  expect(requests[0].targetCameras[0].extrinsics.position).toEqual([2, 1.5, 0]);
  expect(jobs[0].contextSnapshot).toEqual(jobs[1].contextSnapshot);
  expect(Object.keys(store.current.nodes)).toEqual(before);
  expect(atlasReview(store.current)?.phase).toBe("review");
  await expect(
    commands.execute({ type: "frames.integrate", jobId: ids[0] }),
  ).rejects.toThrow("comparison");
  await expect(
    commands.execute({
      type: "assets.place",
      assetIds: [jobs[0].frameAssetIds![0]],
    }),
  ).rejects.toThrow("comparison");
  const choice = {
    type: "atlas.review",
    id: ids[0],
    decision: { kind: "keep", jobId: ids[1] },
  } as const;
  await expect(commands.execute(choice)).rejects.toThrow("in the editor");
  const kept = await commands.execute(choice, { interactive: true });
  expect(store.current.settings.enhancedCaption).toEqual({
    prompt: caption,
    text: "Enhanced description for 271",
  });

  const winner = kept.nodeIds![0];
  expect(store.current.nodes[winner].assetId).toBe(jobs[1].frameAssetIds![0]);
  expect(
    Object.values(store.current.nodes).some(
      (n) => n.assetId === jobs[0].frameAssetIds![0],
    ),
  ).toBe(false);
  expect(atlasContext(store.current).map(({ node }) => node.id)).toContain(
    winner,
  );
  await expect(commands.execute(choice, { interactive: true })).rejects.toThrow(
    "no longer open",
  );

  await commands.execute({ type: "history.undo" });
  expect(store.current.nodes[winner]).toBeUndefined();
  expect(atlasReview(store.current)?.phase).toBe("keep");
  await commands.execute({ type: "history.redo" });
  expect(store.current.nodes[winner]).toBeDefined();

  const nextCamera = structuredClone(camera);
  nextCamera.extrinsics.position = [4, 1.5, 0];
  const next = await commands.execute({
    type: "generation.submit",
    request: {
      kind: "view.pair",
      camera: nextCamera,
    },
  });
  const nextJobs = await Promise.all(next.jobIds!.map((id) => done(store, id)));
  expect(requests.slice(2).map((r) => r.prompt)).toEqual([
    "Enhanced description for 271",
    "Enhanced description for 271",
  ]);
  expect(requests.slice(2).map((r) => r.enhancePrompt)).toEqual([false, false]);
  expect(
    requests.slice(2).map((r) => r.targetCameras[0].extrinsics.position),
  ).toEqual([
    [4, 1.5, 0],
    [4, 1.5, 0],
  ]);

  expect(
    nextJobs.every(
      (job) => job.input.kind === "atlas" && job.input.nodeIds.includes(winner),
    ),
  ).toBe(true);
  await runner.close();
  await store.close();
  const reopened = await new WorkspaceStore(store.root).init();
  cleanups.push(() => reopened.close());
  expect(atlasReview(reopened.current)?.phase).toBe("review");
  expect(atlasReview(reopened.current)?.id).toBe(next.jobId);
  expect(atlasContext(reopened.current).map(({ node }) => node.id)).toEqual([
    "source-capture",
    winner,
  ]);
});

test("camera-only Atlas requests use the current description before enhancement and discard on missing depth", async () => {
  const { store, commands, camera, requests } =
    await generatedSceneFixture(false);
  await commands.execute({
    type: "workspace.update",
    settings: { prompt: "Service tunnel" },
  });
  const before = Object.keys(store.current.nodes);
  camera.extrinsics.position[0] = 2;
  const { jobId, jobIds } = await commands.execute({
    type: "generation.submit",
    request: { kind: "view.pair", camera },
  });
  for (const id of jobIds!)
    expect((await done(store, id)).error).toContain("without posed depth");
  expect(requests.map((r) => r.prompt)).toEqual([
    "Service tunnel",
    "Service tunnel",
  ]);
  expect(requests.map((r) => r.enhancePrompt)).toEqual([false, false]);
  const { atlasReview } = await import("../../../core/atlas-review");
  expect(atlasReview(store.current)?.phase).toBe("failed");
  await commands.execute(
    { type: "atlas.review", id: jobId!, decision: { kind: "discard" } },
    { interactive: true },
  );
  expect(atlasReview(store.current)?.phase).toBe("discard");
  expect(Object.keys(store.current.nodes)).toEqual(before);
});

test("enhanced captions are cached, reused, cleared, and invalidated by prompt edits", async () => {
  const { store, commands, camera, requests } = await generatedSceneFixture();
  camera.extrinsics.position[0] = 1;
  await commands.execute({
    type: "workspace.update",
    settings: { prompt: "Quiet laboratory" },
  });
  const render = async () => {
    const { jobId } = await commands.execute({
      type: "generation.submit",
      request: { kind: "view", nodeIds: ["source-capture"], camera },
    });
    expect((await done(store, jobId!)).status).toBe("succeeded");
  };
  await render();
  expect(requests[0].enhancePrompt).toBe(true);
  expect(store.snapshot().settings.enhancedCaption).toEqual({
    prompt: "Quiet laboratory",
    text: "Enhanced scene description",
  });
  await render();
  expect(requests[1].prompt).toBe("Enhanced scene description");
  expect(requests[1].enhancePrompt).toBe(false);
  await commands.execute({ type: "caption.clear" });
  expect(store.snapshot().settings.enhancedCaption).toBeNull();
  await render();
  expect(requests[2].prompt).toBe("Quiet laboratory");
  expect(requests[2].enhancePrompt).toBe(true);
  await commands.execute({
    type: "workspace.update",
    settings: { prompt: "Sunlit kitchen" },
  });
  expect(store.snapshot().settings.enhancedCaption).toBeNull();
});

test("clearing a caption during generation prevents the old response from restoring it", async () => {
  const gate = Promise.withResolvers<void>();
  const { store, commands, camera } = await generatedSceneFixture(true, {
    beforeAtlas: () => gate.promise,
  });
  cleanups.push(async () => gate.resolve());
  camera.extrinsics.position[0] = 1;
  const { jobId } = await commands.execute({
    type: "generation.submit",
    request: { kind: "view", nodeIds: ["source-capture"], camera },
  });
  await commands.execute({ type: "caption.clear" });
  gate.resolve();
  expect((await done(store, jobId!)).status).toBe("succeeded");
  expect(store.snapshot().settings.enhancedCaption).toBeNull();
});

test("resuming image creation keeps its placeholder and remote request, then poses exactly once", async () => {
  const { store, runner, camera, falRequests, poseCount } =
    await generatedSceneFixture();
  const { jobSchema } = await import("../../../core/schema");
  await store.update((state) => {
    applyCommand(state, {
      type: "nodes.put",
      nodes: createCapture(
        { name: "Pending image" },
        "pending",
        camera,
        "resume-image",
      ),
    });
    state.jobs["resume-image"] = jobSchema.parse({
      id: "resume-image",
      input: {
        kind: "image",
        prompt: "Lab",
        model: "fal-ai/flux/schnell",
        placement: camera,
        nodeIds: ["pending"],
      },
      status: "running",
      createdAt: 1,
      updatedAt: 1,
      message: "Interrupted",
      outputAssetIds: [],
      submittedAt: 1,
      remoteId: "fal-saved",
      request: { prompt: "Lab" },
      applyTargets: [resultTarget(state, "pending")],
    });
    claimResultTargets(state, state.jobs["resume-image"]);
  });
  await runner.init();
  const job = await done(store, "resume-image");
  expect(job.status).toBe("succeeded");
  const child = await done(store, job.childJobId!);
  expect(child.status).toBe("succeeded");
  expect(child.resultOwnerId).toBe(job.id);
  expect(falRequests).toHaveLength(0);
  expect(poseCount()).toBe(1);
  expect(
    Object.values(store.snapshot().nodes)
      .filter((n) => n.jobId === job.id && n.kind === "capture")
      .map((n) => n.id),
  ).toEqual(["pending"]);
});

test("cancelling automatic posing keeps the generated image without applying late depth", async () => {
  const gate = Promise.withResolvers<void>(),
    entered = Promise.withResolvers<void>();
  const { store, commands, runner } = await generatedSceneFixture(true, {
    beforePose: async () => {
      entered.resolve();
      await gate.promise;
    },
  });
  cleanups.push(async () => gate.resolve());
  const { jobId } = await commands.execute({
    type: "generation.submit",
    request: { kind: "image.create", prompt: "Laboratory" },
  });
  const parent = await done(store, jobId!);
  await entered.promise;
  await runner.cancel(parent.childJobId!);
  gate.resolve();
  await runner.close();
  const state = store.snapshot();
  expect(state.jobs[parent.childJobId!].status).toBe("cancelled");
  const target = parent.applyTargets![0];
  expect(state.nodes[target.nodeId].geometryAssetId).toBeUndefined();
  expect(state.nodes[target.nodeId].assetId).toBeDefined();
  expect(
    parent.outputAssetIds.some((id) => state.assets[id].kind === "image"),
  ).toBe(true);
});

test("contact sheets run headlessly from frozen image bindings without changing scene nodes", async () => {
  const store = await new WorkspaceStore(await directory()).init();
  cleanups.push(() => store.close());
  const runner = new JobRunner(store);
  cleanups.push(() => runner.close());
  const red = await store.importFile(png("red"), "red.png");
  const blue = await store.importFile(png("blue"), "blue.png");
  await store.update((state) => {
    applyCommand(state, {
      type: "nodes.put",
      nodes: createCapture(red, "frame"),
    });
    state.nodes.frame_image.assetId = blue.id;
  });
  const before = store.snapshot().nodes;
  const jobId = await runner.submit({
    kind: "contactSheet",
    width: 320,
    columns: 2,
  });
  const job = await done(store, jobId);
  expect(job.status).toBe("succeeded");
  expect(job.previewItems![0].assetId).toBe(blue.id);
  expect(store.snapshot().nodes).toEqual(before);
  const { file } = await store.assetFile(job.outputAssetIds[0]);
  const image = await loadImage(file);
  expect(image.width).toBe(320);
  expect(image.height).toBe(224);
  const canvas = createCanvas(image.width, image.height),
    ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  expect(Array.from(ctx.getImageData(160, 90, 1, 1).data)).toEqual([
    0, 0, 255, 255,
  ]);
  const manifest = await store.assetFile(job.outputAssetIds[1]);
  expect((await Bun.file(manifest.file).json()).items[0].nodeId).toBe("frame");
  await expect(
    runner.submit({ kind: "contactSheet", assetIds: ["missing"] }),
  ).rejects.toThrow("unavailable");
});

test("inspection uses the viewport job lease and stores a validated report; headless reads need no job", async () => {
  const service = await createService(await directory());
  cleanups.push(() => service.close());
  const { inspectScene } = await import("../../../core/inspection");
  const metadata = await service.handle(
    new Request("http://127.0.0.1:4310/api/scene/inspect"),
  );
  expect((await metadata.json()).source).toBe("headless");
  expect(Object.keys(service.store.snapshot().jobs)).toHaveLength(0);
  const jobId = await service.jobs.submit({ kind: "inspect" });
  const post = (suffix: string, body?: BodyInit) =>
    service.handle(
      new Request(`http://127.0.0.1:4310/api/viewport-jobs/${jobId}${suffix}`, {
        method: "POST",
        headers: { "X-Image-To-World-Client": "test" },
        body,
      }),
    );
  expect((await (await post("/claim")).json()).claimed).toBe(true);
  expect((await (await post("/claim")).json()).claimed).toBe(false);
  const report = inspectScene(
    service.store.snapshot(),
    undefined,
    () => undefined,
  );
  const form = new FormData();
  form.append(
    "files",
    new File([JSON.stringify(report)], "inspection.json", {
      type: "application/json",
    }),
  );
  const response = await post("", form);
  if (!response.ok) throw new Error(await response.text());
  expect(response.status).toBe(200);
  const job = service.store.snapshot().jobs[jobId];
  expect(job.status).toBe("succeeded");
  const { file } = await service.store.assetFile(job.outputAssetIds[0]);
  expect(await Bun.file(file).json()).toEqual(report);
});

test("already posed imports and Atlas view integration create no automatic clips", async () => {
  const { store, commands, camera, image } = await generatedSceneFixture();
  await commands.execute({
    type: "assets.place",
    assetIds: [image.id],
    camera,
  });
  camera.extrinsics.position[0] = 1;
  const { jobId } = await commands.execute({
    type: "generation.submit",
    request: { kind: "view", nodeIds: ["source-capture"], camera },
  });
  expect((await done(store, jobId!)).status).toBe("succeeded");
  expect(
    Object.values(store.snapshot().nodes).filter(
      (node) => node.kind === "capture",
    ),
  ).toHaveLength(3);
  expect(
    Object.values(store.snapshot().nodes).some((node) => node.kind === "clip"),
  ).toBe(false);
});

test("footer activity reports CLI commands without persisting an extra scene edit", async () => {
  const service = await createService(await directory());
  cleanups.push(() => service.close());
  const events: { event: string; data: unknown }[] = [];
  const unsubscribe = service.store.subscribe((event, data) =>
    events.push({ event, data }),
  );
  const beforeRevision = service.store.snapshot().revision;
  try {
    const response = await service.handle(
      commandRequest({ type: "camera.place" }),
    );
    expect(response.status).toBe(200);
    expect(service.store.lastOperation?.name).toBe("Place camera");
    expect(
      events.find((item) => item.event === "operation")?.data,
    ).toMatchObject({ name: "Place camera" });
    expect(service.store.snapshot().undo).toHaveLength(1);
    expect(service.store.snapshot().revision).toBe(beforeRevision + 1);
  } finally {
    unsubscribe();
  }
});
