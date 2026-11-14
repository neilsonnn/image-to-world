import { Scene, PerspectiveCamera, WebGLRenderer, Vector3 } from "three";
import { SparkRenderer } from "@sparkjsdev/spark";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Workspace } from "../../../core/schema";
import { currentCamera } from "../../../core/generation";
import { SceneGraph } from "./scene";
import { PresentationPipeline } from "./presentation";
import {
  applyCamera,
  viewportProjection,
  cameraValue,
} from "./viewport-projection";

/** The interactive beauty view and exported web player share this runtime. */
export class ScenePlayer {
  readonly scene = new Scene();
  readonly renderer = new WebGLRenderer({
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  readonly camera = new PerspectiveCamera(50, 1, 0.01, 10000);
  readonly graph: SceneGraph;
  readonly controls: OrbitControls;
  readonly spark: SparkRenderer;
  readonly pipeline: PresentationPipeline;
  playing = false;
  time = 0;
  private observer: ResizeObserver;
  private frame = 0;
  private disposed = false;
  private width = 1;
  private height = 1;
  private last = performance.now();
  private configuredTime = -1;
  private snapshot: Workspace;
  private abort = new AbortController();
  constructor(
    private host: HTMLElement,
    workspace: Workspace,
    private onError: (error: string) => void = console.error,
  ) {
    this.snapshot = workspace;
    this.renderer.setPixelRatio(1);
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.cssText =
      "width:100%;height:100%;display:block;touch-action:none";
    applyCamera(this.camera, currentCamera(workspace));
    this.graph = new SceneGraph(
      this.scene,
      onError,
      "#888888",
      "#dddddd",
      this.renderer,
    );
    this.spark = new SparkRenderer({ renderer: this.renderer });
    this.scene.add(this.spark);
    this.pipeline = new PresentationPipeline(
      this.renderer,
      this.scene,
      this.camera,
    );
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target
      .copy(this.camera.position)
      .add(this.camera.getWorldDirection(new Vector3()).multiplyScalar(5));
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.sync(workspace);
    let moved = false;
    this.controls.addEventListener("start", () => {
      moved = true;
    });
    void this.graph
      .ready(this.abort.signal)
      .then(() => {
        if (this.disposed || moved) return;
        const bounds = this.graph.bounds([...this.graph.entries.keys()]);
        if (!bounds || bounds.isEmpty()) return;
        const direction = this.camera.getWorldDirection(new Vector3());
        const distance = Math.max(
          0.1,
          bounds
            .getCenter(new Vector3())
            .sub(this.camera.position)
            .dot(direction),
        );
        this.controls.target
          .copy(this.camera.position)
          .addScaledVector(direction, distance);
      })
      .catch((error) => {
        if (!this.disposed) this.onError(String(error));
      });
    const draw = () => {
      if (this.disposed) return;
      const now = performance.now();
      if (this.playing) this.time += Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.controls.update();
      this.graph.sample(this.time, this.camera);
      this.graph.update();
      this.graph.hideCaptureHelpers();
      for (const entry of this.graph.entries.values())
        if (
          entry.imagePlane &&
          (!entry.node.imageSurface ||
            entry.node.imageSurface.mode === "reference")
        )
          entry.imagePlane.visible = false;
      this.pipeline.render(this.width, this.height);
      this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
  }
  private resize() {
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(this.width, this.height, false);
    viewportProjection(
      this.camera,
      this.width,
      this.height,
      currentCamera(this.snapshot),
    );
  }
  sync(workspace: Workspace) {
    this.snapshot = workspace;
    const snapshot = {
      ...workspace,
      selection: [],
      primaryId: null,
      settings: {
        ...workspace.settings,
        atlas: { ...workspace.settings.atlas, soloIds: [] },
        display: {
          ...workspace.settings.display,
          showImages: false,
          showFrustums: false,
        },
      },
    };
    this.graph.sync(snapshot);
    if (this.configuredTime !== workspace.settings.art.time) {
      this.time = workspace.settings.art.time;
      this.configuredTime = this.time;
    }
    void this.pipeline
      .configure(workspace.settings.art, workspace.assets)
      .catch((error) => this.onError(String(error)));
  }
  cameraData() {
    return cameraValue(this.camera, this.width, this.height);
  }
  async ready(signal: AbortSignal) {
    await this.graph.ready(signal);
  }
  dispose() {
    this.disposed = true;
    this.abort.abort();
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.dispose();
    this.spark.autoUpdate = false;
    clearTimeout(this.spark.updateTimeoutId);
    clearTimeout(this.spark.sortTimeoutId);
    this.spark.sortDirty = false;
    this.renderer.domElement.remove();
    const release = async () => {
      while (this.spark.sorting)
        await new Promise((resolve) => setTimeout(resolve, 16));
      this.pipeline.dispose();
      this.graph.dispose();
      this.spark.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    };
    void release().catch((error) => this.onError(String(error)));
  }
}
