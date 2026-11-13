import { expect, spyOn, test } from "bun:test";
import { Box3, Raycaster, Scene, Vector2, Vector3 } from "three";
import { applyCommand } from "../../../core/commands";
import { createCapture } from "../../../core/captures";
import { emptyWorkspace, nodeSchema, type Asset } from "../../../core/schema";
import { SceneGraph } from "./scene";
import { PackedSplats, SplatMesh } from "@sparkjsdev/spark";
import { clipsForNode } from "../../../core/clips";

test("viewport clips and masks share local scope under an image parent", async () => {
  const graph = new SceneGraph(new Scene(), () => {}, "#888888");
  const workspace = emptyWorkspace();
  for (const [id, parentId, kind] of [
    ["group", null, "group"],
    ["image", "group", "image"],
    ["own", "image", "group"],
    ["sibling", "group", "group"],
  ] as const)
    workspace.nodes[id] = nodeSchema.parse({ id, name: id, parentId, kind });
  workspace.nodes.clip = nodeSchema.parse({
    id: "clip",
    name: "Clip",
    kind: "clip",
    parentId: "image",
    clip: { scope: "local", invert: false, softness: 0 },
  });
  try {
    graph.sync(workspace);
    const meshes = new Map<string, SplatMesh>();
    for (const id of ["own", "sibling"]) {
      const mesh = new SplatMesh({
        packedSplats: new PackedSplats({ maxSplats: 1 }),
      });
      await mesh.initialized;
      const entry = graph.entries.get(id)!;
      entry.content = mesh;
      entry.root.add(mesh);
      meshes.set(id, mesh);
    }
    graph.sync(workspace);
    const edits = graph.entries.get("clip")!.clipEdits!;
    expect(edits.has(meshes.get("own")!)).toBe(true);
    expect(edits.has(meshes.get("sibling")!)).toBe(false);
    expect(clipsForNode(workspace, "own").map((node) => node.id)).toEqual([
      "clip",
    ]);
    expect(clipsForNode(workspace, "sibling")).toEqual([]);
    workspace.nodes.clip.parentId = null;
    graph.sync(workspace);
    expect(edits.size).toBe(0);
    workspace.nodes.clip.clip!.scope = "global";
    graph.sync(workspace);
    expect(edits.has(null)).toBe(true);
    expect(clipsForNode(workspace, "sibling")).toHaveLength(1);
  } finally {
    graph.dispose();
  }
});

test("selection extents rotate with a container under a scaled parent and hide with it", () => {
  const graph = new SceneGraph(new Scene(), () => {}, "#888888");
  try {
    const workspace = emptyWorkspace();
    const capture = nodeSchema.parse({
      id: "capture",
      name: "Capture",
      kind: "capture",
      parentId: "parent",
      transform: {
        position: [3, 1, -2],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    });
    workspace.nodes = {
      parent: nodeSchema.parse({
        id: "parent",
        name: "Parent",
        kind: "group",
        transform: {
          position: [10, 0, 0],
          quaternion: [0, Math.sin(0.2), 0, Math.cos(0.2)],
          scale: [2, 1, 3],
        },
      }),
      capture,
      clip: nodeSchema.parse({
        id: "clip",
        name: "Clip",
        kind: "clip",
        parentId: "capture",
        transform: {
          position: [2, 0, -3],
          quaternion: [0, 0, 0, 1],
          scale: [2, 1, 0.5],
        },
        clip: { scope: "local", invert: false, softness: 0 },
      }),
    };
    workspace.selection = [capture.id];
    for (const angle of [0, 0.4, 0.9]) {
      capture.transform.quaternion = [0, Math.sin(angle), 0, Math.cos(angle)];
      graph.sync(workspace);
      graph.update();
      graph.scene.updateMatrixWorld(true);
      const marker = graph.selectionOutline.children[0];
      const root = graph.entries.get(capture.id)!.root;
      const local = root.matrixWorld
        .clone()
        .invert()
        .multiply(marker.matrixWorld);
      // The clip is the only content; container pick proxies must not enlarge its bounds.
      const box = new Box3(
        new Vector3(-0.5, -0.5, -0.5),
        new Vector3(0.5, 0.5, 0.5),
      ).applyMatrix4(local);
      expect(box.min.distanceTo(new Vector3(0, -1, -3.5))).toBeLessThan(1e-6);
      expect(box.max.distanceTo(new Vector3(4, 1, -2.5))).toBeLessThan(1e-6);
      const axes = local.elements;
      for (const index of [1, 2, 4, 6, 8, 9])
        expect(axes[index]).toBeCloseTo(0);
    }
    capture.visible = false;
    graph.sync(workspace);
    graph.update();
    expect(graph.selectionOutline.children[0].visible).toBe(false);
  } finally {
    graph.dispose();
  }
});

test("placed camera bounds and interaction center stay at its pose, without including the world origin", () => {
  const graph = new SceneGraph(new Scene(), () => {}, "#888888");
  try {
    const workspace = emptyWorkspace();
    const camera = structuredClone(workspace.settings.viewportCamera);
    camera.extrinsics = {
      position: [20, 5, -30],
      quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
      coordinateSystem: "rub",
    };
    applyCommand(workspace, { type: "camera.place", camera });
    graph.sync(workspace);
    graph.update();
    const entry = graph.entries.get(workspace.primaryId!)!;
    expect(entry.root.position.toArray()).toEqual([20, 5, -30]);
    expect(entry.frustum!.position.toArray()).toEqual([0, 0, 0]);
    expect(entry.frustum!.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    const bounds = graph.bounds(workspace.selection)!;
    expect(bounds.containsPoint(new Vector3())).toBe(false);
    expect(bounds.getSize(new Vector3()).length()).toBeLessThan(1);
    expect(
      graph.pick(
        new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1)),
        new Vector2(),
      ),
    ).toBeUndefined();
    expect(
      graph.center(workspace.primaryId!)!.distanceTo(new Vector3(20, 5, -30)),
    ).toBeLessThan(1e-6);
    const marker = graph.selectionOutline.children[0];
    const markerBounds = new Box3().setFromObject(marker);
    expect(markerBounds.min.distanceTo(bounds.min)).toBeLessThan(1e-6);
    expect(markerBounds.max.distanceTo(bounds.max)).toBeLessThan(1e-6);
  } finally {
    graph.dispose();
  }
});

test("registered spatial extents and centers work without render geometry or node-type dispatch", () => {
  const graph = new SceneGraph(new Scene(), () => {}, "#888888");
  try {
    const workspace = emptyWorkspace();
    workspace.nodes.custom = nodeSchema.parse({
      id: "custom",
      name: "Custom",
      kind: "group",
      transform: {
        position: [10, 0, 0],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    });
    workspace.selection = ["custom"];
    graph.sync(workspace);
    const entry = graph.entries.get("custom")!;
    const localBounds = new Box3(new Vector3(3, 2, 1), new Vector3(7, 4, 2));
    const localCenter = new Vector3(4, 3, 1);
    entry.spatial = {
      object: entry.root,
      getBounds: () => localBounds,
      getCenter: () => localCenter,
    };
    graph.update();
    const markerBounds = new Box3().setFromObject(
      graph.selectionOutline.children[0],
    );
    expect(markerBounds.min.toArray()).toEqual([13, 2, 1]);
    expect(markerBounds.max.toArray()).toEqual([17, 4, 2]);
    expect(graph.bounds(["custom"])!.equals(markerBounds)).toBe(true);
    expect(graph.center("custom")!.toArray()).toEqual([14, 3, 1]);
    expect(localBounds.min.toArray()).toEqual([3, 2, 1]);
    expect(localCenter.toArray()).toEqual([4, 3, 1]);
  } finally {
    graph.dispose();
  }
});

test("posed image corners stay on the frustum end at every display depth", async () => {
  const bitmapDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "createImageBitmap",
  );
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => ({ width: 1280, height: 720, close() {} }),
  });
  const network = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new Blob()),
  );
  const graph = new SceneGraph(
    new Scene(),
    (error) => {
      throw new Error(error);
    },
    "#888888",
  );
  try {
    const workspace = emptyWorkspace();
    const asset: Asset = {
      id: "photo",
      name: "Photo",
      path: "photo.png",
      kind: "image",
      mimeType: "image/png",
      size: 1,
      modifiedAt: 0,
      missing: false,
      camera: {
        extrinsics: {
          position: [3, 2, -4],
          quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
          coordinateSystem: "rub",
        },
        intrinsics: {
          width: 1280,
          height: 720,
          fx: 900,
          fy: 850,
          cx: 570,
          cy: 390,
        },
      },
    };
    workspace.assets[asset.id] = asset;
    for (const node of createCapture(asset, "capture"))
      if (node.kind !== "points") workspace.nodes[node.id] = node;
    graph.setDisplay(workspace.settings.display);
    graph.sync(workspace);
    await graph.ready(new AbortController().signal);
    const plane = graph.entries.get("capture_image")!.imagePlane!;
    const frustum = graph.entries.get("capture_camera")!.frustum!;
    const lines = frustum.children[0] as import("three").LineSegments;
    for (const distance of [
      workspace.settings.display.imageDistance,
      0.7,
      0.25,
    ]) {
      graph.setDisplay({
        ...workspace.settings.display,
        imageDistance: distance,
      });
      graph.scene.updateMatrixWorld(true);
      const corners = [1, 3, 5, 7].map((index) =>
        new Vector3()
          .fromBufferAttribute(lines.geometry.attributes.position, index)
          .applyMatrix4(lines.matrixWorld),
      );
      const vertices = plane.geometry.attributes.position;
      for (let i = 0; i < vertices.count; i++) {
        const vertex = new Vector3()
          .fromBufferAttribute(vertices, i)
          .applyMatrix4(plane.matrixWorld);
        expect(
          Math.min(...corners.map((corner) => corner.distanceTo(vertex))),
        ).toBeLessThan(1e-6);
      }
      expect(plane.position.z).toBe(-distance);
    }
  } finally {
    graph.dispose();
    network.mockRestore();
    if (bitmapDescriptor)
      Object.defineProperty(globalThis, "createImageBitmap", bitmapDescriptor);
    else delete (globalThis as any).createImageBitmap;
  }
});
