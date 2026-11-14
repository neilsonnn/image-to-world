import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, copyFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { nodeSchema, identity, type Camera } from "../../../core/schema";
import { artPresets } from "../../../core/creation";
import { WorkspaceStore } from "./store";
import { JobRunner } from "./jobs";
import { CommandService } from "./commands";
import { rendererExecutable } from "./render-worker";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function fixture() {
  const directory = await mkdtemp(
    path.join(tmpdir(), "image-to-world-creation-"),
  );
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = await new WorkspaceStore(directory).init(),
    runner = new JobRunner(store);
  cleanup.push(async () => {
    await runner.close();
    await store.close();
  });
  return { store, runner, commands: new CommandService(store, runner) };
}
async function done(store: WorkspaceStore, id: string) {
  for (let n = 0; n < 800; n++) {
    const job = store.snapshot().jobs[id];
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return job;
    await Bun.sleep(100);
  }
  throw new Error(`Job ${id} did not complete`);
}
const camera: Camera = {
  extrinsics: {
    position: [0, 0, 4],
    quaternion: [0, 0, 0, 1],
    coordinateSystem: "rub",
  },
  intrinsics: { width: 96, height: 96, fx: 90, fy: 90, cx: 48, cy: 48 },
};

test("reference placement preserves source sizes and does not submit posing", async () => {
  const { store, commands } = await fixture();
  for (const [width, height] of [
    [123, 77],
    [81, 164],
  ]) {
    const canvas = createCanvas(width, height),
      image = await store.importFile(
        new Blob([new Uint8Array(canvas.toBuffer("image/png"))]),
        `${width}.png`,
      );
    await commands.execute({
      type: "assets.place",
      assetIds: [image.id],
      camera,
    });
    const snapshot = store.snapshot(),
      nodes = Object.values(snapshot.nodes).filter(
        (node) => node.kind === "camera",
      );
    expect(nodes.at(-1)!.projection!.width).toBe(width);
    expect(nodes.at(-1)!.projection!.height).toBe(height);
  }
  expect(Object.keys(store.snapshot().jobs)).toHaveLength(0);
  expect(store.snapshot().settings.format).toBeNull();
  expect(
    Object.values(store.snapshot().nodes).some(
      (node) => node.kind === "points",
    ),
  ).toBe(false);
});

test("procedural code validates, keeps its working build on failure, samples deterministically, and bakes", async () => {
  if (!rendererExecutable()) return;
  const { store, runner, commands } = await fixture();
  await commands.execute({
    type: "workspace.update",
    settings: { viewportCamera: camera, art: artPresets.pixel.settings },
  });
  await commands.execute({
    type: "nodes.put",
    nodes: [
      nodeSchema.parse({
        id: "procedural",
        name: "Authored cube",
        kind: "procedural",
        transform: identity(),
      }),
    ],
  });
  const code = `export default { parameters: { size: { type: "number", default: 1, min: .1, max: 3 } }, create({ THREE, params }) { const object = new THREE.Mesh(new THREE.BoxGeometry(params.size,1,1), new THREE.MeshBasicMaterial({color:0xff8833})); return { object, sample({time}) { object.position.x=Math.sin(time)*.2; } }; } };`;
  const source = await store.importFile(new Blob([code]), "cube.ts"),
    bundle = await store.importFile(new Blob([code]), "cube.js");
  const build = await runner.submit({
    kind: "module",
    nodeId: "procedural",
    sourceAssetId: source.id,
    bundleAssetId: bundle.id,
  });
  const built = await done(store, build);
  expect(built.error).toBeUndefined();
  expect(built.applicationError).toBeUndefined();
  expect(
    store.snapshot().nodes.procedural.procedural!.fields.size.default,
  ).toBe(1);
  const oldBundle = store.snapshot().nodes.procedural.procedural!.bundleAssetId;
  const broken = await store.importFile(
    new Blob([
      "export default { create() { throw new Error('intentional broken build'); } }",
    ]),
    "broken.js",
  );
  const failed = await done(
    store,
    await runner.submit({
      kind: "module",
      nodeId: "procedural",
      sourceAssetId: source.id,
      bundleAssetId: broken.id,
    }),
  );
  expect(failed.status).toBe("failed");
  expect(store.snapshot().nodes.procedural.procedural!.bundleAssetId).toBe(
    oldBundle,
  );
  const before = structuredClone(store.snapshot().nodes),
    colors: string[] = [];
  for (let n = 0; n < 2; n++) {
    const job = await done(
      store,
      await runner.submit({
        kind: "render",
        camera,
        time: 1.25,
        presentation: true,
        bake: n === 0,
      }),
    );
    expect(job.error).toBeUndefined();
    const assets = job.outputAssetIds.map((id) => store.snapshot().assets[id]);
    const color = assets.find((asset) => asset.name.endsWith("-color.png"))!;
    colors.push(color.contentHash!);
    if (!n) expect(assets.some((asset) => asset.kind === "mesh")).toBe(true);
  }
  expect(colors[0]).toBe(colors[1]);
  expect(store.snapshot().nodes).toEqual(before);
  await expect(
    commands.execute({
      type: "nodes.patch",
      id: "procedural",
      patch: {
        procedural: {
          ...store.snapshot().nodes.procedural.procedural!,
          parameters: { size: -2 },
        },
      },
    }),
  ).rejects.toThrow("Invalid numeric parameter");
}, 60000);

test("portable project snapshots keep module bytes and environment assets without job payloads", async () => {
  const { store, runner, commands } = await fixture();
  const source = await store.importFile(
      new Blob(["export default {}"]),
      "source.ts",
    ),
    bundle = await store.importFile(
      new Blob(["export default {}"]),
      "bundle.js",
    );
  await commands.execute({
    type: "nodes.put",
    nodes: [
      nodeSchema.parse({
        id: "module",
        name: "Module",
        kind: "procedural",
        procedural: {
          sourceAssetId: source.id,
          bundleAssetId: bundle.id,
          enabled: false,
        },
      }),
    ],
  });
  const job = await done(
    store,
    await runner.submit({ kind: "project.export", includeLibrary: false }),
  );
  expect(job.status).toBe("succeeded");
  expect(job.pinnedAssets?.[bundle.id]).toBeDefined();
  const data = await Bun.file(
    (await store.assetFile(job.outputAssetIds[0])).file,
  ).json();
  expect(data.workspace.nodes.module.procedural.bundleAssetId).toBe(bundle.id);
  expect(data.workspace.jobs).toEqual({});
  expect(data.workspace.receipts).toEqual({});
  expect(data.workspace.settings.falInput).toBe("{}");
  const exported = await mkdtemp(
    path.join(tmpdir(), "image-to-world-portable-"),
  );
  cleanup.push(() => rm(exported, { recursive: true, force: true }));
  for (const id of data.assets) {
    const asset = data.workspace.assets[id],
      destination = path.join(exported, "assets", asset.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile((await store.assetFile(id)).file, destination);
  }
  await writeFile(
    path.join(exported, "workspace.json"),
    JSON.stringify(data.workspace),
  );
  const reopened = await new WorkspaceStore(exported).init();
  cleanup.push(() => reopened.close());
  expect(reopened.snapshot().nodes.module.procedural!.bundleAssetId).toBe(
    bundle.id,
  );
  expect(reopened.snapshot().assets[bundle.id].missing).toBe(false);
});

test("creation dependencies are pinned transitively and protected from trash", async () => {
  const { store, commands, runner } = await fixture();
  const source = await store.importFile(new Blob(["source"]), "source.ts");
  const bundle = await store.importFile(new Blob(["bundle"]), "bundle.js", {
    sourceAssetIds: [source.id],
  });
  const texture = await store.importFile(new Blob(["texture"]), "texture.png");
  await commands.execute({
    type: "nodes.put",
    nodes: [
      nodeSchema.parse({
        id: "module",
        kind: "procedural",
        name: "Live code",
        procedural: {
          sourceAssetId: source.id,
          bundleAssetId: bundle.id,
          enabled: false,
        },
      }),
      nodeSchema.parse({
        id: "box",
        kind: "primitive",
        name: "Textured box",
        primitive: { shape: "box" },
        surface: { textureAssetId: texture.id },
      }),
    ],
  });
  await expect(
    commands.execute({ type: "assets.trash", ids: [source.id] }),
  ).rejects.toThrow();
  await expect(
    commands.execute({ type: "assets.trash", ids: [texture.id] }),
  ).rejects.toThrow();
  const job = await done(
    store,
    await runner.submit({ kind: "project.export", includeLibrary: false }),
  );
  expect(job.pinnedAssets?.[source.id]).toBeDefined();
  expect(job.pinnedAssets?.[texture.id]).toBeDefined();
});

test("procedural placement shares parent transforms and rejects incompatible scaling", async () => {
  const { store, commands } = await fixture();
  await commands.execute({
    type: "nodes.put",
    nodes: [
      nodeSchema.parse({
        id: "parent",
        kind: "group",
        name: "Parent",
        transform: {
          position: [2, 3, 4],
          quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
          scale: [2, 2, 2],
        },
      }),
      nodeSchema.parse({
        id: "child",
        kind: "procedural",
        name: "Child",
        parentId: "parent",
        transform: { ...identity(), position: [1, 0, 0] },
      }),
    ],
  });
  const { worldMatrix } = await import("../../../core/cameras");
  const { Vector3 } = await import("three");
  const before = new Vector3().setFromMatrixPosition(
    worldMatrix(store.snapshot().nodes.child, store.snapshot().nodes),
  );
  expect(before.x).toBeCloseTo(2);
  expect(before.y).toBeCloseTo(3);
  expect(before.z).toBeCloseTo(2);
  await expect(
    commands.execute({
      type: "nodes.transform",
      ids: ["parent"],
      transform: { scale: [1, 2, 3] },
    }),
  ).rejects.toThrow();
  expect(store.snapshot().nodes.parent.transform.scale).toEqual([2, 2, 2]);
});

test("opaque local geometry captures calibrated RGBD once and becomes usable Atlas context", async () => {
  if (!rendererExecutable()) return;
  const { store, runner, commands } = await fixture();
  await commands.execute({
    type: "nodes.put",
    nodes: [
      nodeSchema.parse({
        id: "box",
        kind: "primitive",
        name: "Graybox",
        primitive: { shape: "box", size: [2, 2, 1] },
      }),
    ],
  });
  const job = await done(
    store,
    await runner.submit({
      kind: "render",
      camera,
      nodeIds: ["box"],
      passes: ["color", "depth"],
      integrate: true,
    }),
  );
  expect(job.error).toBeUndefined();
  expect(job.applied).toBe(true);
  const { captureFrame, sceneCamera } = await import("../../../core/captures");
  const id = `node_${job.id}_capture`,
    frame = captureFrame(store.snapshot(), id)!;
  expect(frame).toBeDefined();
  expect(sceneCamera(store.snapshot(), id)).toEqual(camera);
  const { readDepth, prepareContext } = await import("./depth");
  const depth = await readDepth(store, frame.asset);
  expect(depth.data[(48 * 96 + 48) * depth.stride]).toBeCloseTo(3.5, 2);
  const prepared = await prepareContext(
    store,
    store.snapshot(),
    id,
    new AbortController().signal,
  );
  expect(prepared).toBeDefined();
  await commands.execute({ type: "history.undo" });
  expect(store.snapshot().nodes[id]).toBeUndefined();
  expect(store.snapshot().jobs[job.id].applied).toBe(true);
  await commands.execute({ type: "history.redo" });
  expect(captureFrame(store.snapshot(), id)).toBeDefined();
  await commands.execute({
    type: "nodes.patch",
    id: "box",
    patch: { surface: { opacity: 0.5 } },
  });
  const unsupported = await done(
    store,
    await runner.submit({
      kind: "render",
      camera,
      nodeIds: ["box"],
      passes: ["color", "depth"],
      integrate: true,
    }),
  );
  expect(unsupported.status).toBe("failed");
  expect(unsupported.error).toContain("opaque");
  expect(
    store.snapshot().nodes[`node_${unsupported.id}_capture`],
  ).toBeUndefined();
}, 60000);

test("ordinary PLY data is not misclassified as a Gaussian scene", async () => {
  const { store } = await fixture();
  const asset = await store.importFile(
    new Blob([
      "ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n",
    ]),
    "point-cloud.ply",
  );
  expect(asset.kind).toBe("file");
});

test("overlapping module builds preserve newest ownership and never revive a deleted destination", async () => {
  if (!rendererExecutable()) return;
  const { store, runner, commands } = await fixture();
  await commands.execute({
    type: "nodes.put",
    nodes: [
      nodeSchema.parse({
        id: "module",
        kind: "procedural",
        name: "Concurrent module",
      }),
    ],
  });
  const source = await store.importFile(new Blob(["source"]), "source.ts");
  const bundle = await store.importFile(
    new Blob([
      `export default {parameters: {size:{type:'number',default:1}}, async create({THREE,params}) { await new Promise(r=>setTimeout(r,200)); return {object: new THREE.Mesh(new THREE.BoxGeometry(params.size,1,1),new THREE.MeshBasicMaterial())}; }};`,
    ]),
    "bundle.js",
  );
  const submit = (size: number) =>
    runner.submit({
      kind: "module",
      nodeId: "module",
      sourceAssetId: source.id,
      bundleAssetId: bundle.id,
      parameters: { size },
    });
  const first = await submit(1),
    second = await submit(2);
  expect((await done(store, first)).error).toBeUndefined();
  expect((await done(store, second)).error).toBeUndefined();
  expect(store.snapshot().nodes.module.procedural!.parameters.size).toBe(2);
  const third = await submit(3);
  await commands.execute({ type: "nodes.remove", ids: ["module"] });
  const result = await done(store, third);
  expect(result.applicationError).toContain("deleted or replaced");
  expect(store.snapshot().nodes.module).toBeUndefined();
}, 60000);
