import { SparkRenderer, SplatGenerator } from "@sparkjsdev/spark";
import {
  AlwaysDepth,
  CanvasTexture,
  DepthTexture,
  HalfFloatType,
  LinearSRGBColorSpace,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedIntType,
  Vector2,
  WebGLCoordinateSystem,
  WebGLRenderer,
  WebGPUCoordinateSystem,
  type Object3D,
} from "three";
import { NodeMaterial, QuadMesh, WebGPURenderer } from "three/webgpu";
import { texture, vec3, vec4 } from "three/tsl";

function visibleGaussians(object: Object3D): boolean {
  return (
    object.visible &&
    (object instanceof SplatGenerator || object.children.some(visibleGaussians))
  );
}

function screenMaterial() {
  const material = new NodeMaterial();
  material.depthTest = material.depthWrite = false;
  material.fog = false;
  return material;
}

/** Spark's decoder, clipping, SH evaluation and sorter require a WebGL2 context.
 * Only visible Gaussians allocate it. Seed its depth buffer with the actual
 * opaque TSL pass, then blend its transparent output before the editor overlays.
 * Both canvas transfers stay in the browser; no JavaScript pixel readback. */
class SplatLayer {
  readonly gl = new WebGLRenderer({ alpha: true, antialias: false });
  readonly spark = new SparkRenderer({ renderer: this.gl });
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera();
  private readonly depthCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly depthScene = new Scene();
  private readonly depthTexture: CanvasTexture;
  private readonly depthPlane: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly splatTexture = new CanvasTexture(this.gl.domElement);
  private readonly size = new Vector2();
  private readonly target = new RenderTarget(1, 1, {
    type: HalfFloatType,
    depthTexture: new DepthTexture(1, 1, UnsignedIntType),
  });
  private readonly encode = new QuadMesh(screenMaterial());
  private readonly blend = new QuadMesh(screenMaterial());
  private readonly output = new QuadMesh(screenMaterial());
  private sourceScene: Scene;

  constructor(
    private readonly renderer: WebGPURenderer,
    scene: Scene,
  ) {
    this.sourceScene = scene;
    // This separate scene draws only Spark. The sorter sees the complete
    // original hierarchy, including transformed generators and clip volumes.
    const before = this.spark.onBeforeRender.bind(this.spark);
    this.spark.onBeforeRender = (r, _s, c) => before(r, this.sourceScene, c);
    this.scene.add(this.spark);
    this.gl.autoClear = false;
    this.gl.setClearColor(0, 0);
    this.depthTexture = new CanvasTexture(renderer.domElement);
    this.depthTexture.generateMipmaps =
      this.splatTexture.generateMipmaps = false;
    this.depthTexture.magFilter = this.depthTexture.minFilter = NearestFilter;
    // QuadMesh samples top-down screen UVs; preserve the canvas row order.
    this.splatTexture.flipY = false;
    this.splatTexture.colorSpace = SRGBColorSpace;
    const depth = texture(this.target.depthTexture!).r.mul(16777215).round();
    (this.encode.material as NodeMaterial).fragmentNode = vec4(
      vec3(
        depth.div(65536).floor(),
        depth.div(256).floor().mod(256),
        depth.mod(256),
      ).div(255),
      1,
    );
    this.depthPlane = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        uniforms: { packedDepth: { value: this.depthTexture } },
        vertexShader:
          "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }",
        fragmentShader: `uniform sampler2D packedDepth; varying vec2 vUv;
        void main() { vec3 bytes = floor(texture2D(packedDepth, vUv).rgb * 255. + 0.5);
          gl_FragDepth = dot(bytes, vec3(65536., 256., 1.)) / 16777215.; gl_FragColor = vec4(0.); }`,
        depthFunc: AlwaysDepth,
        colorWrite: false,
      }),
    );
    this.depthScene.add(this.depthPlane);
    const blend = this.blend.material as NodeMaterial;
    blend.fragmentNode = texture(this.splatTexture);
    blend.transparent = true;
    (this.output.material as NodeMaterial).fragmentNode = texture(
      this.target.texture,
    );
  }

  private syncCamera(camera: PerspectiveCamera) {
    this.camera.copy(camera, false);
    if (camera.coordinateSystem === WebGPUCoordinateSystem) {
      // Convert [0,w] clip depth to [-w,w] while keeping the calibrated x/y.
      const p = this.camera.projectionMatrix.elements;
      for (const i of [2, 6, 10, 14]) p[i] = 2 * p[i] - p[i + 1];
      this.camera.projectionMatrixInverse
        .copy(this.camera.projectionMatrix)
        .invert();
    }
    this.camera.coordinateSystem = WebGLCoordinateSystem;
    this.camera.updateMatrixWorld();
  }

  async settle(scene: Scene, camera: PerspectiveCamera, signal: AbortSignal) {
    this.syncCamera(camera);
    const wait = async () => {
      while (this.spark.sorting || this.spark.sortDirty) {
        signal.throwIfAborted();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    await wait();
    await this.spark.update({ scene, camera: this.camera });
    await wait();
  }

  render(scene: Scene, camera: PerspectiveCamera) {
    const r = this.renderer;
    this.sourceScene = scene;
    this.syncCamera(camera);
    r.getDrawingBufferSize(this.size);
    const { x: w, y: h } = this.size;
    if (this.target.width !== w || this.target.height !== h) {
      // Canvas uploads reuse their GPU allocation. After a resize the old
      // extent can fail the copy and leave the previous splat frame on screen.
      this.depthTexture.dispose();
      this.splatTexture.dispose();
      this.gl.setSize(w, h, false);
      this.target.setSize(w, h);
    }
    const background = scene.background;
    const colorSpace = r.outputColorSpace;
    const autoClear = r.autoClear;
    try {
      r.setRenderTarget(this.target);
      r.transparent = false;
      r.render(scene, camera);
      r.transparent = true;
      r.setRenderTarget(null);
      r.outputColorSpace = LinearSRGBColorSpace;
      this.encode.render(r);
      this.depthTexture.needsUpdate = true;
      this.gl.clear();
      this.gl.render(this.depthScene, this.depthCamera);
      this.gl.render(this.scene, this.camera);
      this.splatTexture.needsUpdate = true;
      r.outputColorSpace = colorSpace;
      r.setRenderTarget(this.target);
      r.autoClear = false;
      this.blend.render(r);
      r.opaque = false;
      scene.background = null;
      r.render(scene, camera);
      r.opaque = true;
      r.autoClear = autoClear;
      r.setRenderTarget(null);
      this.output.render(r);
    } finally {
      r.transparent = r.opaque = true;
      r.autoClear = autoClear;
      scene.background = background;
      r.outputColorSpace = colorSpace;
      r.setRenderTarget(null);
    }
  }

  async dispose() {
    this.spark.autoUpdate = false;
    clearTimeout(this.spark.updateTimeoutId);
    clearTimeout(this.spark.sortTimeoutId);
    this.spark.sortDirty = false;
    while (this.spark.sorting)
      await new Promise((resolve) => setTimeout(resolve, 16));
    this.spark.dispose();
    this.depthPlane.geometry.dispose();
    this.depthPlane.material.dispose();
    this.depthTexture.dispose();
    this.splatTexture.dispose();
    for (const quad of [this.encode, this.blend, this.output])
      (quad.material as NodeMaterial).dispose();
    this.target.dispose();
    this.gl.dispose();
    this.gl.forceContextLoss();
  }
}

export class SceneRenderer {
  readonly renderer: WebGPURenderer;
  private splats?: SplatLayer;
  private device?: GPUDevice;
  private shaderError?: string;
  private readonly gpuError = (event: GPUUncapturedErrorEvent) =>
    this.reportShaderError(event.error.message);

  falloff = 1;
  maxPixelRadius = 512;

  constructor(
    alpha: boolean,
    private readonly onError: (message: string) => void,
  ) {
    this.renderer = new WebGPURenderer({ alpha, antialias: false });
  }

  async init() {
    await this.renderer.init();
    this.renderer.domElement.dataset.backend = this.backend;
    if (this.backend === "webgpu") {
      this.device = (
        this.renderer.getContext() as GPUCanvasContext
      ).getConfiguration?.()?.device;
      this.device?.addEventListener("uncapturederror", this.gpuError);
    } else {
      this.renderer.debug.onShaderError = (gl, program, vertex, fragment) =>
        this.reportShaderError(
          [
            gl.getProgramInfoLog(program),
            gl.getShaderInfoLog(vertex),
            gl.getShaderInfoLog(fragment),
          ]
            .filter(Boolean)
            .join("\n"),
        );
    }
  }

  private reportShaderError(detail: string) {
    const message = `${this.backend} shader: ${detail || "compilation failed"}`;
    if (message !== this.shaderError) this.onError(message);
    this.shaderError = message;
  }

  /** Await asynchronous driver validation before reporting a completed render. */
  async checked<T>(operation: () => Promise<T>): Promise<T> {
    this.shaderError = undefined;
    this.device?.pushErrorScope("validation");
    try {
      const result = await operation();
      if (this.shaderError) throw new Error(this.shaderError);
      return result;
    } finally {
      const error = await this.device?.popErrorScope();
      if (error) throw new Error(`${this.backend} shader: ${error.message}`);
    }
  }

  get backend() {
    return this.renderer.coordinateSystem === WebGPUCoordinateSystem
      ? "webgpu"
      : "webgl2";
  }

  private visibleLayer(scene: Scene) {
    if (!visibleGaussians(scene)) return;
    const layer = (this.splats ??= new SplatLayer(this.renderer, scene));
    layer.spark.falloff = this.falloff;
    layer.spark.minPixelRadius = 0;
    layer.spark.maxPixelRadius = this.maxPixelRadius;
    return layer;
  }

  async settle(scene: Scene, camera: PerspectiveCamera, signal: AbortSignal) {
    await this.visibleLayer(scene)?.settle(scene, camera, signal);
  }

  render(scene: Scene, camera: PerspectiveCamera) {
    const layer = this.visibleLayer(scene);
    if (layer) layer.render(scene, camera);
    else this.renderer.render(scene, camera);
  }

  async dispose(releaseScene: () => void) {
    this.device?.removeEventListener("uncapturederror", this.gpuError);
    await this.splats?.dispose();
    try {
      releaseScene();
    } finally {
      if (this.renderer.initialized) this.renderer.dispose();
    }
  }
}
