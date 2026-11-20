import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { identity, jobSchema, type Camera } from "../../../core/schema";
import {
  createCapture,
  captureFrame,
  sceneCamera,
} from "../../../core/captures";
import { applyCommand } from "../../../core/commands";
import { linearDepth } from "../../../core/depth";
import { WorkspaceStore } from "./store";
import { JobRunner } from "./jobs";
import { CommandService } from "./commands";
import { rendererExecutable } from "./render-worker";
import { encodeDepth } from "./depth";
import { lightRigSchema } from "../../../core/lighting";
import { fitObject } from "./observations";
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
function triangle(extra: Record<string, unknown> = {}) {
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
  const text = JSON.stringify({ ...json, ...extra }),
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
test.skipIf(!rendererExecutable())(
  "a queued render reopens with its submitted camera, mesh bytes and transforms",
  async () => {
    const { store, runner, commands } = await fixture();
    await runner.close(); // Persist a genuinely queued job, without racing the renderer.
    const mesh = await store.importFile(triangle(), "subject.glb");
    const unrelated = await store.importFile(
      new Blob(["catalog only"]),
      "notes.txt",
    );
    await commands.execute({
      type: "nodes.put",
      nodes: [{ ...node("subject"), kind: "mesh", assetId: mesh.id }],
    });
    const id = await runner.submit({
      kind: "render",
      camera,
      passes: ["depth"],
      nodeIds: ["subject"],
    });
    const inputFile = Bun.file(path.join(store.root, "jobs", id, "input.json"));
    const manifest = await inputFile.text();
    expect(manifest).not.toContain(unrelated.id);
    expect(Object.keys(JSON.parse(manifest).contextSnapshot.assets)).toEqual([
      mesh.id,
    ]);
    expect(store.current.jobs[id].input).toEqual({ kind: "render" });
    await commands.execute({
      type: "nodes.transform",
      ids: ["subject"],
      transform: { position: [100, 0, 0] },
    });
    await Bun.write(
      (await store.assetFile(mesh.id)).file,
      "replaced after queueing",
    );
    await store.close();
    const reopened = await new WorkspaceStore(store.root).init(),
      worker = new JobRunner(reopened);
    try {
      await worker.init();
      const result = await done(reopened, id);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe("succeeded");
      const depth = result.outputAssetIds
        .map((id) => reopened.current.assets[id])
        .find((a) => a.role === "depth")!;
      const grid = linearDepth(
        await Bun.file((await reopened.assetFile(depth.id)).file).arrayBuffer(),
      );
      expect(grid.data[(32 * 64 + 32) * grid.stride]).toBeCloseTo(2, 3);
      expect(reopened.current.nodes.subject.transform.position).toEqual([
        100, 0, 0,
      ]);
      expect(await inputFile.text()).toBe(manifest);
    } finally {
      await worker.close();
      await reopened.close();
    }
  },
  60_000,
);
test("mesh import accepts embedded WebP textures while rejecting external images and decoder-only extensions", async () => {
  const { store } = await fixture();
  const image = createCanvas(2, 2).toBuffer("image/webp");
  const extra = {
    extensionsUsed: ["EXT_texture_webp"],
    extensionsRequired: ["EXT_texture_webp"],
    textures: [{ extensions: { EXT_texture_webp: { source: 0 } } }],
    images: [{ uri: `data:image/webp;base64,${image.toString("base64")}` }],
  };
  const asset = await store.importFile(triangle(extra), "embedded-webp.glb");
  expect(asset.kind).toBe("mesh");
  await expect(
    store.importFile(
      triangle({
        ...extra,
        images: [{ uri: "https://example.com/texture.webp" }],
      }),
      "remote.glb",
    ),
  ).rejects.toThrow("external GLB resources");
  await expect(
    store.importFile(
      triangle({ extensionsRequired: ["KHR_draco_mesh_compression"] }),
      "compressed.glb",
    ),
  ).rejects.toThrow("Unsupported required GLB extension");
});

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
  const job = await store.loadJob(id);
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
  expect(data.depth.median).toBe(2);
  expect(data.centerInFrame[0]).toBeCloseTo(0);
  expect(data.centerInFrame[2]).toBeCloseTo(-2);
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
test("workers share a movable Frame and guarded fits survive moving the Frame during construction", async () => {
  const { store, runner, commands } = await fixture();
  const depth = await store.importFile(
    await encodeDepth({
      width: 64,
      height: 64,
      stride: 1,
      data: new Float32Array(4096).fill(2),
    }),
    "depth.exr",
  );
  const photo = await store.importFile(
    new Blob([new Uint8Array(createCanvas(64, 64).toBuffer("image/png"))]),
    "source.png",
    { camera, depthAssetId: depth.id },
  );
  const mesh = await store.importFile(triangle(), "asset.glb");
  await commands.execute({
    type: "nodes.put",
    nodes: [
      {
        ...node("room"),
        transform: { ...identity(), position: [5, 0, 2], scale: [2, 2, 2] },
      },
      ...createCapture(photo, "frame").map((n) =>
        n.id === "frame" ? { ...n, parentId: "room" } : n,
      ),
    ],
  });
  const observed = await done(
    store,
    await runner.submit({
      kind: "observe",
      nodeId: "frame",
      region: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      padding: 0.1,
    }),
  );
  expect(observed.status).toBe("succeeded");
  await commands.execute({
    type: "nodes.transform",
    ids: ["frame"],
    transform: {
      position: [9, 3, 1],
      quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    },
  });
  const placed = await Promise.all(
    ["chair", "lamp"].map((actorId) =>
      commands.execute(
        {
          type: "assets.place",
          assetIds: [mesh.id],
          parentId: "frame",
          mode: "individual",
        },
        { actorId },
      ),
    ),
  );
  expect(placed.map((p) => p.nodeIds?.length)).toEqual([1, 1]);
  expect(new Set(placed.map((p) => p.nodeIds![0])).size).toBe(2);
  for (const result of placed) {
    expect(store.snapshot().nodes[result.nodeIds![0]]).toMatchObject({
      parentId: "frame",
      transform: identity(),
    });
    const actor = store
      .snapshot()
      .undo.find((e) => e.id === result.editId)?.actorId;
    expect(actor).toBe(result === placed[0] ? "chair" : "lamp");
  }
  const target = placed[0].nodeIds![0];
  const fitInput = {
    kind: "fit" as const,
    nodeId: target,
    observationAssetId: observed.outputAssetIds.at(-1)!,
  };
  const fitJob = {
    ...observed,
    input: fitInput,
    contextSnapshot: {
      nodes: store.snapshot().nodes,
      assets: store.snapshot().assets,
      settings: store.snapshot().settings,
    },
  };
  const results = await fitObject(
    store,
    {
      render: async (job) => {
        expect(job.contextSnapshot!.nodes[target]).toMatchObject({
          parentId: null,
          transform: identity(),
        });
        const report = {
          report: {
            nodes: [
              { id: target, bounds: { min: [-1, 0, -1], max: [1, 2, 1] } },
            ],
          },
        };
        return [
          await store.importFile(
            new Blob([JSON.stringify(report)]),
            "measurement.json",
            { role: "raw-result" },
          ),
        ];
      },
    },
    fitJob,
    new AbortController().signal,
  );
  const fit = await Bun.file(
    (await store.assetFile(results.at(-1)!.id)).file,
  ).json();
  await commands.execute({
    type: "nodes.transform",
    ids: ["room"],
    transform: { position: [0, 11, -8], scale: [4, 4, 4] },
  });
  await commands.execute({
    type: "nodes.transform",
    ids: ["frame"],
    transform: { position: [-3, 2, 1], quaternion: [0, 0, 0, 1] },
  });
  await commands.execute(fit.command, { preconditions: fit.preconditions });
  const t = store.snapshot().nodes[target].transform;
  expect(t.position[0]).toBeCloseTo(0);
  expect(t.position[1]).toBeCloseTo(-0.64);
  expect(t.position[2]).toBeCloseTo(-2);
  expect(t.scale[0]).toBeCloseTo(0.64);
  // A stale source camera or retargeted instance still invalidates the fit.
  await commands.execute({
    type: "nodes.transform",
    ids: [target],
    transform: identity(),
  });
  await commands.execute({
    type: "nodes.transform",
    ids: ["frame_camera"],
    transform: { position: [0, 1, 0] },
  });
  await expect(
    commands.execute(fit.command, { preconditions: fit.preconditions }),
  ).rejects.toThrow("conflict");
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
    const color = assets.find(
      (a) => a.role === "render" && a.path.endsWith("-color.png"),
    )!;
    const source = await store.importFile(
      Bun.file((await store.assetFile(color.id)).file),
      "source-view.png",
      { camera, depthAssetId: depth.id },
    );
    await commands.execute({
      type: "nodes.put",
      nodes: createCapture(source, "source"),
    });
    await commands.execute({
      type: "nodes.move",
      parentId: "source",
      ids: ["mesh"],
    });
    const probe = await done(
      store,
      await runner.submit({
        kind: "probe",
        nodeId: "source",
        nodeIds: ["mesh"],
        width: 128,
      }),
    );
    expect(probe.error).toBeUndefined();
    expect(probe.outputAssetIds).toHaveLength(1);
    const panorama = await loadImage(
      (await store.assetFile(probe.outputAssetIds[0])).file,
    );
    const probePixels = createCanvas(128, 64).getContext("2d");
    probePixels.drawImage(panorama, 0, 0);
    const front = probePixels.getImageData(32, 32, 1, 1).data;
    const back = probePixels.getImageData(96, 32, 1, 1).data;
    expect(front[0]).toBeGreaterThan(back[0] + 30);
    const observed = await done(
      store,
      await runner.submit({
        kind: "observe",
        nodeId: "source",
        region: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
        padding: 0,
      }),
    );
    expect(observed.error).toBeUndefined();
    await commands.execute({
      type: "nodes.transform",
      ids: ["source"],
      transform: {
        position: [18, -2, 7],
        quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
      },
    });
    const fitted = await done(
      store,
      await runner.submit({
        kind: "fit",
        nodeId: "mesh",
        observationAssetId: observed.outputAssetIds.at(-1)!,
      }),
    );
    expect(fitted.error).toBeUndefined();
    const proposal = await Bun.file(
      (await store.assetFile(fitted.outputAssetIds.at(-1)!)).file,
    ).json();
    await commands.execute(proposal.command, {
      preconditions: proposal.preconditions,
    });
    expect(store.snapshot().nodes.mesh.transform.scale[0]).toBeCloseTo(
      1.024,
      2,
    );
  },
  120000,
);

test.skipIf(!rendererExecutable())(
  "rendered depth points retain source-image shadow, midtone, and highlight colors",
  async () => {
    const { store, runner, commands } = await fixture();
    const depth = await store.importFile(
      await encodeDepth({
        width: 64,
        height: 64,
        stride: 1,
        data: new Float32Array(4096).fill(2),
      }),
      "flat.exr",
    );
    const canvas = createCanvas(64, 64),
      ctx = canvas.getContext("2d");
    const colors = [
      [32, 48, 64],
      [96, 128, 160],
      [192, 208, 224],
      [240, 240, 240],
    ];
    colors.forEach((rgb, i) => {
      ctx.fillStyle = `rgb(${rgb.join(",")})`;
      ctx.fillRect(i * 16, 0, 16, 64);
    });
    const image = await store.importFile(
      new Blob([new Uint8Array(canvas.toBuffer("image/png"))]),
      "colors.png",
      { camera, depthAssetId: depth.id },
    );
    await commands.execute({
      type: "nodes.put",
      nodes: createCapture(image, "capture"),
    });
    expect(store.snapshot().nodes.capture_points.visible).toBe(true);
    async function renderGuide() {
      const job = await done(
        store,
        await runner.submit({
          kind: "render",
          camera: sceneCamera(store.snapshot(), "capture")!,
          nodeIds: ["capture_points"],
          passes: ["color"],
        }),
      );
      expect(job.error).toBeUndefined();
      const output = job.outputAssetIds
        .map((id) => store.snapshot().assets[id])
        .find((a) => a.kind === "image")!;
      ctx.drawImage(
        await loadImage((await store.assetFile(output.id)).file),
        0,
        0,
      );
      return ctx.getImageData(56, 32, 1, 1).data[0];
    }
    const full = await renderGuide();
    colors.forEach((rgb, i) => {
      const pixel = ctx.getImageData(i * 16 + 8, 32, 1, 1).data;
      // Gaussian footprints leave a little background visible. Allow coverage
      // loss and 8-bit rounding, but reject the much larger sRGB-to-linear shift.
      rgb.forEach((value, channel) =>
        expect(Math.abs(pixel[channel] - value)).toBeLessThanOrEqual(
          value * 0.06 + 1,
        ),
      );
    });
    // Atlas integration records the job on the image. Freeze must also work
    // through that provenance when the Frame has no job of its own.
    await store.update((state) => {
      state.jobs.generated = jobSchema.parse({
        id: "generated",
        input: { kind: "atlas", nodeIds: ["capture"], cameras: [camera] },
        status: "succeeded",
        createdAt: 1,
        updatedAt: 1,
        message: "Done",
        outputAssetIds: [image.id],
      });
      state.assets[image.id].jobId = "generated";
    });
    const faded = await renderGuide();
    expect(faded).toBeLessThan(full - 10);
    await commands.execute({
      type: "nodes.patch",
      id: "capture",
      patch: { contextFrozen: true },
    });
    expect(await renderGuide()).toBe(full);
    const before = store.snapshot().settings.display;
    await commands.execute({
      type: "workspace.update",
      settings: { display: { showFrameGuides: false } },
    });
    expect(store.snapshot().settings.display).toEqual({
      ...before,
      showFrameGuides: false,
    });
    expect(await renderGuide()).toBeLessThan(faded - 10);
    expect(captureFrame(store.snapshot(), "capture").asset.depthAssetId).toBe(
      depth.id,
    );
    await commands.execute({ type: "history.undo" });
    expect(store.snapshot().settings.display).toEqual(before);
  },
  120000,
);

test.skipIf(!rendererExecutable())(
  "a foreground mesh occludes sorted Gaussians in the matching image rows",
  async () => {
    const { store, runner, commands } = await fixture();
    const depth = await store.importFile(
      await encodeDepth({
        width: 64,
        height: 64,
        stride: 1,
        data: new Float32Array(4096).fill(2),
      }),
      "back-wall.exr",
    );
    const canvas = createCanvas(64, 64);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 64, 64);
    const image = await store.importFile(
      new Blob([new Uint8Array(canvas.toBuffer("image/png"))], {
        type: "image/png",
      }),
      "red-wall.png",
      { camera, depthAssetId: depth.id },
    );
    const green = await store.importFile(
      triangle({
        extensionsUsed: ["KHR_materials_unlit"],
        materials: [
          {
            extensions: { KHR_materials_unlit: {} },
            pbrMetallicRoughness: { baseColorFactor: [0, 1, 0, 1] },
            doubleSided: true,
          },
        ],
      }),
      "occluder.glb",
    );
    await commands.execute({
      type: "nodes.put",
      nodes: [
        ...createCapture(image, "stage"),
        {
          ...node("occluder"),
          kind: "mesh",
          assetId: green.id,
          transform: { ...identity(), position: [0, 0.5, 0.6] },
        },
      ],
    });
    await commands.execute({
      type: "nodes.patch",
      id: "stage_points",
      patch: { visible: true },
    });
    const job = await done(
      store,
      await runner.submit({
        kind: "render",
        camera,
        nodeIds: ["stage_points", "occluder"],
        passes: ["color"],
      }),
    );
    expect(job.error).toBeUndefined();
    const result = job.outputAssetIds
      .map((id) => store.snapshot().assets[id])
      .find((a) => a.kind === "image")!;
    ctx.drawImage(
      await loadImage((await store.assetFile(result.id)).file),
      0,
      0,
    );
    const foreground = ctx.getImageData(32, 17, 1, 1).data;
    const wall = ctx.getImageData(32, 47, 1, 1).data;
    expect(foreground[1]).toBe(255);
    expect(foreground[0]).toBe(0);
    expect(wall[0]).toBeGreaterThan(230);
    expect(wall[1]).toBeLessThan(30);
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

test.skipIf(!rendererExecutable())(
  "Frame key shadows darken the receiver after moving the set and preserve geometry passes",
  async () => {
    const { store, runner, commands } = await fixture();
    const asset = await store.importFile(triangle(), "triangle.glb");
    const frame = createCapture({ name: "Shadow stage", camera }, "stage");
    frame[0].transform = {
      position: [30, 5, 12],
      quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
      scale: [1, 1, 1],
    };
    const rig = lightRigSchema.parse({
      keyIntensity: 3,
      fillIntensity: 0.3,
      keyColor: "#ffffff",
      azimuth: 32,
      elevation: 0,
    });
    frame[0].lighting = rig;
    await commands.execute({
      type: "nodes.put",
      nodes: [
        ...frame,
        ...["receiver", "caster"].map((id) => ({
          ...node(id),
          kind: "mesh" as const,
          assetId: asset.id,
          parentId: "stage",
          transform:
            id === "receiver"
              ? {
                  ...identity(),
                  position: [0, 0, -1] as [number, number, number],
                  scale: [5, 5, 1] as [number, number, number],
                }
              : identity(),
        })),
      ],
    });
    const render = async () => {
      const job = await done(
        store,
        await runner.submit({
          kind: "render",
          lightingViewId: "stage",
          camera: sceneCamera(store.snapshot(), "stage")!,
          nodeIds: ["caster", "receiver"],
          passes: ["color", "ids", "depth", "mask"],
        }),
      );
      expect(job.error).toBeUndefined();
      const bytes = async (pass: string) => {
        const asset = job.outputAssetIds
          .map((id) => store.snapshot().assets[id])
          .find((a) =>
            a.path.endsWith(`-${pass}.${pass === "depth" ? "exr" : "png"}`),
          )!;
        return Bun.file((await store.assetFile(asset.id)).file).arrayBuffer();
      };
      const canvas = createCanvas(64, 64).getContext("2d");
      canvas.drawImage(
        await loadImage(Buffer.from(await bytes("color"))),
        0,
        0,
      );
      return {
        color: canvas.getImageData(0, 0, 64, 64).data,
        ids: await bytes("ids"),
        depth: await bytes("depth"),
        mask: await bytes("mask"),
      };
    };
    const withoutShadow = await render();
    await commands.execute({
      type: "nodes.patch",
      id: "stage",
      patch: { lighting: { ...rig, keyShadows: true } },
    });
    const withShadow = await render();
    let shadowPixels = 0;
    for (let p = 0; p < withoutShadow.color.length; p += 4) {
      if (withoutShadow.color[p] - withShadow.color[p] > 32) shadowPixels++;
    }
    expect(shadowPixels).toBeGreaterThan(10);
    for (const pass of ["ids", "depth", "mask"] as const)
      expect(
        Buffer.from(withShadow[pass]).equals(Buffer.from(withoutShadow[pass])),
      ).toBe(true);
  },
  120000,
);

test("agent activity follows committed local edits, including nested and deleted objects", async () => {
  const { store, commands } = await fixture();
  const run = async (command: Parameters<CommandService["execute"]>[0]) => {
    await commands.execute(command, { actorId: "Builder" });
    return store.activitySnapshot().events.at(-1)!;
  };
  const parent = node("room");
  parent.transform.position = [3, 0, 0];
  parent.transform.scale = [2, 2, 2];
  const child = { ...node("lamp"), parentId: parent.id };
  child.transform.position = [1, 0, 0];
  await run({ type: "nodes.put", nodes: [parent, child] });
  const change = await run({
    type: "edit.batch",
    commands: [
      {
        type: "nodes.transform",
        ids: [child.id],
        transform: { position: [2, 0, 0] },
      },
    ],
  });
  expect(change.sceneChange).toEqual({
    nodeIds: ["lamp"],
    position: [7, 0, 0],
    major: true,
  });
  const rename = await run({
    type: "nodes.patch",
    id: child.id,
    patch: { name: "Desk lamp" },
  });
  expect(rename.sceneChange?.major).toBe(false);
  expect(
    (
      await run({
        type: "nodes.patch",
        id: child.id,
        patch: { name: "Desk lamp" },
      })
    ).sceneChange,
  ).toBeUndefined();
  expect(
    (await run({ type: "selection.set", ids: [child.id] })).sceneChange,
  ).toBeUndefined();
  expect(
    (await run({ type: "workspace.update", settings: { grid: false } }))
      .sceneChange,
  ).toBeUndefined();
  expect(
    (await run({ type: "nodes.remove", ids: [child.id] })).sceneChange,
  ).toEqual({ nodeIds: [], position: [7, 0, 0], major: true });
  expect((await run({ type: "history.undo" })).sceneChange?.nodeIds).toEqual([
    "lamp",
  ]);
});
