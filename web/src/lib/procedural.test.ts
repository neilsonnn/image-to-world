import { expect, test, spyOn } from "bun:test";
import { Scene, Raycaster, Vector2, Vector3 } from "three";
import { emptyWorkspace, nodeSchema, assetSchema } from "../../../core/schema";
import { applyCommand } from "../../../core/commands";
import { SceneGraph } from "./scene";

const respond = (text: string): typeof fetch =>
  Object.assign(async () => new Response(text), { preconnect() {} });

const source = `export default { create({THREE, params}) {
 const object = new THREE.Mesh(new THREE.BoxGeometry(Number(params.size ?? 2),2,2), new THREE.MeshBasicMaterial());
 return {object, sample({time}) {object.position.y=time;}, dispose(){globalThis.__moduleDisposals=(globalThis.__moduleDisposals??0)+1;}};
}};`;

test("procedural nodes use shared parent transforms, picking, updates, undo and cleanup", async () => {
  const fetcher = spyOn(globalThis, "fetch").mockImplementation(
    respond(source),
  );
  const errors: string[] = [];
  const graph = new SceneGraph(
    new Scene(),
    (error) => errors.push(error),
    "#888888",
    "#ffffff",
  );
  const workspace = emptyWorkspace();
  workspace.assets.code = assetSchema.parse({
    id: "code",
    name: "code.js",
    path: "code.js",
    kind: "file",
    mimeType: "text/javascript",
    size: 1,
    modifiedAt: 1,
  });
  const parent = nodeSchema.parse({
    id: "parent",
    name: "Parent",
    kind: "group",
    transform: {
      position: [3, 0, 0],
      quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      scale: [2, 2, 2],
    },
  });
  const node = nodeSchema.parse({
    id: "module",
    name: "Module",
    kind: "procedural",
    parentId: "parent",
    procedural: { sourceAssetId: "code", bundleAssetId: "code" },
  });
  const disposed = () => (globalThis as any).__moduleDisposals ?? 0;
  const before = disposed();
  try {
    applyCommand(workspace, { type: "nodes.put", nodes: [parent, node] });
    graph.sync(workspace);
    await graph.ready(new AbortController().signal);
    expect(errors).toEqual([]);
    expect(graph.bounds([node.id])!.min.x).toBeCloseTo(1);
    expect(graph.bounds([node.id])!.max.x).toBeCloseTo(5);
    expect(
      graph.pick(
        new Raycaster(new Vector3(3, 0, 10), new Vector3(0, 0, -1)),
        new Vector2(),
      ),
    ).toBe(node.id);
    graph.sample(1);
    expect(graph.bounds([node.id])!.getCenter(new Vector3()).x).toBeCloseTo(1);
    applyCommand(workspace, {
      type: "nodes.reparent",
      ids: [node.id],
      parentId: null,
    });
    graph.sync(workspace);
    expect(graph.bounds([node.id])!.getCenter(new Vector3()).x).toBeCloseTo(1);
    applyCommand(workspace, {
      type: "nodes.patch",
      id: node.id,
      patch: { procedural: { ...node.procedural!, parameters: { size: 4 } } },
    });
    graph.sync(workspace);
    await graph.ready(new AbortController().signal);
    expect(disposed()).toBe(before + 1);
    applyCommand(workspace, { type: "history.undo" });
    graph.sync(workspace);
    await graph.ready(new AbortController().signal);
    expect(workspace.nodes.module.procedural!.parameters).toEqual({});
    applyCommand(workspace, { type: "nodes.remove", ids: [node.id] });
    graph.sync(workspace);
    expect(disposed()).toBe(before + 3);
    expect(errors).toEqual([]);
  } finally {
    graph.dispose();
    fetcher.mockRestore();
  }
});

test("late asynchronous modules are disposed after deletion and runtime failures stay local", async () => {
  const workspace = emptyWorkspace();
  workspace.assets.code = assetSchema.parse({
    id: "code",
    name: "code.js",
    path: "code.js",
    kind: "file",
    mimeType: "text/javascript",
    size: 1,
    modifiedAt: 1,
  });
  const node = nodeSchema.parse({
    id: "module",
    name: "Module",
    kind: "procedural",
    procedural: { sourceAssetId: "code", bundleAssetId: "code" },
  });
  let release!: () => void;
  (globalThis as any).__moduleGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  (globalThis as any).__moduleStarted = () => {
    started = true;
  };
  const fetcher = spyOn(globalThis, "fetch").mockImplementation(
    respond(
      `export default {async create({THREE}) {globalThis.__moduleStarted(); await globalThis.__moduleGate; return {object: new THREE.Group(), dispose() { globalThis.__lateModuleDisposed = true; }};}}`,
    ),
  );
  const errors: string[] = [];
  const graph = new SceneGraph(
    new Scene(),
    (error) => errors.push(error),
    "#888888",
    "#ffffff",
  );
  try {
    workspace.nodes[node.id] = node;
    graph.sync(workspace);
    for (let i = 0; i < 100 && !started; i++) await Bun.sleep(1);
    expect(started).toBe(true);
    delete workspace.nodes[node.id];
    graph.sync(workspace);
    release();
    await graph.ready(new AbortController().signal);
    expect((globalThis as any).__lateModuleDisposed).toBe(true);
    expect(graph.entries.has(node.id)).toBe(false);
    expect(errors).toEqual([]);
    fetcher.mockImplementation(
      respond('export default {create(){throw new Error("broken module")}}'),
    );
    workspace.nodes[node.id] = node;
    graph.sync(workspace);
    await graph.ready(new AbortController().signal);
    expect(graph.entries.get(node.id)?.error).toBe("broken module");
    workspace.nodes[node.id] = {
      ...node,
      procedural: { ...node.procedural!, enabled: false },
    };
    graph.sync(workspace);
    await graph.ready(new AbortController().signal);
    expect(graph.entries.get(node.id)?.error).toBeUndefined();
  } finally {
    release();
    graph.dispose();
    fetcher.mockRestore();
    for (const key of [
      "__moduleGate",
      "__moduleStarted",
      "__lateModuleDisposed",
    ])
      delete (globalThis as any)[key];
  }
});
