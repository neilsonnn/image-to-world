import { SplatGenerator } from "@sparkjsdev/spark";
import {
  Color,
  DepthTexture,
  Mesh,
  MeshBasicNodeMaterial,
  NoBlending,
  QuadMesh,
  RenderTarget,
  UnsignedIntType,
  Vector2,
  WebGPUCoordinateSystem,
  type Material,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type WebGPURenderer,
} from "three/webgpu";
import {
  diffuseColor,
  float,
  uint,
  floatBitsToUint,
  Fn,
  perspectiveDepthToViewZ,
  screenUV,
  texture,
  vec4,
} from "three/tsl";
import type { SceneGraph } from "../lib/scene";

// Three r183 returns padded, top-down WebGPU rows and tightly packed,
// bottom-up WebGL rows. Keep all exported pixels in image coordinates.
function imageRows(
  raw: Uint8Array,
  width: number,
  height: number,
  gpu: boolean,
) {
  const row = width * 4;
  const stride =
    gpu && raw.byteLength !== row * height ? Math.ceil(row / 256) * 256 : row;
  if (raw.length < (height - 1) * stride + row)
    throw new Error("Incomplete GPU readback");
  const out = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    const start = (gpu ? y : height - y - 1) * stride;
    out.set(raw.subarray(start, start + row), y * row);
  }
  return out;
}

function diagnosticMaterial(
  renderer: WebGPURenderer,
  source: Material,
  index: number,
) {
  const node = renderer.library.fromMaterial(source);
  if (!node) throw new Error(`Unsupported diagnostic material: ${source.type}`);
  // fromMaterial copies enumerable properties, including renderer listeners on a
  // live legacy material. Clone to keep teardown of a diagnostic pass isolated.
  const result = node.clone();
  const output = vec4(
    (index & 255) / 255,
    ((index >>> 8) & 255) / 255,
    ((index >>> 16) & 255) / 255,
    1,
  );
  // Keep vertex displacement, face culling, clipping, alpha tests and authored
  // fragment discards. Only the surviving fragment's final color changes.
  const slot = result.fragmentNode ? "fragmentNode" : "outputNode";
  const authored = vec4(result[slot] ?? diffuseColor);
  result[slot] = Fn(() => {
    authored.a.lessThanEqual(0).discard();
    return output;
  })();
  result.blending = NoBlending;
  result.depthWrite = true;
  result.fog = false;
  result.toneMapped = false;
  result.mrtNode = null;
  return result;
}

export async function renderDataPass(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  graph: SceneGraph,
  pass: "mask" | "ids" | "depth",
  ids: Record<number, string>,
) {
  const { x: width, y: height } = renderer.getDrawingBufferSize(new Vector2());
  const target = new RenderTarget(width, height);
  const packed = new RenderTarget(width, height, { depthBuffer: false });
  const encoder = new MeshBasicNodeMaterial();
  const originalTarget = renderer.getRenderTarget(),
    background = scene.background;
  const clearColor = renderer.getClearColor(
      Object.assign(new Color(), { a: 1 }),
    ),
    alpha = renderer.getClearAlpha();
  const replaced = new Map<Mesh, Material | Material[]>();
  const temporary = new Set<Material>();
  const hidden: Object3D[] = [];
  const shadows = renderer.shadowMap.enabled;
  try {
    renderer.shadowMap.enabled = false;
    let index = 0;
    for (const entry of graph.entries.values()) {
      const content = entry.content;
      if (!content?.visible) continue;
      let visible = true;
      content.traverseAncestors((parent) => {
        if (!parent.visible) visible = false;
      });
      if (!visible) continue;
      if (
        !["mesh", "points", "splat", "procedural"].includes(entry.node.kind)
      ) {
        content.visible = false;
        hidden.push(content);
        continue;
      }
      const meshes: Mesh[] = [];
      content.traverseVisible((object) => {
        if (
          object instanceof SplatGenerator ||
          "isPoints" in object ||
          "isLine" in object ||
          "isSprite" in object
        )
          throw new Error(
            `${pass} requires mesh geometry; select mesh nodes explicitly. ${entry.node.name} contains non-mesh geometry.`,
          );
        if (object instanceof Mesh) meshes.push(object);
      });
      if (!meshes.length) continue;
      ids[++index] = entry.node.id;
      const cache = new Map<Material, Material>();
      const replace = (source: Material) => {
        if (!cache.has(source)) {
          const material = diagnosticMaterial(
            renderer,
            source,
            pass === "ids" ? index : 0xffffff,
          );
          temporary.add(material);
          cache.set(source, material);
        }
        return cache.get(source)!;
      };
      for (const mesh of meshes) {
        replaced.set(mesh, mesh.material);
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(replace)
          : replace(mesh.material);
      }
    }
    if (pass === "depth")
      target.depthTexture = new DepthTexture(width, height, UnsignedIntType);
    scene.background = null;
    renderer.setClearColor(0, 0);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    if (pass === "depth") {
      // Sample the actual depth buffer so a custom vertex/depth node produces
      // the same silhouette and camera-space distance as the color render.
      const z = texture(target.depthTexture!, screenUV).r;
      const metres = z
        .lessThan(1)
        .select(
          perspectiveDepthToViewZ(
            z,
            float(camera.near),
            float(camera.far),
          ).negate(),
          0,
        );
      const bits = uint(floatBitsToUint(metres));
      encoder.fragmentNode = vec4(
        bits.bitAnd(255),
        bits.shiftRight(8).bitAnd(255),
        bits.shiftRight(16).bitAnd(255),
        bits.shiftRight(24),
      ).div(255);
      encoder.toneMapped = false;
      renderer.setRenderTarget(packed);
      new QuadMesh(encoder).render(renderer);
    }
    const bytes = await renderer.readRenderTargetPixelsAsync(
      pass === "depth" ? packed : target,
      0,
      0,
      width,
      height,
    );
    const pixels = imageRows(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      width,
      height,
      renderer.coordinateSystem === WebGPUCoordinateSystem,
    );
    if (pass === "depth") {
      let binary = "";
      for (let i = 0; i < pixels.length; i += 8192)
        binary += String.fromCharCode(...pixels.subarray(i, i + 8192));
      return btoa(binary);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(width, height);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
  } finally {
    renderer.shadowMap.enabled = shadows;
    for (const [mesh, material] of replaced) mesh.material = material;
    for (const object of hidden) object.visible = true;
    for (const material of temporary) material.dispose();
    scene.background = background;
    renderer.setClearColor(clearColor, alpha);
    renderer.setRenderTarget(originalTarget);
    target.dispose();
    packed.dispose();
    encoder.dispose();
  }
}
