import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { identity, type Camera } from "../../../core/schema";
import { createCapture, captureFrame } from "../../../core/captures";
import { applyCommand } from "../../../core/commands";
import { linearDepth } from "../../../core/depth";
import { WorkspaceStore } from "./store";
import { JobRunner } from "./jobs";
import { CommandService } from "./commands";
import { rendererExecutable } from "./render-worker";
import { encodeDepth } from "./depth";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "image-to-world-agent-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const store = await new WorkspaceStore(root).init();
  const runner = new JobRunner(store);
  cleanup.push(async () => {
    await runner.close();
    await store.close();
  });
  return { store, runner, commands: new CommandService(store, runner) };
}
async function done(store: WorkspaceStore, id: string) {
  for (let i = 0; i < 1200; i++) {
    const job = store.snapshot().jobs[id];
    if (["failed", "succeeded", "cancelled"].includes(job.status)) return job;
    await Bun.sleep(100);
  }
  throw new Error(`Job timed out: ${id}`);
}
const node = (id: string) => ({
  id,
  name: id,
  kind: "group" as const,
  parentId: null,
  visible: true,
  transform: identity(),
});
const camera: Camera = {
  extrinsics: {
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    coordinateSystem: "rub",
  },
  intrinsics: { width: 64, height: 64, fx: 50, fy: 50, cx: 32, cy: 32 },
};
function triangle() {
  const positions = new Float32Array([
    -0.5, -0.5, -2, 0.5, -0.5, -2, 0, 0.5, -2,
  ]);
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [1, 0.4, 0.1, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
        doubleSided: true,
      },
    ],
    buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [-0.5, -0.5, -2],
        max: [0.5, 0.5, -2],
      },
    ],
  };
  const text = JSON.stringify(json),
    padded = text + " ".repeat((4 - (text.length % 4)) % 4),
    bytes = Buffer.alloc(12 + 8 + padded.length + 8 + positions.byteLength);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(padded.length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  bytes.write(padded, 20);
  const at = 20 + padded.length;
  bytes.writeUInt32LE(positions.byteLength, at);
  bytes.writeUInt32LE(0x004e4942, at + 4);
  Buffer.from(positions.buffer).copy(bytes, at + 8);
  return new Blob([bytes], { type: "model/gltf-binary" });
}
test("agents merge disjoint field patches, reject stale guards, replay receipts, and revert only their edit", async () => {
  const { store, commands } = await fixture();
  await commands.execute({ type: "nodes.put", nodes: [node("a"), node("b")] });
  await commands.execute({ type: "selection.set", ids: ["b"] });
  const expected = store.snapshot().nodes.a.transform;
  const [a, b] = await Promise.all([
    commands.execute(
      {
        type: "nodes.transform",
        ids: ["a"],
        transform: { position: [1, 2, 3] },
      },
      {
        actorId: "A",
        requestId: "move-a",
        preconditions: [
          { collection: "nodes", id: "a", field: "transform", expected },
        ],
      },
    ),
    commands.execute(
      { type: "nodes.patch", id: "a", patch: { name: "Renamed" } },
      { actorId: "B", requestId: "name-a" },
    ),
  ]);
  expect(store.snapshot().nodes.a.name).toBe("Renamed");
  expect(store.snapshot().nodes.a.transform.position).toEqual([1, 2, 3]);
  expect(store.snapshot().selection).toEqual(["b"]);
  expect(
    await commands.execute(
      { type: "nodes.patch", id: "a", patch: { name: "Renamed" } },
      { actorId: "B", requestId: "name-a" },
    ),
  ).toEqual(b);
  await expect(
    commands.execute(
      {
        type: "nodes.transform",
        ids: ["a"],
        transform: { position: [4, 5, 6] },
      },
      {
        preconditions: [
          { collection: "nodes", id: "a", field: "transform", expected },
        ],
      },
    ),
  ).rejects.toThrow("conflict");
  await commands.execute({ type: "history.revert", editId: a.editId! });
  expect(store.snapshot().nodes.a.name).toBe("Renamed");
  expect(store.snapshot().nodes.a.transform.position).toEqual([0, 0, 0]);
  await expect(
    commands.execute({ type: "history.revert", editId: a.editId! }),
  ).rejects.toThrow();
  expect(
    store
      .activitySnapshot()
      .events.some((e) => e.actorId === "A" && e.phase === "succeeded"),
  ).toBe(true);
});
test("queued inputs retain their bytes when the library file changes", async () => {
  const { store, runner } = await fixture();
  const asset = await store.importFile(new Blob(["first"]), "source.txt");
  // Viewport jobs remain queued, making the snapshot race deterministic without an external provider.
  const id = await runner.submit({ kind: "capture", camera });
  const job = store.snapshot().jobs[id];
  const pins = await store.pinAssets(store.snapshot(), { assetId: asset.id });
  job.pinnedAssets = pins;
  job.contextSnapshot!.assets[asset.id] = asset;
  await Bun.write((await store.assetFile(asset.id)).file, "second");
  const value = await store.withJobAssets(job, async () =>
    Bun.file((await store.assetFile(asset.id)).file).text(),
  );
  expect(value).toBe("first");
  await runner.cancel(id);
  expect(
    store
      .activitySnapshot()
      .events.filter((e) => e.jobId === id && e.detail === "summary")
      .map((e) => e.phase),
  ).toEqual(["queued", "cancelled"]);
});
test("observations use active geometry, parent scale and top-left masks; edited depth stays ineligible", async () => {
  const { store, runner } = await fixture();
  const depth = await store.importFile(
    await encodeDepth({
      width: 64,
      height: 64,
      stride: 1,
      data: new Float32Array(4096).fill(2),
    }),
    "depth.exr",
  );
  const canvas = createCanvas(64, 64);
  canvas.getContext("2d").fillRect(0, 0, 64, 64);
  const image = await store.importFile(
    new Blob([new Uint8Array(canvas.toBuffer("image/png"))]),
    "image.png",
    { camera, depthAssetId: depth.id },
  );
  await store.update((w) => {
    applyCommand(w, {
      type: "nodes.put",
      nodes: [
        {
          ...node("parent"),
          transform: { ...identity(), position: [3, 0, 0], scale: [2, 2, 2] },
        },
        ...createCapture(image, "capture").map((n) =>
          n.id === "capture" ? { ...n, parentId: "parent" } : n,
        ),
      ],
    });
  });
  const id = await runner.submit({
    kind: "observe",
    nodeId: "capture",
    region: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    padding: 0.1,
  });
  const job = await done(store, id);
  expect(job.error).toBeUndefined();
  expect(job.status).toBe("succeeded");
  const manifest = store.snapshot().assets[job.outputAssetIds.at(-1)!];
  const data = await Bun.file((await store.assetFile(manifest.id)).file).json();
  expect(data.depth.median).toBe(4);
  expect(data.worldCenter[0]).toBeCloseTo(3);
  expect(data.worldCenter[2]).toBeCloseTo(-4);
  const mask = await loadImage(
    (await store.assetFile(data.unchangedMaskAssetId)).file,
  );
  const c = createCanvas(64, 64),
    ctx = c.getContext("2d");
  ctx.drawImage(mask, 0, 0);
  expect(ctx.getImageData(32, 32, 1, 1).data[0]).toBe(0);
  expect(ctx.getImageData(0, 0, 1, 1).data[0]).toBe(255);
  const edit = await store.importFile(
    new Blob([new Uint8Array(canvas.toBuffer("image/png"))]),
    "edited.png",
    { parentAssetId: image.id, geometrySourceAssetId: image.id },
  );
  await store.update((w) =>
    applyCommand(w, { type: "image.activate", assetId: edit.id }),
  );
  expect(() => captureFrame(store.snapshot(), "capture")).toThrow(
    "reconstruct",
  );
});
test.skipIf(!rendererExecutable())(
  "independent renderer loads a mesh, produces exact mask/IDs and linear depth, and leaves editor state alone",
  async () => {
    const { store, runner, commands } = await fixture();
    const asset = await store.importFile(triangle(), "triangle.glb");
    await commands.execute({
      type: "nodes.put",
      nodes: [{ ...node("mesh"), kind: "mesh", assetId: asset.id }],
    });
    const before = structuredClone({
      nodes: store.snapshot().nodes,
      settings: store.snapshot().settings,
      selection: store.snapshot().selection,
    });
    const id = await runner.submit(
      {
        kind: "render",
        camera,
        passes: ["color", "mask", "depth", "ids"],
        nodeIds: ["mesh"],
      },
      undefined,
      undefined,
      { actorId: "Renderer" },
    );
    const job = await done(store, id);
    expect(job.error).toBeUndefined();
    expect(job.status).toBe("succeeded");
    expect(
      store
        .activitySnapshot()
        .events.filter((e) => e.jobId === id && e.detail === "summary")
        .map((e) => e.phase),
    ).toEqual(["queued", "running", "succeeded"]);
    expect({
      nodes: store.snapshot().nodes,
      settings: store.snapshot().settings,
      selection: store.snapshot().selection,
    }).toEqual(before);
    const assets = job.outputAssetIds.map((id) => store.snapshot().assets[id]);
    const depth = assets.find((a) => a.role === "depth")!;
    const grid = linearDepth(
      await Bun.file((await store.assetFile(depth.id)).file).arrayBuffer(),
    );
    expect(grid.data[(32 * 64 + 32) * grid.stride]).toBeCloseTo(2, 3);
    const mask = assets.find((a) => a.role === "mask")!;
    const image = await loadImage((await store.assetFile(mask.id)).file);
    const canvas = createCanvas(64, 64),
      ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    expect(ctx.getImageData(32, 32, 1, 1).data[0]).toBe(255);
    expect(ctx.getImageData(0, 0, 1, 1).data[3]).toBe(0);
  },
  120000,
);

test("unchanged RGB pixels are preserved exactly even when the image model alters the entire frame", async () => {
  const { preserveUnchangedPixels } = await import("./image-edit");
  const { store } = await fixture();
  const canvas = createCanvas(4, 4),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "red";
  ctx.fillRect(0, 0, 4, 4);
  const source = await store.importFile(
    new Blob([new Uint8Array(canvas.toBuffer("image/png"))]),
    "source.png",
  );
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, 4, 4);
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 2, 4);
  const mask = await store.importFile(
    new Blob([new Uint8Array(canvas.toBuffer("image/png"))]),
    "mask.png",
  );
  ctx.fillStyle = "blue";
  ctx.fillRect(0, 0, 4, 4);
  const output = await preserveUnchangedPixels(
    store,
    source.id,
    mask.id,
    new Blob([new Uint8Array(canvas.toBuffer("image/png"))]),
    new AbortController().signal,
  );
  ctx.drawImage(await loadImage(Buffer.from(await output.arrayBuffer())), 0, 0);
  expect([...ctx.getImageData(0, 0, 1, 1).data]).toEqual([255, 0, 0, 255]);
  expect([...ctx.getImageData(3, 0, 1, 1).data]).toEqual([0, 0, 255, 255]);
});
