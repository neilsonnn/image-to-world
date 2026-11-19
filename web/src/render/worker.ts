import { Scene, PerspectiveCamera } from "three";
import { SceneRenderer } from "../lib/scene-renderer";
import { renderDataPass } from "./data-passes";
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
  const surface = new SceneRenderer(true, (detail) => errors.push(detail));
  const renderer = surface.renderer;
  await surface.init();
  const { width, height } = input.camera.intrinsics;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x17191e, input.referenceAssetId ? 0 : 1);
  const graph = new SceneGraph(
    scene,
    (e) => errors.push(e),
    "#657080",
    "#c4e6ff",
    () => renderer,
  );
  const camera = new PerspectiveCamera(
    50,
    width / height,
    input.near,
    input.far,
  );
  camera.coordinateSystem = renderer.coordinateSystem;
  applyCamera(camera, input.camera);
  applyCalibratedProjection(camera, input.camera);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const outputs: Record<string, string> = {};
  try {
    return await surface.checked(async () => {
      workspace = structuredClone(workspace);
      workspace.selection = [];
      workspace.primaryId = null;
      workspace.settings.atlas.soloIds = [];
      workspace.settings.display = {
        ...workspace.settings.display,
        showImages: input.setOnly
          ? workspace.settings.display.showImages
          : false,
        showFrustums: false,
        showPoints: true,
      };
      for (const [id, transform] of Object.entries(input.overrides)) {
        if (!workspace.nodes[id])
          throw new Error(`Unknown override node ${id}`);
        workspace.nodes[id].transform = transform;
      }
      if (input.lightingViewId && !workspace.nodes[input.lightingViewId])
        throw new Error("Lighting view no longer exists");
      graph.sync(workspace, input.lightingViewId ?? null);
      await graph.ready(controller.signal);
      if (errors.length) throw new Error(errors.join("\n"));
      graph.sample(0, camera);
      if (errors.length) throw new Error(errors.join("\n"));
      graph.hideCaptureHelpers();
      for (const entry of graph.entries.values()) {
        if (entry.imagePlane && !input.setOnly)
          entry.imagePlane.visible = false;
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
      surface.maxPixelRadius = workspace.settings.pointSize;
      surface.falloff =
        workspace.settings.display.pointStyle === "gaussian" ? 1 : 0;
      await surface.settle(scene, camera, controller.signal);
      const report = graph.inspect(input.nodeIds);
      report.source = "headless";
      report.boundsNote =
        "World-axis bounds from isolated renderer NodeSpatial; excludes editor helpers.";
      const ids: Record<number, string> = {};
      for (const pass of input.passes) {
        if (pass !== "color") {
          outputs[pass] = await renderDataPass(
            renderer,
            scene,
            camera,
            graph,
            pass,
            ids,
          );
          continue;
        }
        renderer.shadowMap.enabled = graph.keyShadows;
        const background = scene.background;
        if (input.referenceAssetId) scene.background = null;
        try {
          surface.render(scene, camera);
          outputs[pass] = renderer.domElement
            .toDataURL("image/png")
            .split(",")[1];
        } finally {
          scene.background = background;
        }
      }
      return {
        outputs,
        backend: surface.backend,
        report,
        ids,
        camera: input.camera,
        near: input.near,
        far: input.far,
        revision: workspace.revision,
      };
    });
  } finally {
    clearTimeout(timeout);
    await surface.dispose(() => graph.dispose());
  }
}
(
  globalThis as unknown as { imageToWorldRender: typeof render }
).imageToWorldRender = render;
