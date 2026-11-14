import {
  WebGLRenderTarget,
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  MeshBasicMaterial,
  MeshDepthMaterial,
  RGBADepthPacking,
  NoToneMapping,
  LinearSRGBColorSpace,
  Color,
  type Mesh,
  type Material,
} from "three";
import { SparkRenderer } from "@sparkjsdev/spark";
import { SceneGraph } from "../lib/scene";
import {
  applyCamera,
  applyCalibratedProjection,
} from "../lib/viewport-projection";
import { isNodeInSubtree } from "../../../core/clips";
import type { JobInput, Workspace } from "../../../core/schema";

type RenderInput = Extract<JobInput, { kind: "render" }>;
async function render(workspace: Workspace, input: RenderInput) {
  const scene = new Scene();
  const errors: string[] = [];
  const renderer = new WebGLRenderer({
    antialias: false,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  const { width, height } = input.camera.intrinsics;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x17191e, input.referenceAssetId ? 0 : 1);
  const graph = new SceneGraph(
    scene,
    (e) => errors.push(e),
    "#657080",
    "#c4e6ff",
  );
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);
  const camera = new PerspectiveCamera(
    50,
    width / height,
    input.near,
    input.far,
  );
  applyCamera(camera, input.camera);
  applyCalibratedProjection(camera, input.camera);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const outputs: Record<string, string> = {};
  try {
    workspace = structuredClone(workspace);
    workspace.selection = [];
    workspace.primaryId = null;
    workspace.settings.atlas.soloIds = [];
    workspace.settings.display = {
      ...workspace.settings.display,
      showImages: false,
      showFrustums: false,
      showPoints: true,
    };
    for (const [id, transform] of Object.entries(input.overrides)) {
      if (!workspace.nodes[id]) throw new Error(`Unknown override node ${id}`);
      workspace.nodes[id].transform = transform;
    }
    graph.sync(workspace);
    await graph.ready(controller.signal);
    if (errors.length) throw new Error(errors.join("\n"));
    graph.hideCaptureHelpers();
    for (const entry of graph.entries.values()) {
      if (entry.imagePlane) entry.imagePlane.visible = false;
      if (
        input.nodeIds &&
        !input.nodeIds.some((id) =>
          isNodeInSubtree(workspace, id, entry.node.id),
        )
      ) {
        if (entry.content) entry.content.visible = false;
      }
    }
    graph.update();
    spark.autoUpdate = false;
    const waitSort = async () => {
      while (spark.sorting || spark.sortDirty) {
        controller.signal.throwIfAborted();
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    await waitSort();
    await spark.update({ scene, camera });
    await waitSort();
    const report = graph.inspect(input.nodeIds);
    report.source = "headless";
    report.boundsNote =
      "World-axis bounds from isolated renderer NodeSpatial; excludes editor helpers.";
    const ids: Record<number, string> = {};
    for (const pass of input.passes) {
      const changed: Array<[Mesh, Material | Material[]]> = [];
      const materials: Material[] = [];
      const oldSpace = renderer.outputColorSpace;
      try {
        if (pass !== "color") {
          const geometry = [...graph.entries.values()].filter(
            (e) =>
              e.content &&
              e.content.visible &&
              e.root.visible &&
              (!input.nodeIds ||
                input.nodeIds.some((id) =>
                  isNodeInSubtree(workspace, id, e.node.id),
                )) &&
              ["mesh", "points", "splat"].includes(e.node.kind),
          );
          if (geometry.some((e) => e.node.kind !== "mesh"))
            throw new Error(
              `${pass} requires mesh geometry; select mesh nodes explicitly. Point/splat geometry passes are unsupported.`,
            );
          renderer.setClearColor(0, 0);
          renderer.outputColorSpace = LinearSRGBColorSpace;
          renderer.toneMapping = NoToneMapping;
          let index = 1;
          for (const entry of geometry) {
            ids[index] = entry.node.id;
            const color =
              pass === "ids"
                ? new Color().setRGB(
                    (index & 255) / 255,
                    ((index >> 8) & 255) / 255,
                    ((index >> 16) & 255) / 255,
                  )
                : new Color(1, 1, 1);
            const material =
              pass === "depth"
                ? new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
                : new MeshBasicMaterial({ color });
            materials.push(material);
            entry.content!.traverse((object) => {
              const mesh = object as Mesh;
              if (mesh.isMesh) {
                changed.push([mesh, mesh.material]);
                mesh.material = material;
              }
            });
            index++;
          }
        }
        if (pass === "depth") {
          const target = new WebGLRenderTarget(width, height);
          try {
            renderer.setRenderTarget(target);
            renderer.render(scene, camera);
            const pixels = new Uint8Array(width * height * 4);
            renderer.readRenderTargetPixels(
              target,
              0,
              0,
              width,
              height,
              pixels,
            );
            let binary = "";
            for (let i = 0; i < pixels.length; i += 8192)
              binary += String.fromCharCode(...pixels.subarray(i, i + 8192));
            outputs[pass] = btoa(binary);
          } finally {
            renderer.setRenderTarget(null);
            target.dispose();
          }
        } else {
          renderer.render(scene, camera);
          outputs[pass] = renderer.domElement
            .toDataURL("image/png")
            .split(",")[1];
        }
      } finally {
        for (const [mesh, material] of changed) mesh.material = material;
        materials.forEach((m) => m.dispose());
        renderer.outputColorSpace = oldSpace;
        renderer.setClearColor(0x17191e, input.referenceAssetId ? 0 : 1);
      }
    }
    return {
      outputs,
      report,
      ids,
      camera: input.camera,
      near: input.near,
      far: input.far,
      revision: workspace.revision,
    };
  } finally {
    clearTimeout(timeout);
    graph.dispose();
    spark.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
(globalThis as unknown as { worldbashRender: typeof render }).worldbashRender =
  render;
