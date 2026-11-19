import { expect, test } from "bun:test";
import {
  BatchedMesh,
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Ray,
  Scene,
  Vector3,
} from "three";
import { applyCommand } from "../../../core/commands";
import {
  emptyWorkspace,
  nodeSchema,
  type SceneNode,
} from "../../../core/schema";
import type { ModulePhysics } from "../../../core/physics";
import { SceneGraph } from "./scene";
import { startScenePlay } from "./scene-play";

const box = (x = 1, y = 1, z = 1) => new Mesh(new BoxGeometry(x, y, z));
const ray = (x: number, y: number, z = 8) =>
  new Ray(new Vector3(x, y, z), new Vector3(0, 0, -1));
const pos = (obj: Group | Mesh) => obj.getWorldPosition(new Vector3());

function fixture() {
  const graph = new SceneGraph(new Scene(), () => {}, "#888", "#fff");
  const workspace = emptyWorkspace();
  function entry(
    id: string,
    content: Mesh | Group,
    physics?: SceneNode["physics"],
    assembly?: ModulePhysics,
  ) {
    const kind = assembly ? "procedural" : "mesh";
    const node = nodeSchema.parse({ id, name: id, kind, physics });
    const root = new Group().add(content);
    graph.scene.add(root);
    const pickProxy = box();
    root.add(pickProxy);
    graph.entries.set(id, {
      node,
      root,
      content,
      modulePhysics: assembly,
      pickProxy,
      resourceKey: "",
      generation: 0,
    });
    workspace.nodes[id] = node;
    return root;
  }
  return { graph, workspace, entry };
}

test("node physics settings validate, undo and reject incompatible colliders", () => {
  const w = emptyWorkspace();
  applyCommand(w, {
    type: "nodes.put",
    nodes: [nodeSchema.parse({ id: "prop", name: "prop", kind: "mesh" })],
  });
  applyCommand(w, {
    type: "nodes.patch",
    id: "prop",
    patch: { physics: { type: "dynamic", collider: "hull", density: 2 } },
  });
  expect(w.nodes.prop.physics?.type).toBe("dynamic");
  applyCommand(w, { type: "history.undo" });
  expect(w.nodes.prop.physics).toBeUndefined();
  expect(() =>
    nodeSchema.parse({
      ...w.nodes.prop,
      physics: { type: "dynamic", collider: "mesh" },
    }),
  ).toThrow("convex hull");
});

test("fixed-step gravity, precise static contacts, hit-point grabbing and Stop preserve authored poses", async () => {
  const { graph, workspace, entry } = fixture();
  const floor = new Mesh(new PlaneGeometry(30, 30));
  floor.rotation.x = -Math.PI / 2;
  entry("architecture", floor);
  const prop = entry("prop", box(), { type: "dynamic" });
  prop.position.set(0, 3, 0);
  const wall = entry("wall", box(4, 1, 0.1));
  wall.position.set(0, 1, 1.5);
  const state = JSON.stringify(workspace.nodes);
  const session = await startScenePlay(graph);
  try {
    expect(session.bodyCount).toBe(3);
    for (let i = 0; i < 180; i++) session.step(1 / 60);
    expect(pos(prop).y).toBeCloseTo(0.5, 1);
    // The nearer fixed wall occludes grabs on the prop behind it.
    expect(session.grab(ray(0, 0.75))).toBe(false);
    expect(session.grab(ray(pos(prop).x + 0.34, 0.31))).toBe(true);
    session.moveGrab(ray(1.5, 2));
    for (let i = 0; i < 45; i++) session.step(1 / 60);
    expect(pos(prop).x).toBeGreaterThan(0.8);
    expect(pos(prop).y).toBeGreaterThan(1);
    expect(Math.abs(prop.quaternion.w)).toBeLessThan(0.98);
    session.release();
    for (let i = 0; i < 200; i++) session.step(1 / 60);
    expect(pos(prop).y).toBeLessThan(0.95);
  } finally {
    session.dispose();
  }
  expect(prop.position.toArray()).toEqual([0, 3, 0]);
  expect(prop.quaternion.toArray()).toEqual([0, 0, 0, 1]);
  expect(prop.matrixAutoUpdate).toBe(true);
  expect(JSON.stringify(workspace.nodes)).toBe(state);
});

test("local shape proxies and nested rigid bodies follow transformed module parents and reset exactly", async () => {
  const { graph, entry } = fixture();
  const root = new Group();
  const mount = new Group(),
    link = new Group();
  const gap = 0.7;
  link.position.set(gap, 0, 0);
  mount.add(link);
  root.add(mount);
  const geometry = box(0.1, 0.8, 0.12);
  geometry.position.y = -0.3;
  link.add(geometry);
  const bounds = box(0.18, 0.9, 0.18);
  bounds.position.y = -0.3;
  const fixed = box(0.1, 0.1, 0.1);
  const joint: ModulePhysics = {
    bodies: [
      {
        id: "link",
        object: link,
        type: "dynamic",
        shape: bounds,
        collider: "box",
      },
      {
        id: "mount",
        object: mount,
        type: "static",
        shape: fixed,
        collider: "box",
      },
    ],
    joints: [
      {
        type: "hinge",
        a: "mount",
        b: "link",
        anchorA: [gap, 0, 0],
        anchorB: [0, 0, 0],
        axis: [0, 0, 1],
        limits: [-0.9, 0.9],
      },
    ],
  };
  const placed = entry("lamp", root, null, joint);
  placed.position.set(2, 2, 0);
  placed.rotation.z = 0.31;
  placed.scale.set(2, 1.3, 1);
  root.rotation.z = -0.18;
  graph.scene.updateMatrixWorld(true);
  const start = link.matrixWorld.clone(),
    expected = pos(link);
  const session = await startScenePlay(graph);
  try {
    for (let i = 0; i < 120; i++) session.step(1 / 60);
    expect(pos(link).distanceTo(expected)).toBeLessThan(0.005);
    const hit = pos(link).add(new Vector3(0, -0.4, 0));
    expect(session.grab(ray(hit.x, hit.y))).toBe(true);
    session.moveGrab(ray(hit.x + 0.8, hit.y + 0.1));
    for (let i = 0; i < 35; i++) session.step(1 / 60);
    expect(link.matrixWorld.equals(start)).toBe(false);
    expect(pos(link).distanceTo(expected)).toBeLessThan(0.05);
  } finally {
    session.dispose();
  }
  expect(link.matrixWorld.equals(start)).toBe(true);
});

test("scene play rejects unknown or foreign bodies before changing any Three object", async () => {
  const { graph, entry } = fixture();
  const content = box();
  const physics: ModulePhysics = {
    bodies: [{ id: "x", object: content, type: "static" }],
    joints: [
      {
        type: "ball",
        a: "x",
        b: "missing",
        anchorA: [0, 0, 0],
        anchorB: [0, 0, 0],
      },
    ],
  };
  entry("fixture", content, null, physics);
  await expect(startScenePlay(graph)).rejects.toThrow("two declared bodies");
  expect(content.matrixAutoUpdate).toBe(true);
  physics.bodies[0].object = box();
  await expect(startScenePlay(graph)).rejects.toThrow("in this module");
  await expect(startScenePlay(graph, AbortSignal.abort())).rejects.toThrow();
});

test("slider constrains dragging to its travel range and axis", async () => {
  const { graph, entry } = fixture();
  const cabinet = box(0.2, 0.4, 0.4),
    drawer = box(0.6, 0.4, 0.4);
  drawer.position.x = 0.7;
  const root = new Group().add(cabinet, drawer);
  const assembly: ModulePhysics = {
    bodies: [
      { id: "cabinet", object: cabinet, type: "static", collider: "box" },
      { id: "drawer", object: drawer, type: "dynamic", collider: "box" },
    ],
    joints: [
      {
        type: "slider",
        a: "cabinet",
        b: "drawer",
        axis: [1, 0, 0],
        anchorA: [0.7, 0, 0],
        anchorB: [0, 0, 0],
        limits: [0, 0.5],
      },
    ],
  };
  entry("cabinet", root, null, assembly);
  const session = await startScenePlay(graph);
  try {
    expect(session.grab(ray(0.7, 0))).toBe(true);
    session.moveGrab(ray(4, 1));
    for (let i = 0; i < 120; i++) session.step(1 / 60);
    expect(pos(drawer).x).toBeCloseTo(1.2, 1);
    expect(Math.abs(pos(drawer).y)).toBeLessThan(0.02);
  } finally {
    session.dispose();
  }
});

test("instanced collisions use instance poses, leave gaps and exclude invisible content", async () => {
  const { graph, entry } = fixture();
  const instances = new InstancedMesh(
    new PlaneGeometry(0.5, 0.5),
    new MeshBasicMaterial(),
    2,
  );
  instances.setMatrixAt(0, new Matrix4().makeTranslation(-2, 0, 0));
  instances.setMatrixAt(1, new Matrix4().makeTranslation(2, 0, 0));
  const hidden = box();
  hidden.visible = false;
  const batch = new BatchedMesh(5, 32, 64, new MeshBasicMaterial());
  const geometryId = batch.addGeometry(new BoxGeometry(0.4, 0.4, 0.4));
  const removed = batch.addInstance(geometryId);
  const active = batch.addInstance(geometryId);
  batch.deleteInstance(removed);
  batch.setMatrixAt(active, new Matrix4().makeTranslation(4, 0, 0));
  const content = new Group().add(instances, batch, hidden);
  entry("frames", content, { type: "dynamic" });
  const session = await startScenePlay(graph);
  try {
    expect(session.grab(ray(0, 0))).toBe(false);
    expect(session.grab(ray(4, 0))).toBe(true);
    expect(session.grab(ray(2, 0))).toBe(true);
    session.moveGrab(ray(2, 1));
    for (let i = 0; i < 100; i++) session.step(1 / 60);
    expect(Number.isFinite(pos(content).lengthSq())).toBe(true);
  } finally {
    session.dispose();
  }
});

test("Play waits for module creation, honors per-instance overrides and uses fresh bodies on restart", async () => {
  const source = `export default {create({THREE}) {
    const object = new THREE.Mesh(new THREE.BoxGeometry());
    return {object,physics:{bodies:[{id:"loose",object,type:"dynamic",gravityScale:0}]}};
  }}`;
  const graph = new SceneGraph(
    new Scene(),
    () => {},
    "#888",
    "#fff",
    undefined,
    () => "data:text/javascript," + encodeURIComponent(source),
  );
  const workspace = emptyWorkspace();
  workspace.assets.code = {
    id: "code",
    name: "code.js",
    path: "code.js",
    mimeType: "text/javascript",
    kind: "file",
    size: source.length,
    modifiedAt: 1,
    missing: false,
  };
  workspace.nodes.module = nodeSchema.parse({
    id: "module",
    name: "module",
    kind: "procedural",
    procedural: { bundleAssetId: "code", sourceAssetId: "code" },
  });
  graph.sync(workspace);
  try {
    const first = await startScenePlay(graph);
    try {
      for (let i = 0; i < 120; i++) first.step(1 / 60);
      expect(first.grab(ray(0, 0))).toBe(true);
    } finally {
      first.dispose();
    }
    applyCommand(workspace, {
      type: "nodes.patch",
      id: "module",
      patch: { physics: { type: "static" } },
    });
    graph.sync(workspace);
    const second = await startScenePlay(graph);
    try {
      expect(second.bodyCount).toBe(1);
      expect(second.grab(ray(0, 0))).toBe(false);
    } finally {
      second.dispose();
    }
  } finally {
    graph.dispose();
  }
});
